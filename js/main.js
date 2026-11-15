import { createJourney, stepJourney, setActivity, environment, serializeJourney, restoreJourney, trailProfileAt } from './world.js?v=6';
import { ForestScene } from './scene.js?v=6';
import { ForestAudio } from './audio.js?v=6';
import { SPECIES } from './bestiary.js?v=6';

const SOUND_KEY = 'into-the-wild.sound.v2';
const params = new URLSearchParams(location.search);
const requestedSeed = params.get('seed');
const seeded = requestedSeed !== null && /^\d{1,10}$/.test(requestedSeed);
// A shared seeded trail keeps its own save and never overwrites your main walk.
const SAVE_KEY = `into-the-wild.journey.v1${seeded ? `.seed.${Number(requestedSeed) >>> 0}` : ''}`;
let stored = null;
try { stored = localStorage.getItem(SAVE_KEY); } catch { /* A journey also works when browser storage is disabled. */ }
const state = stored ? restoreJourney(stored) : seeded ? createJourney(Number(requestedSeed) >>> 0) : createJourney();
// Music starts on a gesture; explicit mute is remembered across every trail.
let soundPreference = null;
try { soundPreference = localStorage.getItem(SOUND_KEY); } catch { /* Optional storage. */ }
state.sound = soundPreference !== 'off';
// Coming back to the trail never starts walking or sound without a gesture.
if (state.mode === 'walking') setActivity(state, 'paused');
if (state.rest?.nextMode === 'walking') state.rest.nextMode = 'paused';
const canvas = document.getElementById('c');
const scene = new ForestScene(canvas, state.seed);
const sceneResize = new ResizeObserver(entries => {
  const { width, height } = entries[0].contentRect;
  scene.resize(width, height);
});
sceneResize.observe(canvas.parentElement);
const audio = new ForestAudio();
const ui = Object.fromEntries([
  'walk', 'walk-label', 'snack', 'sleep', 'sound', 'sound-label', 'journal-open', 'journal',
  'journal-close', 'sightings', 'biome-label', 'time-label', 'season-label', 'distance-label', 'status',
  'journey-note', 'sleep-overlay',
  'wildlife-targets', 'interaction-ripple', 'track-name', 'music-next', 'sightings-count',
].map(id => [id, document.getElementById(id)]));
const wildlifeButtons = new Map();
let last = 0, accumulator = 0, uiTimer = 0, saveTimer = 0;
let soundUnlocked = false, statusUntil = 0, lastStatus = '', lastMode = state.mode;
let soundRequest = null;
let rendered = 0, renderTotal = 0, renderMax = 0;
let environmentNow = environment(state);

function acknowledge(reaction, target) {
  if (!reaction) return;
  status(reaction.message, 6);
  if (SPECIES[reaction.species] && !state.seen.includes(reaction.species)) state.seen.push(reaction.species);
  if (state.sound) {
    unlockSound().then(() => audio.react?.(reaction.sound, reaction));
  }
  if (target) {
    ui['interaction-ripple'].style.left = `${target.cssX}px`;
    ui['interaction-ripple'].style.top = `${target.cssY}px`;
    ui['interaction-ripple'].getAnimations().forEach(animation => animation.cancel());
    ui['interaction-ripple'].animate([
      { opacity: .65, transform: 'translate(-50%, -50%) scale(.45)' },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1.5)' },
    ], { duration: 650, easing: 'ease-out' });
  }
  save();
}

function syncWildlifeTargets() {
  const targets = scene.hitTargets || [];
  const present = new Set();
  for (const [order, target] of targets.entries()) {
    present.add(target.id);
    let button = wildlifeButtons.get(target.id);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button'; button.className = 'wildlife-target';
      button.setAttribute('aria-label', `Interact with ${target.name}`);
      button.dataset.label = target.name;
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (ui.journal.open || state.mode === 'sleep') return;
        const current = scene.hitTargets.find(item => item.id === target.id);
        if (!current) return;
        const rect = canvas.getBoundingClientRect();
        const reaction = event.detail > 0
          ? scene.interactAt(event.clientX - rect.left, event.clientY - rect.top, state)
          : scene.interactEntity(target.id, state);
        const reactedTarget = scene.hitTargets.find(item => item.id === reaction?.id) || current;
        acknowledge(reaction, reactedTarget);
      });
      ui['wildlife-targets'].append(button); wildlifeButtons.set(target.id, button);
    }
    const size = Math.min(76, Math.max(40, target.radius * 2 || 40));
    button.style.width = `${size}px`; button.style.height = `${size}px`;
    button.style.left = `${target.cssX}px`; button.style.top = `${target.cssY}px`;
    button.style.zIndex = String(targets.length - order);
    button.disabled = state.mode === 'sleep';
  }
  for (const [id, button] of wildlifeButtons) if (!present.has(id)) {
    button.remove(); wildlifeButtons.delete(id);
  }
}

function save() {
  try { localStorage.setItem(SAVE_KEY, serializeJourney(state)); } catch { /* Storage is optional. */ }
}
function status(text, hold = 0) {
  if (text !== lastStatus) { ui.status.textContent = text; lastStatus = text; }
  statusUntil = state.elapsed + hold;
}
function activity(mode) {
  if (ui.journal.open) return;
  const intended = state.rest?.phase === 'exit' ? state.rest.nextMode : state.mode;
  setActivity(state, intended === mode && mode !== 'walking' ? 'paused' : mode);
  statusUntil = 0; renderUI(); save();
  if (state.sound) unlockSound();
}
function toggleWalk() {
  activity(state.mode === 'walking' || state.rest?.nextMode === 'walking' ? 'paused' : 'walking');
}
async function unlockSound() {
  if (!state.sound) return false;
  if (soundRequest) return soundRequest;
  soundRequest = (async () => {
    try {
      const started = await audio.start();
      soundUnlocked = started;
      audio.setEnabled(state.sound && started && !document.hidden);
      if (!started) status('Tap the sound button when you are ready to listen.', 4);
      return started;
    } catch { soundUnlocked = false; audio.setEnabled(false); return false; }
  })();
  try { return await soundRequest; }
  finally { soundRequest = null; renderUI(); }
}
async function toggleSound() {
  if (state.sound && !soundUnlocked && !soundRequest) await unlockSound();
  else {
    state.sound = !state.sound;
    if (state.sound) await unlockSound();
    else audio.setEnabled(false);
  }
  try { localStorage.setItem(SOUND_KEY, state.sound ? 'on' : 'off'); } catch { /* Optional storage. */ }
  renderUI(); save();
}
function renderNotes() {
  ui.sightings.replaceChildren();
  const kinds = state.seen.filter(key => SPECIES[key]);
  ui['sightings-count'].textContent = `${kinds.length} of ${Object.keys(SPECIES).length} inhabitants discovered`;
  if (!kinds.length) {
    const empty = document.createElement('p'); empty.className = 'journal-empty';
    empty.textContent = 'A fresh page. The forest will fill it.';
    ui.sightings.append(empty); return;
  }
  for (const kind of kinds) {
    const row = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('small');
    title.textContent = SPECIES[kind].name;
    detail.textContent = SPECIES[kind].note || SPECIES[kind].description || `At home in ${SPECIES[kind].biomes.join(', ')}.`;
    detail.style.display = 'block'; row.append(title, detail); ui.sightings.append(row);
  }
}
function openJournal() {
  renderNotes();
  if (!ui.journal.open) ui.journal.showModal();
}
function closeJournal() { ui.journal.close(); ui['journal-open'].focus(); }
function renderUI() {
  const env = environmentNow = environment(state);
  const trail = trailProfileAt(state.distance, state.seed);
  const rest = state.rest;
  const walking = state.mode === 'walking';
  const walkingNext = rest?.phase === 'exit' && rest.nextMode === 'walking';
  ui.walk.setAttribute('aria-pressed', String(walking || walkingNext));
  ui['walk-label'].textContent = walking ? 'Pause a moment' : walkingNext ? 'Cancel walking'
    : state.distance > .1 ? 'Keep wandering' : 'Begin wandering';
  ui.snack.setAttribute('aria-pressed', String(rest?.phase === 'exit' ? rest.nextMode === 'snack' : state.mode === 'snack'));
  ui.sleep.setAttribute('aria-pressed', String(rest?.phase === 'exit' ? rest.nextMode === 'sleep' : state.mode === 'sleep'));
  const audible = state.sound && soundUnlocked;
  ui.sound.setAttribute('aria-pressed', String(audible));
  ui.sound.setAttribute('aria-label', audible ? 'Turn off sound' : 'Turn on sound');
  ui.sound.title = audible ? 'Music and forest sounds · M' : state.sound ? 'Sound starts with your first step. Tap to listen now.' : 'Turn on music and forest sounds · M';
  ui['sound-label'].textContent = audible ? 'Sound on' : state.sound ? 'Sound on your first step' : 'Sound off';
  const track = audio.currentTrack;
  ui['track-name'].textContent = track ? `${track.title}${track.artist ? ` — ${track.artist}` : ''}` : 'A little music for the journey';
  ui['music-next'].disabled = audio.musicState === 'loading' || Boolean(soundRequest);
  ui['music-next'].textContent = audio.musicState === 'loading' ? 'Loading a song…' : audible ? 'Another song ↗' : 'Start the music ↗';
  ui['biome-label'].textContent = env.biomeLabel;
  ui['season-label'].textContent = env.season[0].toUpperCase() + env.season.slice(1);
  const hours = Math.floor(env.hour), minutes = Math.floor((env.hour - hours) * 60);
  ui['time-label'].textContent = `Day ${env.day} · ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const meters = Math.floor(state.distance * 8);
  ui['distance-label'].textContent = meters < 1 ? 'The first few steps' : meters < 1000 ? `${meters} m along the trail` : `${(meters / 1000).toFixed(1)} km along the trail`;
  ui['journey-note'].textContent = state.mode === 'sleep' ? 'Let the world turn for a little while.' : env.period === 'night' ? 'Even the dark has its small wonders.' : 'There is nowhere you need to be.';
  // The night is shown in the actual scenery; a gentle fade only covers the middle of sleep.
  const fade = rest?.kind === 'sleep' && rest.phase === 'idle'
    ? Math.sin(Math.min(1, rest.time / 7) * Math.PI) * .16
    : rest?.kind === 'sleep' && rest.phase === 'exit' && rest.fromPhase === 'idle'
      ? Math.sin(Math.min(1, rest.fromTime / 7) * Math.PI) * .16 * (1 - Math.min(1, rest.time / .8)) : 0;
  ui['sleep-overlay'].style.opacity = String(fade);
  if (state.elapsed >= statusUntil) {
    const message = rest?.phase === 'exit' ? walkingNext ? 'Packing up, then back to the trail.'
        : rest.nextMode === 'sleep' ? 'Putting the snack away. A little rest next.'
        : rest.nextMode === 'snack' ? 'Rolling up the bed. Something to eat next.'
        : 'Packing everything away. No need to hurry.'
      : rest?.phase === 'enter' ? rest.kind === 'snack'
        ? 'A little stretch. A place to sit. Something from the backpack.'
        : 'Unrolling a little bed beneath the trees.'
      : state.mode === 'snack' ? 'A bite of bread. A warm cup. Stay as long as you like.'
      : state.mode === 'sleep' ? 'Rest easy. The trail will be here in the morning.'
      : state.mode === 'walking' ? env.weather === 'rain' ? 'Rain on leaves, and a path that keeps going.'
        : env.biome === 'stream' ? 'Follow the sound of running water.'
        : env.biome === 'swamp' ? 'Reeds whisper. Something stirs at the water’s edge.'
        : trail.grade > .07 ? 'The trail climbs. Take it one step at a time.'
        : trail.grade < -.07 ? 'Down through the trees, into the valley.'
        : env.biome === 'mountain' ? 'The world feels a little wider up here.'
        : env.period === 'night' ? 'Follow the lantern. Watch for the little lights.' : 'One step, then another. Let the world come to you.'
      : state.distance < .1 ? 'Take the trail. See what finds you.' : 'There is always something worth pausing for.';
    status(message);
  }
}

ui.walk.addEventListener('click', toggleWalk);
ui.snack.addEventListener('click', () => activity('snack'));
ui.sleep.addEventListener('click', () => activity('sleep'));
ui.sound.addEventListener('click', toggleSound);
ui['journal-open'].addEventListener('click', openJournal);
ui['journal-close'].addEventListener('click', closeJournal);
ui['music-next'].addEventListener('click', async () => {
  const skipping = state.sound && soundUnlocked && audio.musicState === 'playing';
  if (!state.sound) state.sound = true;
  await unlockSound();
  if (state.sound && skipping) await audio.nextTrack?.();
  try { localStorage.setItem(SOUND_KEY, state.sound ? 'on' : 'off'); } catch { /* Optional storage. */ }
  renderUI(); save();
});
canvas.addEventListener('click', event => {
  if (ui.journal.open || state.mode === 'sleep') return;
  const rect = canvas.getBoundingClientRect();
  const cssX = event.clientX - rect.left, cssY = event.clientY - rect.top;
  acknowledge(scene.interactAt?.(cssX, cssY, state), { cssX, cssY });
});
ui.journal.addEventListener('click', event => {
  if (event.target !== ui.journal) return;
  const rect = ui.journal.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeJournal();
});
document.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  if (ui.journal.open) { if (event.key.toLowerCase() === 'j') { event.preventDefault(); closeJournal(); } return; }
  if (event.key === ' ' && event.target.tagName === 'BUTTON') return;
  const key = event.key.toLowerCase();
  if (key === ' ' || key === 'arrowup') { event.preventDefault(); toggleWalk(); }
  else if (key === 'e') activity('snack');
  else if (key === 'r') activity('sleep');
  else if (key === 'm') toggleSound();
  else if (key === 'j') openJournal();
});
document.addEventListener('visibilitychange', () => {
  last = 0; accumulator = 0;
  if (document.hidden) { audio.setEnabled(false); save(); }
  else if (state.sound && soundUnlocked) audio.setEnabled(true);
});
addEventListener('pagehide', save);

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  const dt = last ? Math.min((now - last) / 1000, .1) : 0;
  last = now;
  // A modal pauses travel so reading field notes never costs an encounter.
  if (!ui.journal.open) stepJourney(state, dt);
  accumulator += dt; uiTimer += dt; saveTimer += dt;
  if (accumulator >= 1 / 30 || rendered === 0) {
    accumulator %= 1 / 30;
    environmentNow = scene.draw(state);
    syncWildlifeTargets();
    rendered++; renderTotal += scene.lastStats.renderMs; renderMax = Math.max(renderMax, scene.lastStats.renderMs);
    for (const animal of scene.visibleAnimals) {
      if (!state.seen.includes(animal.kind)) {
        state.seen.push(animal.kind);
        if (state.elapsed >= statusUntil) status(['spirit', 'stag', 'unicorn'].includes(animal.kind) ? `${animal.name}. Some stories are true.` : `${animal.name}. A little encounter, remembered.`, 5);
        save(); break;
      }
    }
  }
  audio.update(environmentNow, state.mode === 'walking' && !ui.journal.open, state);
  if (uiTimer > .25) { renderUI(); uiTimer = 0; }
  if (lastMode !== state.mode) {
    if (lastMode === 'sleep' && state.mode === 'paused') status('Back on your feet. Take your time.', 5);
    lastMode = state.mode; renderUI(); save();
  }
  if (saveTimer > 4) { save(); saveTimer = 0; }
}

renderUI(); requestAnimationFrame(frame);
// Read-only diagnostics; useful for checking a long journey without exposing mutation controls.
Object.defineProperty(window, '__wild', { value: Object.freeze({
  snapshot: () => ({ ...JSON.parse(serializeJourney(state)), environment: environment(state) }),
  stats: () => ({ ...scene.lastStats, frames: rendered, averageRenderMs: rendered ? renderTotal / rendered : 0, maxRenderMs: renderMax }),
}), configurable: false });
