import { createJourney, stepJourney, setActivity, environment, serializeJourney, restoreJourney, trailProfileAt } from './world.js?v=3';
import { ForestScene } from './scene.js?v=3';
import { ForestAudio } from './audio.js?v=3';

const SAVE_KEY = 'into-the-wild.journey.v1';
const SOUND_KEY = 'into-the-wild.sound.v2';
const params = new URLSearchParams(location.search);
const requestedSeed = params.get('seed');
let stored = null;
try { stored = localStorage.getItem(SAVE_KEY); } catch { /* A journey also works when browser storage is disabled. */ }
const state = requestedSeed !== null && /^\d{1,10}$/.test(requestedSeed)
  ? createJourney(Number(requestedSeed) >>> 0)
  : stored ? restoreJourney(stored) : createJourney();
// The old release silently defaulted to mute. Start the new score with the
// first play gesture; remember an explicit mute independently of journey saves.
let soundPreference = null;
try { soundPreference = localStorage.getItem(SOUND_KEY); } catch { /* Optional storage. */ }
state.sound = soundPreference !== 'off';
// Coming back to the trail never starts walking or sound without a gesture.
if (state.mode === 'walking') setActivity(state, 'paused');
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
].map(id => [id, document.getElementById(id)]));
const sightings = {
  fox: ['Red fox', 'A bright tail, then a quiet glance back.'],
  rabbit: ['Wild rabbit', 'Little ears in the long grass.'],
  deer: ['Woodland deer', 'For a moment, you share the clearing.'],
  bird: ['Woodland bird', 'A small song for a very big world.'],
  stag: ['Moonlit stag', 'Antlers carrying a little borrowed starlight.'],
  spirit: ['Lantern spirit', 'Some lights are alive.'],
};
let last = 0, accumulator = 0, uiTimer = 0, saveTimer = 0;
let soundUnlocked = false, statusUntil = 0, lastStatus = '', lastMode = state.mode;
let rendered = 0, renderTotal = 0, renderMax = 0;
let environmentNow = environment(state);

function save() {
  try { localStorage.setItem(SAVE_KEY, serializeJourney(state)); } catch { /* Storage is optional. */ }
}
function status(text, hold = 0) {
  if (text !== lastStatus) { ui.status.textContent = text; lastStatus = text; }
  statusUntil = state.elapsed + hold;
}
function activity(mode) {
  if (ui.journal.open) return;
  setActivity(state, state.mode === mode && mode !== 'walking' ? 'paused' : mode);
  statusUntil = 0; renderUI(); save();
  if (state.sound) unlockSound();
}
function toggleWalk() { activity(state.mode === 'walking' ? 'paused' : 'walking'); }
async function unlockSound() {
  if (!state.sound) return;
  try {
    const started = await audio.start();
    soundUnlocked = started;
    audio.setEnabled(state.sound && started && !document.hidden);
    if (!started) status('Tap the sound button when you are ready to listen.', 4);
  } catch { soundUnlocked = false; audio.setEnabled(false); }
  renderUI();
}
async function toggleSound() {
  if (state.sound && !soundUnlocked) await unlockSound();
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
  const kinds = state.seen.filter(key => sightings[key]);
  if (!kinds.length) {
    const empty = document.createElement('p'); empty.className = 'journal-empty';
    empty.textContent = 'A fresh page. The forest will fill it.';
    ui.sightings.append(empty); return;
  }
  for (const kind of kinds) {
    const row = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('small');
    title.textContent = sightings[kind][0]; detail.textContent = sightings[kind][1];
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
  const walking = state.mode === 'walking';
  ui.walk.setAttribute('aria-pressed', String(walking));
  ui['walk-label'].textContent = walking ? 'Pause a moment' : state.distance > .1 ? 'Keep wandering' : 'Begin wandering';
  ui.snack.setAttribute('aria-pressed', String(state.mode === 'snack'));
  ui.sleep.setAttribute('aria-pressed', String(state.mode === 'sleep'));
  const audible = state.sound && soundUnlocked;
  ui.sound.setAttribute('aria-pressed', String(audible));
  ui.sound.setAttribute('aria-label', audible ? 'Turn off sound' : 'Turn on sound');
  ui.sound.title = audible ? 'Music and forest sounds · M' : state.sound ? 'Sound starts with your first step. Tap to listen now.' : 'Turn on music and forest sounds · M';
  ui['sound-label'].textContent = audible ? 'Sound on' : state.sound ? 'Sound on your first step' : 'Sound off';
  ui['biome-label'].textContent = env.biomeLabel;
  ui['season-label'].textContent = env.season[0].toUpperCase() + env.season.slice(1);
  const hours = Math.floor(env.hour), minutes = Math.floor((env.hour - hours) * 60);
  ui['time-label'].textContent = `Day ${env.day} · ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const meters = Math.floor(state.distance * 8);
  ui['distance-label'].textContent = meters < 1 ? 'The first few steps' : meters < 1000 ? `${meters} m along the trail` : `${(meters / 1000).toFixed(1)} km along the trail`;
  ui['journey-note'].textContent = state.mode === 'sleep' ? 'Let the world turn for a little while.' : env.period === 'night' ? 'Even the dark has its small wonders.' : 'There is nowhere you need to be.';
  // The night is shown in the actual scenery; a gentle fade only covers the middle of sleep.
  const fade = state.mode === 'sleep' ? Math.sin(Math.min(1, state.modeTime / 7) * Math.PI) * .16 : 0;
  ui['sleep-overlay'].style.opacity = String(fade);
  if (state.elapsed >= statusUntil) {
    const message = state.mode === 'snack' ? 'A warm cup. A quiet place. Stay as long as you like.'
      : state.mode === 'sleep' ? 'Rest easy. The trail will be here in the morning.'
      : state.mode === 'walking' ? env.weather === 'rain' ? 'Rain on leaves, and a path that keeps going.'
        : env.biome === 'stream' ? 'Follow the sound of running water.'
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
    rendered++; renderTotal += scene.lastStats.renderMs; renderMax = Math.max(renderMax, scene.lastStats.renderMs);
    for (const animal of scene.visibleAnimals) {
      if (!state.seen.includes(animal.kind)) {
        state.seen.push(animal.kind);
        status(animal.kind === 'spirit' || animal.kind === 'stag' ? `${animal.name}. Some stories are true.` : `${animal.name}. A little encounter, remembered.`, 5);
        save(); break;
      }
    }
  }
  audio.update(environmentNow, state.mode === 'walking' && !ui.journal.open, state);
  if (uiTimer > .25) { renderUI(); uiTimer = 0; }
  if (lastMode !== state.mode) {
    if (lastMode === 'sleep' && state.mode === 'paused') status('A new morning. A little further to wander.', 5);
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
