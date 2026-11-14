import test from 'node:test';
import assert from 'node:assert/strict';
import { ForestAudio, MUSIC_TRACKS } from '../js/audio.js';

class Param {
  constructor(value = 0) { this.value = value; }
  setValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { assert.ok(v > 0); this.value = v; }
  cancelScheduledValues() {}
}
class Node {
  constructor(ctx) {
    this.ctx = ctx; this.gain = new Param(); this.frequency = new Param(); this.Q = new Param();
    this.pan = new Param(); this.threshold = new Param(); this.knee = new Param();
    this.ratio = new Param(); this.attack = new Param(); this.release = new Param();
  }
  connect() {}
  disconnect() { this.disconnected = true; }
  start(at = 0) { this.started = at; this.ctx.sources.add(this); }
  stop(at = this.ctx.currentTime) { this.stopAt = at; }
}
class Context {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 100; this.destination = {}; this.sources = new Set(); }
  createGain() { return new Node(this); }
  createDynamicsCompressor() { return new Node(this); }
  createBiquadFilter() { return new Node(this); }
  createStereoPanner() { return new Node(this); }
  createOscillator() { return new Node(this); }
  createBufferSource() { return new Node(this); }
  createBuffer(channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
  async decodeAudioData(bytes) { return { duration: 80 + new Uint8Array(bytes)[0] * 20 }; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
  advance(seconds) {
    if (this.state !== 'running') return;
    this.currentTime += seconds;
    for (const s of [...this.sources]) {
      const natural = s.buffer && !s.loop ? s.started + s.buffer.duration : Infinity;
      if (Math.min(s.stopAt ?? Infinity, natural) <= this.currentTime) {
        this.sources.delete(s); s.onended?.();
      }
    }
  }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup(fetchOverride) {
  const ctx = new Context(), requests = [];
  const audio = new ForestAudio({ contextFactory: () => ctx, fetch: fetchOverride || (async url => {
    requests.push(String(url));
    const index = MUSIC_TRACKS.findIndex(t => String(url).includes(t.file));
    return { ok: true, arrayBuffer: async () => new Uint8Array([index]).buffer };
  }) });
  return { ctx, audio, requests };
}

test('sound remains silent before a gesture; first recording uses a local asset', async () => {
  const { audio, requests } = setup();
  audio.update({ biome: 'forest' }, true, { distance: 15 });
  assert.equal(requests.length, 0);
  assert.equal(audio.context, null);
  assert.equal(await audio.start(), true);
  audio.setEnabled(true); await flush();
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/assets\/audio\/forest\.mp3$/);
  assert.equal(audio.currentTrack.title, 'Forest');
  assert.equal(audio._musicVoices.size, 1);
  audio.dispose();
});

test('rapid skip taps are coalesced and old music is released after a crossfade', async () => {
  const { audio, ctx, requests } = setup();
  await audio.start(); audio.setEnabled(true); await flush();
  const before = audio.currentTrack.id;
  await Promise.all([audio.nextTrack(), audio.nextTrack(), audio.nextTrack()]);
  await flush();
  assert.notEqual(audio.currentTrack.id, before);
  assert.equal(requests.length, 2);
  assert.equal(audio._musicVoices.size, 2);
  assert.equal(audio._buffers.size, 2);
  assert.equal(await audio.nextTrack(), false);
  ctx.advance(7);
  assert.equal(audio._musicVoices.size, 1);
  assert.equal(audio._buffers.size, 1);
  audio.dispose();
});

test('mute freezes playback and resume keeps the recording position', async () => {
  const { audio, ctx, requests } = setup();
  await audio.start(); audio.setEnabled(true); await flush();
  ctx.advance(21);
  const source = audio._active.source, track = audio.currentTrack.id;
  audio.setEnabled(false);
  assert.equal(audio._master.gain.value, 0);
  await new Promise(resolve => setTimeout(resolve, 210));
  assert.equal(ctx.state, 'suspended');
  ctx.advance(90);
  assert.equal(ctx.currentTime, 21);
  audio.setEnabled(true); await flush();
  assert.equal(ctx.state, 'running');
  assert.equal(audio._active.source, source);
  assert.equal(audio.currentTrack.id, track);
  assert.equal(requests.length, 1);
  audio.dispose();
});

test('walking does not schedule impact sounds; reactions are capped and muted safely', async () => {
  const { audio, ctx } = setup();
  await audio.start(); audio.setEnabled(true); await flush();
  audio._nextBird = Infinity;
  for (let i = 0; i < 80; i++) {
    ctx.advance(.1); audio.update({ biome: 'forest', night: 0 }, true, { distance: i, mode: 'walking' });
  }
  assert.equal(audio._voices.size, 0, 'no sounds are tied to steps/distance');
  for (let i = 0; i < 50; i++) {
    audio.react('neigh'); ctx.currentTime += .31;
    assert.ok(audio._voices.size <= 18);
  }
  audio.setEnabled(false);
  assert.equal(audio._voices.size, 0);
  assert.equal(audio.react('splash'), false);
  audio.dispose();
});

test('changing terrain briefly does not restart music, long journeys keep two buffers at most', async () => {
  const { audio, ctx } = setup();
  await audio.start(); audio.setEnabled(true); await flush();
  const initial = audio.currentTrack.id;
  audio.update({ biome: 'mountain' }, true, { mode: 'walking' });
  ctx.advance(4); audio.update({ biome: 'swamp' }, true, { mode: 'walking' });
  assert.equal(audio.currentTrack.id, initial);
  const played = new Set([initial]);
  for (let i = 0; i < 1000; i++) {
    ctx.advance(1);
    audio.update({ biome: ['forest', 'mountain', 'meadow', 'swamp'][Math.floor(i / 120) % 4], night: i % 300 > 230 ? 1 : 0 }, true, { mode: 'walking' });
    await flush();
    if (audio.currentTrack) played.add(audio.currentTrack.id);
    assert.ok(audio._buffers.size <= 2);
    assert.ok(audio._musicVoices.size <= 2);
    assert.ok(audio._voices.size <= 18);
  }
  assert.equal(played.size, 4);
  audio.dispose();
});

test('a failed recording backs off and the next one plays; disposing aborts downloads', async () => {
  let calls = 0;
  const { audio, ctx } = setup(async () => {
    calls++;
    return calls === 1 ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
  });
  await audio.start(); audio.setEnabled(true); await flush();
  assert.equal(audio.musicState, 'unavailable');
  audio.update({ biome: 'forest' }, false, {}); await flush();
  assert.equal(audio.musicState, 'playing');
  assert.equal(calls, 2);
  audio.dispose();
  assert.equal(ctx.state, 'closed');
  assert.equal(audio._buffers.size, 0);
  assert.equal(audio._musicVoices.size, 0);

  let requestSignal;
  const waiting = setup(async (url, { signal }) => {
    requestSignal = signal;
    await new Promise(resolve => signal.addEventListener('abort', resolve));
    throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
  });
  await waiting.audio.start(); waiting.audio.setEnabled(true);
  waiting.audio.dispose(); await flush();
  assert.equal(requestSignal.aborted, true);
  assert.equal(waiting.audio._musicVoices.size, 0);
});
