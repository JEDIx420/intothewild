// Recorded, openly licensed music. All files are served from this game;
// credits and original download sources are in docs/music-sources.md.
export const MUSIC_TRACKS = Object.freeze([
  { id: 'forest', title: 'Forest', artist: 'syncopika', file: 'forest.mp3',
    source: 'https://opengameart.org/content/forest', license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/', moods: ['forest', 'stream', 'meadow'] },
  { id: 'warm-fireplace', title: 'A Warm Fireplace', artist: 'MouthlessGames', file: 'warm-fireplace.mp3',
    source: 'https://opengameart.org/content/snowy-cozyness-calm-pianoguitar', license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/', moods: ['meadow', 'forest', 'rest'] },
  { id: 'freezing-cold', title: "It's Getting Freezing Cold", artist: 'MouthlessGames', file: 'freezing-cold.mp3',
    source: 'https://opengameart.org/content/snowy-cozyness-calm-pianoguitar', license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/', moods: ['mountain', 'winter', 'night'] },
  { id: 'vaporware', title: 'Vaporware', artist: 'The Cynic Project', file: 'vaporware.mp3',
    source: 'https://opengameart.org/content/calm-piano-1-vaporware', license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', moods: ['enchanted', 'swamp', 'stream', 'night'] },
]);
const TRACKS = new Map(MUSIC_TRACKS.map(track => [track.id, track]));
const FADE_SECONDS = 6;
const MIN_MOOD_SECONDS = 65;
const MAX_EFFECTS = 18;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

/**
 * start() must be called from a user gesture. It unlocks the AudioContext;
 * downloaded tracks can then begin safely when decoding finishes, including on
 * mobile. Two decoded tracks and at most two music sources are retained.
 * Music follows the journey's mood, with full phrases and long crossfades.
 */
export class ForestAudio {
  constructor(options = {}) {
    this.enabled = false;
    this.context = null;
    this._master = null;
    this._music = null;
    this._noise = null;
    this._wind = null;
    this._water = null;
    this._windFilter = null;
    this._persistent = [];
    this._voices = new Set();
    this._musicVoices = new Set();
    this._buffers = new Map();
    this._active = null;
    this._retiring = null;
    this._pending = null;
    this._queuedTrack = null;
    this._failedUntil = new Map();
    this._recent = [];
    this._scene = {};
    this._journey = {};
    this._mood = 'forest';
    this._moodSince = 0;
    this._nextBird = 0;
    this._lastAmbience = -Infinity;
    this._lastReaction = -Infinity;
    this._starting = null;
    this._suspendTimer = null;
    this._disposed = false;
    this._contextFactory = options.contextFactory || null;
    this._fetch = options.fetch || ((...args) => globalThis.fetch(...args));
    this._loadState = 'idle';
  }

  get currentTrack() { return this._active?.track || TRACKS.get(this._pending?.id) || null; }
  get musicState() { return this._loadState; }

  async start() {
    if (this._disposed) return false;
    if (this._starting) return this._starting;
    this._starting = this._startContext();
    try { return await this._starting; }
    finally { this._starting = null; }
  }

  async _startContext() {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!this._contextFactory && !AudioContextClass) return false;
    try {
      if (!this.context) {
        // 32 kHz keeps a pair of long stereo tracks modest in memory. Fall back
        // to the device rate when a browser does not accept a requested rate.
        if (this._contextFactory) this.context = this._contextFactory();
        else {
          try { this.context = new AudioContextClass({ latencyHint: 'playback', sampleRate: 32000 }); }
          catch { this.context = new AudioContextClass(); }
        }
        this._buildGraph();
      }
      if (this.context.state === 'closed') return false;
      if (this.context.state !== 'running') await this.context.resume();
      return this.context.state === 'running';
    } catch { return false; }
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    if (this._suspendTimer !== null) clearTimeout(this._suspendTimer);
    this._suspendTimer = null;
    const ctx = this.context;
    if (!ctx || !this._master || this._disposed || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    this._master.gain.cancelScheduledValues(now);
    this._master.gain.setTargetAtTime(this.enabled ? .8 : 0, now, .06);
    if (this.enabled) {
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      this._nextBird = now + 5;
      if (!this._active && !this._pending) this._queueTrack(this._queuedTrack || this._chooseTrack());
    } else {
      // Suspending freezes the current recording instead of losing its place.
      // A short gain ramp removes clicks. This single timer also runs when a
      // background tab has stopped requesting animation frames.
      for (const voice of [...this._voices]) this._stopEffect(voice);
      this._suspendTimer = setTimeout(() => {
        this._suspendTimer = null;
        if (!this.enabled && !this._disposed && ctx.state === 'running') ctx.suspend().catch(() => {});
      }, 180);
    }
  }

  _buildGraph() {
    const ctx = this.context;
    this._master = ctx.createGain(); this._master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 12; limiter.ratio.value = 3;
    limiter.attack.value = .015; limiter.release.value = .3;
    this._master.connect(limiter); limiter.connect(ctx.destination);
    this._music = ctx.createGain(); this._music.gain.value = .72;
    this._music.connect(this._master);
    this._persistent.push(this._master, limiter, this._music);

    this._noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const samples = this._noise.getChannelData(0);
    let drift = 0;
    for (let i = 0; i < samples.length; i++) {
      drift = (drift + (Math.random() * 2 - 1) * .035) / 1.035;
      samples[i] = drift * 3.3 + (Math.random() * 2 - 1) * .1;
    }
    // Match the loop endpoints so quiet wind/water never acquire a periodic
    // click at the buffer seam.
    const seam = samples[samples.length - 1] - samples[0];
    let mean = 0;
    for (let i = 0; i < samples.length; i++) { samples[i] -= seam * i / (samples.length - 1); mean += samples[i]; }
    mean /= samples.length;
    for (let i = 0; i < samples.length; i++) samples[i] -= mean;
    const wind = this._noiseBed(.012, 'lowpass', 480, .4, 0);
    this._wind = wind.gain; this._windFilter = wind.filter;
    this._water = this._noiseBed(0, 'bandpass', 1300, .4, .9).gain;
    this._nextBird = ctx.currentTime + 7;
  }

  _noiseBed(volume, type, frequency, q, offset) {
    const ctx = this.context, source = ctx.createBufferSource();
    source.buffer = this._noise; source.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = type;
    filter.frequency.value = frequency; filter.Q.value = q;
    const gain = ctx.createGain(); gain.gain.value = volume;
    source.connect(filter); filter.connect(gain); gain.connect(this._master);
    source.start(0, offset); this._persistent.push(source, filter, gain);
    return { gain, filter };
  }

  _sceneMood() {
    if (this._journey.mode === 'sleep') return 'night';
    if (this._journey.mode === 'snack') return 'rest';
    if (Number(this._scene.night) > .55) return 'night';
    if (this._scene.season === 'winter') return 'winter';
    return this._scene.biome?.id || this._scene.biome || 'forest';
  }

  _chooseTrack(skipCurrent = false) {
    const now = this.context?.currentTime || 0, mood = this._sceneMood();
    const choices = MUSIC_TRACKS.filter(t => (!skipCurrent || t.id !== this._active?.track.id)
      && (this._failedUntil.get(t.id) || 0) <= now);
    if (!choices.length) return null;
    return choices.sort((a, b) => {
      const score = t => (t.moods.includes(mood) ? 6 : 0)
        - (t.id === this._active?.track.id ? 10 : 0)
        - (this._recent.includes(t.id) ? 2 * (this._recent.indexOf(t.id) + 1) : 0);
      return score(b) - score(a) || MUSIC_TRACKS.indexOf(a) - MUSIC_TRACKS.indexOf(b);
    })[0].id;
  }

  async _queueTrack(id) {
    if (!id || !TRACKS.has(id) || this._disposed || this._pending || this._retiring) return false;
    if (this._active?.track.id === id) return false;
    const request = { id, controller: new AbortController() };
    this._pending = request; this._queuedTrack = null; this._loadState = 'loading';
    try {
      let buffer = this._buffers.get(id);
      if (!buffer) {
        // Evict inactive audio before decoding another recording, so memory is
        // bounded even after hours of walking and repeated skip requests.
        for (const key of this._buffers.keys()) if (key !== this._active?.track.id) this._buffers.delete(key);
        const url = new URL(`../assets/audio/${TRACKS.get(id).file}`, import.meta.url);
        const response = await this._fetch(url, { signal: request.controller.signal });
        if (!response.ok) throw new Error(`Music request ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (this._disposed || this._pending !== request) return false;
        buffer = await this.context.decodeAudioData(bytes);
        if (this._disposed || this._pending !== request) return false;
        this._buffers.set(id, buffer);
      }
      this._pending = null;
      if (!this.enabled) { this._queuedTrack = id; this._loadState = 'ready'; return true; }
      this._beginTrack(TRACKS.get(id), buffer);
      return true;
    } catch (error) {
      if (this._pending === request) this._pending = null;
      if (this._disposed || error.name === 'AbortError') return false;
      this._failedUntil.set(id, (this.context?.currentTime || 0) + 45);
      this._loadState = this._active ? 'playing' : 'unavailable';
      // One missing file must not silence the whole journey. A later frame
      // tries the next available recording; failures are backed off per file.
      return false;
    }
  }

  _beginTrack(track, buffer) {
    const ctx = this.context, now = ctx.currentTime;
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer; source.connect(gain); gain.connect(this._music);
    const voice = { track, source, gain, start: now, duration: buffer.duration, retired: false };
    const fade = this._active ? Math.min(FADE_SECONDS, Math.max(.4, this._active.start + this._active.duration - now)) : 2;
    voice.fadeSeconds = fade;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);
    if (this._active) {
      const old = this._active;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(clamp((now - old.start) / old.fadeSeconds, 0, 1), now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      old.retired = true; this._retiring = old;
      old.source.stop(now + fade + .05);
    }
    source.onended = () => {
      try { source.disconnect(); gain.disconnect(); } catch { /* Already disposed. */ }
      this._musicVoices.delete(voice);
      if (this._retiring === voice) this._retiring = null;
      if (this._active === voice) this._active = null;
      if (this._active?.track.id !== track.id && this._pending?.id !== track.id) this._buffers.delete(track.id);
    };
    this._active = voice; this._musicVoices.add(voice);
    this._recent = [...this._recent.filter(id => id !== track.id), track.id].slice(-3);
    this._loadState = 'playing'; source.start(now);
  }

  // Called from the field notes' "Another tune" button. Repeated taps during a
  // download/fade do not spawn extra sources or fetches.
  async nextTrack() {
    if (this._disposed || !this.enabled) return false;
    if (!await this.start()) return false;
    return this._queueTrack(this._chooseTrack(true));
  }

  update(scene = {}, _walking = false, journey = {}) {
    this._scene = scene; this._journey = journey;
    const ctx = this.context;
    if (!this.enabled || this._disposed || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime, mood = this._sceneMood();
    if (mood !== this._mood) { this._mood = mood; this._moodSince = now; }
    const night = clamp(Number(scene.night) || 0, 0, 1);
    const biome = String(scene.biome?.id || scene.biome || 'forest');
    const mountain = biome === 'mountain', water = ['stream', 'swamp'].includes(biome);
    const rain = scene.weather === 'rain';
    if (now - this._lastAmbience > .9) {
      this._lastAmbience = now;
      this._wind.gain.setTargetAtTime(mountain ? .023 : rain ? .022 : .009, now, 2);
      this._windFilter.frequency.setTargetAtTime(mountain ? 750 : 440, now, 2);
      this._water.gain.setTargetAtTime(water ? .039 : rain ? .026 : 0, now, 2);
      this._music.gain.setTargetAtTime(journey.mode === 'sleep' ? .48 : .72, now, 2);
    }
    if (!this._pending && !this._retiring) {
      if (!this._active) this._queueTrack(this._queuedTrack || this._chooseTrack());
      else {
        const played = now - this._active.start, remaining = this._active.duration - played;
        const changedMood = played > MIN_MOOD_SECONDS && now - this._moodSince > 10
          && !this._active.track.moods.includes(mood);
        if (remaining <= 12 || changedMood) this._queueTrack(this._chooseTrack(true));
      }
    }
    if (now >= this._nextBird) {
      this._nextBird = now + 15 + Math.random() * 18;
      if (!rain && !mountain && night < .55) this._chirp(now, .7);
      else if (!rain && !mountain && night > .7) this._owl(now, .6);
    }
  }

  react(sound, metadata = {}) {
    const ctx = this.context;
    if (!this.enabled || this._disposed || !ctx || ctx.state !== 'running') return false;
    const now = ctx.currentTime;
    if (now - this._lastReaction < .3) return false;
    this._lastReaction = now;
    const pan = clamp(Number(metadata.pan) || 0, -.8, .8);
    if (['chirp', 'bird', 'eagle'].includes(sound)) this._chirp(now, 1, pan);
    else if (['hoot', 'owl'].includes(sound)) this._owl(now, 1, pan);
    else if (['neigh', 'horse'].includes(sound)) {
      for (let i = 0; i < 5; i++) this._tone({ frequency: 480 + Math.sin(i * 1.3) * 115,
        endFrequency: 390 - i * 30, at: now + i * .09, duration: .24, volume: .022,
        pan, type: 'triangle', attack: .04, cutoff: 1500 });
    } else if (sound === 'howl') {
      this._tone({ frequency: 330, endFrequency: 230, at: now, duration: 1.2, volume: .035, pan, attack: .25 });
      this._tone({ frequency: 665, endFrequency: 465, at: now + .08, duration: 1, volume: .01, pan, attack: .25 });
    } else if (['croak', 'frog'].includes(sound)) {
      for (let i = 0; i < 3; i++) this._tone({ frequency: 260 - i * 20, endFrequency: 120,
        at: now + i * .17, duration: .12, volume: .025, type: 'triangle', pan, cutoff: 700 });
    } else if (['chime', 'magic'].includes(sound)) {
      for (let i = 0; i < 3; i++) this._tone({ frequency: [523, 784, 1047][i], at: now + i * .11,
        duration: .65, volume: .017, attack: .025, pan });
    } else if (['huff', 'snort', 'growl', 'quack', 'bleat'].includes(sound)) {
      const pitch = sound === 'bleat' ? 360 : sound === 'quack' ? 420 : 150;
      this._tone({ frequency: pitch, endFrequency: pitch * .65, at: now, duration: .22,
        volume: .022, type: 'triangle', attack: .035, pan, cutoff: 950 });
      this._noiseEffect(now + .02, .18, .05, 600, pan);
    } else if (sound === 'splash') this._noiseEffect(now, .5, .11, 1700, pan);
    else if (['rustle', 'flutter', 'wing'].includes(sound)) this._noiseEffect(now, .28, .055, 1000, pan);
    else return false;
    return true;
  }

  _tone({ frequency, at, duration, volume, attack = .015, pan = 0, endFrequency, type = 'sine', cutoff }) {
    if (this._voices.size >= MAX_EFFECTS) return;
    const ctx = this.context, source = ctx.createOscillator(), envelope = ctx.createGain();
    source.type = type; source.frequency.setValueAtTime(frequency, at);
    if (endFrequency) source.frequency.exponentialRampToValueAtTime(endFrequency, at + duration * .8);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + Math.min(attack, duration / 3));
    envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (panner.pan) panner.pan.value = pan;
    const nodes = [source, envelope, panner];
    if (cutoff) {
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = cutoff;
      source.connect(filter); filter.connect(envelope); nodes.push(filter);
    } else source.connect(envelope);
    envelope.connect(panner); panner.connect(this._master);
    const voice = { source, nodes }; this._voices.add(voice);
    source.onended = () => this._cleanVoice(voice);
    source.start(at); source.stop(at + duration + .03);
  }

  _noiseEffect(at, duration, volume, frequency, pan) {
    if (this._voices.size >= MAX_EFFECTS) return;
    const ctx = this.context, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
    source.buffer = this._noise; filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = .45;
    const gain = ctx.createGain(); gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + .035);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (panner.pan) panner.pan.value = pan;
    source.connect(filter); filter.connect(gain); gain.connect(panner); panner.connect(this._master);
    const voice = { source, nodes: [source, filter, gain, panner] }; this._voices.add(voice);
    source.onended = () => this._cleanVoice(voice);
    source.start(at, .5); source.stop(at + duration + .03);
  }

  _chirp(now, volume = 1, pan = (Math.random() - .5) * 1.5) {
    const pitch = 2100 + Math.random() * 900;
    this._tone({ frequency: pitch, endFrequency: pitch * 1.35, at: now, duration: .14, volume: .011 * volume, pan });
    this._tone({ frequency: pitch * 1.12, endFrequency: pitch * .9, at: now + .22, duration: .17, volume: .009 * volume, pan });
  }
  _owl(now, volume = 1, pan = (Math.random() - .5) * 1.4) {
    this._tone({ frequency: 420, endFrequency: 375, at: now, duration: .42, volume: .018 * volume, attack: .12, pan });
    this._tone({ frequency: 390, endFrequency: 355, at: now + .65, duration: .62, volume: .013 * volume, attack: .14, pan });
  }
  _cleanVoice(voice) {
    this._voices.delete(voice);
    for (const node of voice.nodes) { try { node.disconnect(); } catch { /* Already disconnected. */ } }
  }
  _stopEffect(voice) {
    try { voice.source.stop(); } catch { /* Already stopped. */ }
    this._cleanVoice(voice);
  }
  dispose() {
    if (this._disposed) return;
    this._disposed = true; this.enabled = false;
    if (this._suspendTimer !== null) clearTimeout(this._suspendTimer);
    this._pending?.controller.abort(); this._pending = null;
    for (const voice of [...this._voices]) this._stopEffect(voice);
    for (const voice of this._musicVoices) {
      voice.retired = true;
      try { voice.source.stop(); voice.source.disconnect(); voice.gain.disconnect(); } catch { /* Ended. */ }
    }
    this._musicVoices.clear(); this._buffers.clear(); this._active = this._retiring = null;
    for (const node of this._persistent) {
      if (typeof node.stop === 'function') { try { node.stop(); } catch { /* Ended. */ } }
      try { node.disconnect(); } catch { /* Closed. */ }
    }
    this._persistent.length = 0; this._noise = null; this._loadState = 'idle';
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
  }
}
