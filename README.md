# Into the Wild

**A little journey, without an end.**

[Play in your browser](https://jedix420.github.io/intothewild/)

Walk a winding trail through mixed woodland, lively streams, open meadows, mountain passes, willow wetlands and enchanted groves. Meet the inhabitants, pause for a warm drink, or unroll your bed and wake in another morning. There is nowhere you need to be.

![The living woodland and its small traveller](docs/into-the-wild.jpg)

## Play

| Control | Action |
| --- | --- |
| Walk / Space / Up arrow | Walk forward or pause |
| Touch or click an animal | Discover its reaction; give it a moment before trying again |
| Tab, then Enter | Interact with nearby wildlife using the keyboard |
| Snack / E | Sit and have a snack; press again to stand |
| Sleep / R | Rest until the next morning; press again to wake early |
| Speaker / M | Listen or mute |
| Notebook / J | Field notes, music selection and credits |

The panorama fills the available screen while the traveller keeps a small, detailed scale. The path climbs, turns beneath ridges and descends through valleys. A day lasts about five minutes; seasons change every two game days. Sleeping advances the clock. Your place and discoveries save automatically in this browser. A shared `?seed=12345` trail has its own save and leaves your main journey intact.

## A living wilderness

There are **24 inhabitants**: foxes, deer, rabbits, robins, squirrels, badgers, boars, wolves, bears, lynx, wild horses, mountain ibex, owls, eagles, otters, ducks, herons, crocodiles, frogs, trout, butterflies, dragonflies, moonlit stags and lantern spirits. Each belongs to an appropriate habitat. Horses appear in herds, trout jump without needing a tap, and crocodiles spend time basking beside wetland pools.

Touches draw from **105 species-specific responses**, with different movement and poses: approaching, startling, bounding away, rearing, grazing, listening, opening jaws, diving, splashing and more. Reactions begin at the animal’s current position and blend back into its usual activity. Animals keep moving while you pause or take a snack. The field notes remember the species you discover.

**Twelve tree silhouettes** mix with grass, ferns, flowering patches, shrubs, reeds, lilies, mushrooms and fallen logs. Foliage moves in coherent wind while trunks stay rooted. Rolling ground, exposed ridge faces, soil and moss patches, terrain-following shadows and shallow water basins give each habitat a different character. Streams have moving currents, foam, ripples and aquatic life.

![A winding mountain pass with exposed ridge faces](docs/mountain-pass.png)

![The willow wetlands, with pools and resident wildlife](docs/wetlands.png)

## Soundtrack

Four recorded tracks follow the landscape, with gentle crossfades and quiet nature ambience. There are no footstep effects. Music starts after a gesture; the speaker remembers your mute preference. Open Field notes to choose another song.

- **Forest** — syncopika — CC BY 3.0.
- **A Warm Fireplace** — MouthlessGames — CC BY 3.0.
- **It’s Getting Freezing Cold** — MouthlessGames — CC BY 3.0.
- **Vaporware** — The Cynic Project — CC0 1.0.

The recordings are bundled with the game; no external music service is needed. See [full track credits, original sources and licences](docs/music-sources.md). Downloaded music totals about 5.6 MB; the game loads tracks as needed and keeps at most two decoded recordings.

## Run locally

Requires a current Node.js installation. No package installation or build step.

```sh
npm start
```

Open `http://localhost:5300`. Any static file server also works.

```sh
npm run check
npm test
```

## How it works

The dependency-free JavaScript renderer combines a projected heightfield, depth testing, small procedural models and cached tree sprites. World-space vegetation and softly filtered sprite translation avoid independent tree snapping as the camera moves. Terrain caches and streamed scenery keep the visible world bounded rather than accumulating an entire endless map.

The generator retains five to eleven nearby trail chunks. Saves contain only the seed, distance, clock and a limited field guide. Wildlife has deterministic patrols and a bounded runtime reaction director. Aquatic patrols respect stream banks, bridge clearance and wetland pool boundaries. The traveller and land animals use the actual terrain height for their feet.

Simulation stops in a hidden tab, and audio suspends while preserving its position. Reduced-motion preferences suppress foliage sway and decorative falling particles. Canvas wildlife also has labelled keyboard-accessible interaction controls.

## GitHub Pages

This is a static site with relative asset paths. Publish `main` from `/ (root)` in **Settings → Pages → Deploy from a branch**. `.nojekyll` keeps the files unchanged. No build workflow is required.

## Credits

The pixel-rendering foundation is adapted from [Pixel Plays](https://github.com/amirmushichge/pixel-plays) by Amir Mushich under the MIT licence. Its fixed perspective and small, detailed figures inspired this game. Upstream music is not included. The wilderness, journey systems, procedural characters, vegetation, wildlife interactions and interface are created for Into the Wild.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for code and music licences. The MIT code licence does not replace the recordings’ individual licences.
