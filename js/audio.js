// Original, quiet procedural ambience. No samples, network requests or timers.
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
    this._nextNote = 0;
    this._nextStep = 0;
    this._lastAmbience = -Infinity;
    this._lastNote = 0;
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
      if (this.context.state === 'suspended') await this.context.resume();
      this.setEnabled(this.enabled);
      return this.context.state === 'running';
    } catch {
      return false;
    }
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    if (!this.context || !this._master || this._disposed) return;
    const now = this.context.currentTime;
    this._master.gain.cancelScheduledValues(now);
    this._master.gain.setTargetAtTime(this.enabled ? 0.24 : 0, now, 0.15);
    if (this.enabled) {
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
      // Resume into the forest first; musical notes arrive a little later.
      this._nextBird = Math.max(this._nextBird, now + 1.8);
      this._nextNote = Math.max(this._nextNote, now + 3.4);
    }
  }

  _buildGraph() {
    const ctx = this.context;
    this._master = ctx.createGain();
    this._master.gain.value = 0;
    this._master.connect(ctx.destination);
    this._persistent.push(this._master);

    this._noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 3), ctx.sampleRate);
    const samples = this._noise.getChannelData(0);
    let drift = 0;
    for (let i = 0; i < samples.length; i++) {
      drift = (drift + (Math.random() * 2 - 1) * 0.035) / 1.035;
      samples[i] = drift * 3.8 + (Math.random() * 2 - 1) * 0.13;
    }

    const wind = this._noiseBed(0.042, 'lowpass', 620, 0.55, 0);
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
    this._nextNote = now + 3.5;
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

  update(scene = {}, walking = false) {
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
      this._wind.gain.setTargetAtTime(mountain ? 0.073 : rain ? 0.055 : 0.038, now, 2);
      this._windFilter.frequency.setTargetAtTime(mountain ? 820 : 530, now, 2);
      this._water.gain.setTargetAtTime(stream ? 0.071 : rain ? 0.047 : 0, now, 2);
      this._insects.gain.setTargetAtTime(mountain ? 0 : night * 0.009, now, 2.5);
    }

    if (now >= this._nextBird) {
      this._nextBird = now + (night > 0.65 ? 11 : 5) + Math.random() * 10;
      if (!rain && (!mountain || Math.random() > 0.5)) {
        if (night > 0.65) this._owl(now);
        else this._chirp(now);
      }
    }
    if (now >= this._nextNote) {
      this._nextNote = now + 6.5 + Math.random() * 7;
      const notes = night > 0.5 ? [55, 57, 60, 62, 64, 67] : [60, 62, 64, 67, 69, 72];
      let note = notes[Math.floor(Math.random() * notes.length)];
      if (note === this._lastNote) note = notes[(notes.indexOf(note) + 2) % notes.length];
      this._lastNote = note;
      const frequency = 440 * Math.pow(2, (note - 69) / 12);
      this._tone({ frequency, at: now + 0.03, duration: 3.2, volume: 0.038, attack: 0.3, pan: (Math.random() - 0.5) * 0.65, reverb: true });
    }
    if (walking && now >= this._nextStep) {
      this._nextStep = now + 0.5;
      this._footstep(now);
    } else if (!walking) {
      this._nextStep = now;
    }
  }

  _tone({ frequency, at, duration, volume, attack = 0.015, pan = 0, endFrequency, reverb = false }) {
    if (this._voices.size >= 12) return;
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, at);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration * 0.7);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + Math.min(attack, duration / 3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (panner.pan) panner.pan.value = pan;
    oscillator.connect(envelope);
    envelope.connect(panner);
    panner.connect(this._master);
    if (reverb) envelope.connect(this._reverbInput);
    const voice = { source: oscillator, nodes: [oscillator, envelope, panner] };
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

  _footstep(now) {
    if (this._voices.size >= 12) return;
    const ctx = this.context;
    const source = ctx.createBufferSource();
    source.buffer = this._noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 650 + Math.random() * 160;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(0.035, now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this._master);
    const voice = { source, nodes: [source, filter, envelope] };
    this._voices.add(voice);
    source.onended = () => this._cleanVoice(voice);
    source.start(now, Math.random() * 2);
    source.stop(now + 0.15);
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
