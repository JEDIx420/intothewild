import { riverAt } from './world.js';

// Original, melodic forest score and grounded footsteps. No downloads or timers.
const BEAT = 60 / 68;
const CHORDS = [
  [48, 55, 60, 64, 71], [45, 52, 57, 60, 67],
  [41, 48, 53, 57, 64], [43, 50, 55, 59, 62],
];
const MELODIES = [
  [72, null, 76, 74, 72, null, 67, 69],
  [69, null, 72, null, 76, 74, 72, null],
  [69, null, 67, 64, 65, null, 69, 72],
  [71, null, 69, null, 67, 62, 67, null],
  [76, null, 79, 76, 74, null, 72, null],
  [72, null, 69, 67, 64, null, 69, null],
  [65, null, 69, 72, 76, null, 72, 69],
  [67, null, 71, null, 74, 71, 67, null],
];
const frequencyOf = note => 440 * 2 ** ((note - 69) / 12);
// start() belongs in a user gesture; update() can be called by the game loop.
export class ForestAudio {
  constructor() {
    this.enabled = false;
    this.context = null;
    this._master = null;
    this._noise = null;
    this._wind = null;
    this._water = null;
    this._insects = null;
    this._windFilter = null;
    this._reverb = null;
    this._reverbInput = null;
    this._persistent = [];
    this._voices = new Set();
    this._nextBird = 0;
    this._nextMusicTick = 0;
    this._musicTick = 0;
    this._music = null;
    this._nextStep = 0;
    this._lastAmbience = -Infinity;
    this._lastStepIndex = null;
    this._walking = false;
    this._stepSide = 1;
    this._disposed = false;
    this._starting = null;
  }

  async start() {
    if (this._disposed) return false;
    if (this._starting) return this._starting;
    this._starting = this._startContext();
    try { return await this._starting; }
    finally { this._starting = null; }
  }

  async _startContext() {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return false;
    try {
      if (!this.context) {
        this.context = new AudioContextClass({ latencyHint: 'interactive' });
        this._buildGraph();
      }
      if (this.context.state !== 'running' && this.context.state !== 'closed') await this.context.resume();
      this.setEnabled(this.enabled);
      return this.context.state === 'running';
    } catch {
      return false;
    }
  }

  setEnabled(value) {
    const enabled = Boolean(value), changed = enabled !== this.enabled;
    this.enabled = enabled;
    if (!this.context || !this._master || this._disposed) return;
    const now = this.context.currentTime;
    this._master.gain.cancelScheduledValues(now);
    this._master.gain.setTargetAtTime(this.enabled ? 0.62 : 0, now, 0.1);
    if (this.enabled) {
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
      if (changed) {
        this._nextBird = now + 1.4;
        this._nextMusicTick = now + 0.1;
        this._musicTick = Math.ceil(this._musicTick / 8) * 8;
        this._lastStepIndex = null;
      }
    } else if (changed) {
      // Retire notes when hidden/muted; a return never catches up old beats.
      for (const voice of this._voices) {
        try { voice.source.stop(now + 0.25); } catch { /* Already ended. */ }
      }
      this._walking = false;
      this._lastStepIndex = null;
    }
  }

  _buildGraph() {
    const ctx = this.context;
    this._master = ctx.createGain();
    this._master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 18;
    limiter.ratio.value = 3;
    limiter.attack.value = 0.008;
    limiter.release.value = 0.25;
    this._master.connect(limiter);
    limiter.connect(ctx.destination);
    this._music = ctx.createGain();
    this._music.gain.value = 1;
    this._music.connect(this._master);
    this._persistent.push(this._master, limiter, this._music);

    this._noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 3), ctx.sampleRate);
    const samples = this._noise.getChannelData(0);
    let drift = 0;
    for (let i = 0; i < samples.length; i++) {
      drift = (drift + (Math.random() * 2 - 1) * 0.035) / 1.035;
      samples[i] = drift * 3.8 + (Math.random() * 2 - 1) * 0.13;
    }

    const wind = this._noiseBed(0.055, 'lowpass', 620, 0.55, 0);
    this._wind = wind.gain;
    this._windFilter = wind.filter;
    const water = this._noiseBed(0, 'bandpass', 1350, 0.35, 0.9);
    this._water = water.gain;
    const insects = this._noiseBed(0, 'bandpass', 3300, 4, 1.6);
    this._insects = insects.gain;

    const breeze = ctx.createOscillator();
    breeze.type = 'sine';
    breeze.frequency.value = 0.09;
    const breezeDepth = ctx.createGain();
    breezeDepth.gain.value = 0.009;
    breeze.connect(breezeDepth);
    breezeDepth.connect(this._wind.gain);
    breeze.start();
    this._persistent.push(breeze, breezeDepth);

    // An original generated impulse adds a small, soft tail to each note.
    const impulse = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * 1.7), ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      let smoothed = 0;
      for (let i = 0; i < data.length; i++) {
        smoothed = smoothed * 0.72 + (Math.random() * 2 - 1) * 0.28;
        data[i] = smoothed * Math.pow(1 - i / data.length, 3.5);
      }
    }
    this._reverb = ctx.createConvolver();
    this._reverb.buffer = impulse;
    this._reverbInput = ctx.createGain();
    this._reverbInput.gain.value = 0.22;
    this._reverbInput.connect(this._reverb);
    this._reverb.connect(this._master);
    this._persistent.push(this._reverbInput, this._reverb);

    const now = ctx.currentTime;
    this._nextBird = now + 2;
    this._nextMusicTick = now + 0.1;
    this._nextStep = now;
  }

  _noiseBed(volume, type, frequency, q, offset) {
    const ctx = this.context;
    const source = ctx.createBufferSource();
    source.buffer = this._noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this._master);
    source.start(0, offset);
    this._persistent.push(source, filter, gain);
    return { gain, filter };
  }

  update(scene = {}, walking = false, journey = {}) {
    const ctx = this.context;
    if (!this.enabled || this._disposed || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const hour = Number.isFinite(scene.hour) ? scene.hour : 10;
    const night = typeof scene.night === 'number'
      ? Math.max(0, Math.min(1, scene.night))
      : typeof scene.night === 'boolean' ? Number(scene.night) : (hour < 6 || hour >= 19 ? 1 : 0);
    const biome = String(scene.biome?.id || scene.biome || 'forest').toLowerCase();
    const weather = String(scene.weather?.type || scene.weather || 'clear').toLowerCase();
    const mountain = /mountain|pass|ridge|alpine|peak/.test(biome);
    const stream = /stream|river|creek|water|marsh/.test(biome);
    const rain = /rain|storm|drizzle/.test(weather);

    if (now - this._lastAmbience > 0.9) {
      this._lastAmbience = now;
      this._wind.gain.setTargetAtTime(mountain ? 0.075 : rain ? 0.065 : 0.045, now, 2);
      this._windFilter.frequency.setTargetAtTime(mountain ? 820 : 530, now, 2);
      this._water.gain.setTargetAtTime(stream ? 0.1 : rain ? 0.07 : 0, now, 2);
      this._music.gain.setTargetAtTime(journey.mode === 'sleep' ? 0.6 : night > 0.5 ? 0.85 : 1, now, 1.5);
      this._insects.gain.setTargetAtTime(mountain ? 0 : night * 0.009, now, 2.5);
    }

    if (now >= this._nextBird) {
      this._nextBird = now + (night > 0.65 ? 11 : 5) + Math.random() * 10;
      if (!rain && (!mountain || Math.random() > 0.5)) {
        if (night > 0.65) this._owl(now);
        else this._chirp(now);
      }
    }
    // A short lookahead preserves rhythm without queuing a long soundtrack.
    if (this._nextMusicTick < now - 0.4) {
      this._nextMusicTick = now + 0.04;
      this._musicTick = Math.ceil(this._musicTick / 8) * 8;
    }
    while (this._nextMusicTick < now + 0.16) {
      this._score(this._nextMusicTick, this._musicTick++, night);
      this._nextMusicTick += BEAT / 2;
    }
    const distance = journey.distance;
    if (walking) {
      // Traveller plants a foot every PI of its distance * 6.1 gait.
      const stepIndex = Number.isFinite(distance) ? Math.floor((distance * 6.1 - Math.PI / 2) / Math.PI) : null;
      const contact = stepIndex === null ? now >= this._nextStep
        : this._lastStepIndex !== null && stepIndex > this._lastStepIndex;
      if (contact) {
        const river = Number.isFinite(distance) ? riverAt(distance, journey.seed) : null;
        const bridge = river && Math.abs(distance - river.center) < river.width / 2 + 0.55;
        const surface = bridge ? 'wood' : scene.season === 'winter' ? 'snow' : mountain ? 'stone' : 'earth';
        this._footstep(now, surface);
        this._nextStep = now + 0.45;
      }
      this._lastStepIndex = stepIndex;
    } else {
      this._lastStepIndex = null;
      this._nextStep = now;
    }
    this._walking = walking;
  }

  _score(at, tick, night) {
    const bar = Math.floor(tick / 8), slot = tick % 8;
    const chord = CHORDS[bar % CHORDS.length];
    if (slot === 0) {
      // Warm, softly strummed harmony beneath an eight-bar original motif.
      this._tone({ frequency: frequencyOf(chord[0]), at, duration: BEAT * 4.5, volume: 0.064, attack: 0.11, music: true });
      for (let n = 1; n < chord.length; n++) {
        this._tone({ frequency: frequencyOf(chord[n]), at: at + n * 0.035,
          duration: BEAT * 4.7, volume: 0.027, attack: 0.28,
          pan: (n - 2.5) * 0.13, reverb: true, music: true });
      }
    }
    const note = MELODIES[bar % MELODIES.length][slot];
    if (note === null || (night > 0.7 && slot === 3)) return;
    this._tone({ frequency: frequencyOf(note - (night > 0.7 ? 12 : 0)), at,
      duration: BEAT * 2.8, volume: slot === 0 ? 0.14 : 0.11,
      attack: 0.012, pan: Math.sin(bar * 1.3 + slot) * 0.16,
      reverb: true, music: true, type: 'triangle', cutoff: 2300 });
    if (slot === 0 && bar % 4 === 0) {
      this._tone({ frequency: frequencyOf(note + 12), at: at + BEAT / 2,
        duration: BEAT * 3, volume: 0.018, attack: 0.04,
        pan: -0.25, music: true, reverb: true });
    }
  }

  _tone({ frequency, at, duration, volume, attack = 0.015, pan = 0, endFrequency, reverb = false, music = false, type = 'sine', cutoff }) {
    if (this._voices.size >= (music ? 36 : 48)) return;
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration * 0.7);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + Math.min(attack, duration / 3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (panner.pan) panner.pan.value = pan;
    const nodes = [oscillator, envelope, panner];
    if (cutoff) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = cutoff; filter.Q.value = 0.4;
      oscillator.connect(filter); filter.connect(envelope); nodes.push(filter);
    } else oscillator.connect(envelope);
    envelope.connect(panner);
    panner.connect(music ? this._music : this._master);
    if (reverb) envelope.connect(this._reverbInput);
    const voice = { source: oscillator, nodes };
    this._voices.add(voice);
    oscillator.onended = () => this._cleanVoice(voice);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.03);
  }

  _chirp(now) {
    const pan = (Math.random() - 0.5) * 1.5;
    const pitch = 1900 + Math.random() * 1000;
    this._tone({ frequency: pitch, endFrequency: pitch * 1.5, at: now, duration: 0.13, volume: 0.018, pan });
    this._tone({ frequency: pitch * 1.2, endFrequency: pitch * 0.9, at: now + 0.2, duration: 0.18, volume: 0.014, pan });
    if (Math.random() > 0.5) this._tone({ frequency: pitch * 1.05, endFrequency: pitch * 1.35, at: now + 0.48, duration: 0.12, volume: 0.012, pan });
  }

  _owl(now) {
    const pan = (Math.random() - 0.5) * 1.4;
    this._tone({ frequency: 430, endFrequency: 380, at: now, duration: 0.42, volume: 0.018, attack: 0.12, pan, reverb: true });
    this._tone({ frequency: 390, endFrequency: 360, at: now + 0.62, duration: 0.65, volume: 0.014, attack: 0.14, pan, reverb: true });
  }

  _footstep(now, surface = 'earth') {
    if (this._voices.size >= 44) return;
    const ctx = this.context;
    const settings = {
      earth: { cut: 1050, volume: 0.28, duration: 0.14, thump: 130 },
      stone: { cut: 1900, volume: 0.23, duration: 0.09, thump: 210 },
      wood: { cut: 780, volume: 0.19, duration: 0.11, thump: 175 },
      snow: { cut: 2250, volume: 0.22, duration: 0.22, thump: 105 },
    }[surface];
    this._stepSide *= -1;
    const source = ctx.createBufferSource();
    source.buffer = this._noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = settings.cut * (0.94 + Math.random() * 0.12);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(settings.volume, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + settings.duration);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (panner.pan) panner.pan.value = this._stepSide * 0.12;
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(panner);
    panner.connect(this._master);
    const voice = { source, nodes: [source, filter, envelope, panner] };
    this._voices.add(voice);
    source.onended = () => this._cleanVoice(voice);
    source.start(now, Math.random() * 2);
    source.stop(now + settings.duration + 0.02);
    // A restrained sole impact makes steps audible on small phone speakers.
    this._tone({ frequency: settings.thump, endFrequency: settings.thump * 0.62,
      at: now, duration: surface === 'wood' ? 0.16 : 0.1,
      volume: surface === 'snow' ? 0.025 : 0.055, attack: 0.005, pan: this._stepSide * 0.12 });
    if (surface === 'wood') this._tone({ frequency: 430, endFrequency: 330,
      at: now + 0.005, duration: 0.08, volume: 0.02, attack: 0.003 });
  }

  _cleanVoice(voice) {
    this._voices.delete(voice);
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* Already disconnected during disposal. */ }
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.enabled = false;
    for (const voice of [...this._voices]) {
      try { voice.source.stop(); } catch { /* Source may already have ended. */ }
      this._cleanVoice(voice);
    }
    for (const node of this._persistent) {
      if (typeof node.stop === 'function') {
        try { node.stop(); } catch { /* Source may already have ended. */ }
      }
      try { node.disconnect(); } catch { /* Context may already be closed. */ }
    }
    this._persistent.length = 0;
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
    this._noise = null;
  }
}
