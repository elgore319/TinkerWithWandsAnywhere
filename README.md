# Noita Wand Calculator

Put spells in wand slots and see every cast written out as equations: cast delay, recharge, mana, spread, speed, lifetime, distance and damage, with the slot number under each term.

Open `index.html` in a browser. No build step or server is needed.

## Files

| Path | What it does |
| --- | --- |
| `index.html` | Page markup. Loads the stylesheet and the three scripts in order. |
| `css/style.css` | All styling. |
| `js/gamedata.js` | Spell and projectile data (generated, don't edit by hand). Defines `GAME_SPELLS` and `GAME_PROJ`. |
| `js/engine.js` | The draw engine. `makeEngine(spells, projectiles).simulate(options)` runs one recharge cycle and returns the call tree, every stat change as a labeled term, and the per-shot results. Also defines the special-spell tables (`HANDLED`, `RANDOM_NOTE`). |
| `js/app.js` | The UI: wand inputs, slots, equation rendering, the Spell stats table, saving to browser storage. |
| `tools/build_data.py` | Regenerates `js/gamedata.js` from the game's files. |
| `tests/engine.test.js` | Checks the engine against known wand behavior. |

Scripts are plain (non-module) files so the page also works when opened straight from disk.

## Spell data

Each spell is a list of ops read from the game's `gun_actions.lua`:

- `['cd', n]` / `['cdSet', n]`: add to or set cast delay (frames)
- `['rt', n]` / `['rtSet', n]`: add to or set recharge (frames)
- `['spread', n]`, `['mult', n]`, `['life', n]`, `['dmg', n]`: spread, speed multiplier, lifetime and damage changes
- `['proj', entity]`: fire a projectile
- `['trig', kind, entity, draws, timer]`: fire a trigger projectile whose payload draws `draws` cards (`kind` is `hit`, `timer` or `death`)
- `['draw', n]`: draw n more cards
- `['nolla']`: lifetime drops to about 3 frames

Spells with logic beyond these ops (Divide By, Greek letters, Requirements, Add Trigger and so on) are handled by name in `js/engine.js`.

Projectile entries are `[speed_min, speed_max, lifetime, lifetime_randomness, terminal_velocity (0 = uncapped), damage, explosion_damage, explosion_radius]`, with damage ×25 as in the game's tooltips.

### Updating after a game patch

1. Get an unpacked copy of the game's `data.wak` (the folder with `scripts/`, `entities/` and `translations/`), for example by cloning https://github.com/vexx32/noita-data or unpacking your own install with a .wak extractor.
2. Run `python3 tools/build_data.py --data PATH_TO_DATA`. Add `-v` to list spells whose logic the parser didn't recognize; new ones need a handler in `js/engine.js`.
3. Run `node tests/engine.test.js`.

The bundled data is from the stable branch as of March 2023.

## Tests

```
node tests/engine.test.js
```
