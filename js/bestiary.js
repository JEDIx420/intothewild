// A small field guide also supplies the renderer and encounter generator with
// physical sizes and habitats. It has no world dependency, so the world can use
// the same catalogue without an import cycle.
const FIELD_NOTES = {
  'Red fox': 'A russet tail in the undergrowth. Watch for a listening pause, a quick pounce, or a sudden retreat.',
  'Woodland deer': 'A quiet grazer among the trees. A raised head and still ears often come before a bounding departure.',
  'Wild rabbit': 'Little leaps and twitching noses. When the rabbit pauses, its long ears keep listening.',
  'Woodland robin': 'A small bright chest among the branches. This traveller of the air answers with hops, fluttering wings, and song.',
  'Lantern spirit': 'A wandering seed of green light. It may circle, dip in greeting, or drift closer to inspect you.',
  'Moonlit stag': 'Pale hooves and luminous antlers mark a rare resident of the enchanted grove. Approach with patience.',
  'Wild horse': 'Look for the small herds in open country. Curious approaches, swishing tails, whinnies, and brief gallops make each meeting different.',
  'Grey wolf': 'A watchful grey shape between the trees. Its nose follows hidden trails, and its howl carries a long way.',
  'Brown bear': 'Broad paws and an unhurried gait. Sometimes the bear rises to inspect the air before returning to its own business.',
  'Wild boar': 'A bristled back and a busy snout. Soft ground gives this woodland resident plenty to investigate.',
  'Woodland badger': 'A striped face close to the forest floor. It snuffles, pauses, scratches, and hurries back towards cover.',
  'Red squirrel': 'The upright tail is often the first thing you see. Wait for a pause to spot a seed held in tiny paws.',
  'Mountain ibex': 'Curved horns above the high trail. This sure-footed wanderer alternates careful steps with lively little bounds.',
  'Mountain lynx': 'Tufted ears and a short dark tail. Look for a long stretch before this quiet prowler slips away.',
  'Tawny owl': 'A round face, soft feathers, and broad wings. A patient pause may earn a hoot or a slow turn towards you.',
  'Golden eagle': 'Long wings ride above the pass. Follow the silhouette as it banks, circles, and climbs over the ridge.',
  'River otter': 'Whiskers above the ripples. A curious paddle may end in a splash and a neat dive beneath the surface.',
  'Mallard duck': 'A small wake follows every paddle. Watch for a flutter of wet wings or a tail tipping upwards during a dive.',
  'Grey heron': 'Long legs at the water’s edge. Its stillness makes the sudden movement of that pointed bill easy to miss.',
  'Marsh crocodile': 'A low, ridged back beside the wetland pools. It spends long moments basking, then shifts its tail or opens its jaws.',
  'Reed frog': 'A small green resident between the reeds. A croak, a blink, and a springy hop reveal it among the plants.',
  'Silver trout': 'A brief flash beneath the reflections. Be patient: the trout sometimes leaps and leaves a ring of ripples behind.',
  'Meadow butterfly': 'Soft colours carried between flowers. Its loose circles and little rises follow the rhythm of the meadow.',
  'Blue dragonfly': 'A blue glint above the water. The long hovering pauses make each quick dart seem even faster.',
};
const entry = (name, biomes, habitat, scale, hitRadius, height) =>
  Object.freeze({ name, biomes: Object.freeze(biomes), habitat, scale, hitRadius, height, note: FIELD_NOTES[name] });

export const SPECIES = Object.freeze({
  fox: entry('Red fox', ['forest', 'meadow', 'enchanted'], 'land', 1, 1.1, 1.1),
  deer: entry('Woodland deer', ['forest', 'meadow', 'stream'], 'land', 1, 1.15, 1.95),
  rabbit: entry('Wild rabbit', ['forest', 'meadow'], 'land', .95, .65, .95),
  bird: entry('Woodland robin', ['forest', 'meadow', 'stream'], 'air', 1.1, .65, .65),
  spirit: entry('Lantern spirit', ['enchanted'], 'air', 1, .65, 1.6),
  stag: entry('Moonlit stag', ['enchanted'], 'land', 1.15, 1.3, 2.6),
  horse: entry('Wild horse', ['meadow'], 'land', 1, 1.6, 2.35),
  wolf: entry('Grey wolf', ['forest', 'mountain'], 'land', 1.05, 1.25, 1.25),
  bear: entry('Brown bear', ['forest', 'mountain', 'stream'], 'land', 1, 1.55, 1.8),
  boar: entry('Wild boar', ['forest', 'swamp'], 'land', 1, 1.15, 1.05),
  badger: entry('Woodland badger', ['forest'], 'land', 1, .9, .7),
  squirrel: entry('Red squirrel', ['forest', 'enchanted'], 'land', 1.05, .75, 1.1),
  goat: entry('Mountain ibex', ['mountain'], 'land', 1, 1.1, 2),
  lynx: entry('Mountain lynx', ['mountain', 'forest'], 'land', 1, 1.05, 1.3),
  owl: entry('Tawny owl', ['forest', 'enchanted'], 'air', 1.15, 1, 1.2),
  eagle: entry('Golden eagle', ['mountain', 'meadow'], 'air', 1.1, 1.65, 1.1),
  otter: entry('River otter', ['stream', 'swamp'], 'water', 1, 1.1, .65),
  duck: entry('Mallard duck', ['stream', 'swamp'], 'water', 1, .85, .7),
  heron: entry('Grey heron', ['stream', 'swamp'], 'bank', 1, 1, 2.1),
  crocodile: entry('Marsh crocodile', ['swamp'], 'bank', 1, 1.9, .7),
  frog: entry('Reed frog', ['stream', 'swamp'], 'bank', 1.15, .55, .42),
  fish: entry('Silver trout', ['stream', 'swamp'], 'water', 1.15, .7, .45),
  butterfly: entry('Meadow butterfly', ['meadow', 'enchanted', 'forest'], 'air', 1.15, .6, .5),
  dragonfly: entry('Blue dragonfly', ['stream', 'swamp'], 'air', 1.2, .65, .35),
});

export const SPECIES_KEYS = Object.freeze(Object.keys(SPECIES));

// Each encounter cycles through its own shuffled starting point. Repeated
// touches discover different little stories, while an immediate second tap is
// ignored so a startled creature can finish its movement.
const reaction = (action, message, sound = '') => Object.freeze({ action, message, sound });
export const REACTIONS = Object.freeze({
  fox: [reaction('flee', 'The fox darts into the undergrowth.', 'rustle'), reaction('listen', 'Two sharp ears turn towards you.'), reaction('pounce', 'The fox pounces on something in the grass.', 'rustle'), reaction('sniff', 'The fox pauses and noses the grass.'), reaction('circle', 'A russet tail curls around as the fox changes course.')],
  deer: [reaction('bound', 'The deer bounds away through the trees.', 'rustle'), reaction('listen', 'The deer freezes, ears trained on you.'), reaction('stepAway', 'A cautious deer takes a few steps back.'), reaction('graze', 'The deer decides you are harmless and returns to grazing.')],
  rabbit: [reaction('bound', 'The rabbit springs away in quick little leaps.', 'rustle'), reaction('listen', 'The rabbit rises up to listen.'), reaction('sniff', 'A little nose twitches in your direction.'), reaction('circle', 'The rabbit makes a quick loop through the grass.')],
  bird: [reaction('fly', 'The robin flutters away, singing.', 'chirp'), reaction('call', 'A clear little song answers you.', 'chirp'), reaction('hop', 'The robin makes two quick little hops.'), reaction('peck', 'The robin goes back to searching the ground.')],
  spirit: [reaction('circle', 'The lantern spirit traces a little circle of light.', 'chime'), reaction('approach', 'A curious green light drifts towards you.', 'chime'), reaction('rise', 'The spirit floats upwards like a glowing seed.', 'chime'), reaction('bow', 'The little light dips, almost like a greeting.', 'chime')],
  stag: [reaction('bow', 'The moonlit stag lowers its luminous antlers.', 'chime'), reaction('listen', 'The stag holds still. Its antlers shimmer.'), reaction('bound', 'Pale hooves carry the stag into the grove.', 'rustle'), reaction('approach', 'The stag takes a slow, curious step towards you.', 'chime')],
  horse: [reaction('approach', 'A curious horse trots closer to investigate.', 'neigh'), reaction('rear', 'The horse rises, then settles on all four hooves.', 'neigh'), reaction('call', 'A soft whinny passes through the herd.', 'neigh'), reaction('circle', 'The horses wheel around together.'), reaction('graze', 'A swishing tail, then another mouthful of grass.'), reaction('bound', 'The herd breaks into a short gallop.', 'neigh')],
  wolf: [reaction('listen', 'The wolf watches you, calm and alert.'), reaction('call', 'A low howl carries between the trees.', 'howl'), reaction('stepAway', 'The wolf slips back into the shade.'), reaction('sniff', 'The wolf lowers its muzzle to investigate a scent.'), reaction('flee', 'The wolf lopes away along its own trail.')],
  bear: [reaction('rear', 'The bear stands briefly to catch your scent.', 'huff'), reaction('sniff', 'The bear snuffles among the plants.', 'huff'), reaction('stepAway', 'The bear ambles away, unhurried.'), reaction('scratch', 'The bear pauses for a good scratch.'), reaction('listen', 'The bear lifts its broad head and listens.')],
  boar: [reaction('sniff', 'The boar roots through the soft earth.', 'snort'), reaction('flee', 'The boar trots briskly into cover.', 'rustle'), reaction('call', 'The boar answers with a gruff snort.', 'snort'), reaction('stepAway', 'The boar turns its bristled back and wanders on.')],
  badger: [reaction('sniff', 'The badger busily snuffles at the ground.'), reaction('flee', 'The badger hurries for the nearest cover.', 'rustle'), reaction('listen', 'A striped face turns to inspect you.'), reaction('scratch', 'The badger pauses for a quick scratch before carrying on.')],
  squirrel: [reaction('bound', 'The squirrel bounds away, tail streaming behind.', 'rustle'), reaction('listen', 'The squirrel sits upright, paws tucked close.'), reaction('nibble', 'The squirrel turns a tiny seed between its paws.'), reaction('circle', 'The squirrel scampers in an excited little loop.'), reaction('flee', 'A red flash disappears towards the trees.')],
  goat: [reaction('bound', 'The ibex springs up the rocky slope.', 'rustle'), reaction('listen', 'The ibex surveys the pass from its perch.'), reaction('rear', 'The ibex raises its forelegs and balances.'), reaction('call', 'A short bleat echoes across the pass.', 'bleat'), reaction('graze', 'The ibex nibbles a tough alpine plant.')],
  lynx: [reaction('listen', 'Black ear tufts turn towards you.'), reaction('flee', 'The lynx slips away with soundless strides.'), reaction('pounce', 'The lynx makes a playful leap into the grass.'), reaction('stretch', 'The lynx stretches its back and long forelegs.'), reaction('sniff', 'The lynx pauses to inspect a scent.')],
  owl: [reaction('call', 'A rounded hoot drifts through the trees.', 'hoot'), reaction('fly', 'The owl opens broad wings and glides away.', 'wing'), reaction('listen', 'The owl swivels its round face towards you.'), reaction('ruffle', 'The owl fluffs its feathers, then settles.')],
  eagle: [reaction('fly', 'The eagle climbs on an invisible current.', 'wing'), reaction('circle', 'The eagle banks into a slow circle overhead.'), reaction('call', 'A bright cry rings out over the ridge.', 'eagle'), reaction('rise', 'The eagle spreads its wings and gains height.')],
  otter: [reaction('dive', 'The otter slips neatly beneath the surface.', 'splash'), reaction('approach', 'A curious otter paddles nearer.', 'splash'), reaction('splash', 'The otter swishes its tail and splashes.', 'splash'), reaction('listen', 'Whiskers and bright eyes rise above the water.')],
  duck: [reaction('call', 'The duck answers with a cheerful quack.', 'quack'), reaction('splash', 'The duck flaps water from its wings.', 'splash'), reaction('dive', 'The duck dips forward, tail pointing skyward.', 'splash'), reaction('stepAway', 'The duck paddles a little farther away.')],
  heron: [reaction('fly', 'The heron lifts away on slow, broad wingbeats.', 'wing'), reaction('peck', 'The heron makes a quick, precise strike with its bill.', 'splash'), reaction('listen', 'The heron stands impossibly still.'), reaction('stepAway', 'The heron takes a few measured steps along the bank.')],
  crocodile: [reaction('gape', 'The crocodile opens its jaws, basking in the warmth.', 'huff'), reaction('splash', 'The crocodile swishes its heavy tail.', 'splash'), reaction('listen', 'One amber eye follows you from the shallows.'), reaction('stepAway', 'The crocodile slides a little farther along the bank.'), reaction('sniff', 'The crocodile lifts its snout, then rests again.')],
  frog: [reaction('hop', 'The frog leaps between the reeds.', 'splash'), reaction('call', 'A small croak answers from the bank.', 'croak'), reaction('bound', 'The frog makes two quick, springy hops.', 'splash'), reaction('listen', 'The frog blinks and holds perfectly still.')],
  fish: [reaction('jump', 'A silver trout leaps out of the water.', 'splash'), reaction('splash', 'A flash of scales leaves widening ripples.', 'splash'), reaction('dive', 'The trout turns and vanishes into deeper water.', 'splash'), reaction('circle', 'The trout circles under the dancing reflections.')],
  butterfly: [reaction('rise', 'The butterfly lifts on a tiny gust of wind.'), reaction('circle', 'Bright wings trace a loose circle.'), reaction('approach', 'The butterfly flutters closer, then hovers.'), reaction('bow', 'The butterfly dips towards a flower.')],
  dragonfly: [reaction('flee', 'The dragonfly darts across the water.'), reaction('listen', 'The dragonfly hovers almost motionless.'), reaction('circle', 'Blue wings skim a quick loop above the reeds.'), reaction('rise', 'The dragonfly climbs into the warm air.')],
});
