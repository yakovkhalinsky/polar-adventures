# Polar Adventures

A 16-bit arctic platformer. Phaser 4 · TypeScript · Vite.

### ▶ [Play the current build](https://yakov.khalinsky.com/polar-adventures/)

![The hero standing at the edge of a pit, with a one-way plank platform to the right](docs/screenshot.png)

## Status: movement prototype

Milestone 1. There is one hand-authored test level, no enemies, no
collectibles and no goal. What exists is a hero that is genuinely good to
control — and whose feel is *measured* rather than asserted.

> "It boots" says nothing about whether the jump is 3.5 tiles.

| Controls | |
|---|---|
| Move | <kbd>←</kbd> <kbd>→</kbd> |
| Jump | <kbd>↑</kbd> <kbd>Space</kbd> <kbd>Z</kbd> <kbd>X</kbd> |
| Physics debug overlay | <kbd>F1</kbd> |

Hold jump to go higher, tap it to hop. Both are deliberate — see below.

## The jump is derived, not tuned

`src/config/movement.ts` holds two design targets, and everything vertical is
computed from them:

```
JUMP_HEIGHT_PX = 3.5 tiles     APEX_TIME_S = 0.40
        ↓
GRAVITY_RISE = 2h/t²   JUMP_VELOCITY = 2h/t
```

Nothing is hand-edited independently, so the arc cannot silently stop matching
its stated apex. Feel is then layered on top: asymmetric gravity (fall is 1.64×
rise — that ratio *is* the sense of weight), coyote time, a jump buffer, and
variable height via a velocity **clamp** rather than a multiplier, because a
clamp guarantees a minimum hop while a multiplier's result depends on when you
happened to release.

One subtlety worth knowing: Phaser integrates with semi-implicit Euler at a
fixed 60 Hz, so the closed-form 112px target lands at **107.3px** in the running
game. The constants stay as readable design intent and the gap is documented and
asserted, rather than the constant being fudged to compensate.

![The same frame with the Arcade physics debug overlay on: a magenta 16x30 hitbox inside the 24px hero sprite, and a blue one-way platform body](docs/physics-debug.png)

*The debug overlay (<kbd>F1</kbd>). The hero's hitbox is deliberately narrower
than its art so it fits through one-tile gaps without pixel-hunting the edge.
The blue box is a one-way platform — note the ground tiles have no bodies,
because tilemap collision is handled by the layer.*

## Running it

```bash
npm install
npm run dev      # http://localhost:8080
```

## Verification

The acceptance criterion for movement is measured, not eyeballed. All three run
without a display, driving the real game in headless Chromium:

```bash
npm run typecheck   # tsc --noEmit
npm run smoke       # 12 checks — boots the game, asserts the runtime state
npm run verify      # 7 checks — measures the movement claims above
```

`verify` is the interesting one. It records per-frame state from inside the
scene's own update loop, then drives real key presses and checks the results
against what `movement.ts` claims:

```
PASS  held jump apex ~112px (3.5 tiles)     apex 107.3px (3.35 tiles)
PASS  tap jump has a floor (>= 39px)        apex 53.7px (1.68 tiles)
PASS  run reaches max speed 160px/s         max |vx| 160px/s
PASS  ground friction stops crisply         slid 12.6px, final vx 0.0
PASS  standing still: y is stable           y range 0.000px over 60 frames
```

That last one guards a specific decision: gravity is left *on* while grounded
rather than zeroed, which would make the body oscillate on a two-frame cycle
and visibly shimmer by one pixel while standing still.

## Layout

```
src/
  config/    tuning constants and the Phaser game config
  input/     the single seam between keyboard and game — nothing else reads keys
  level/     the ASCII level source, and the only file that knows that format
  objects/   the hero; tick() is physics only, so animation stays additive
  art/       generated placeholder textures
  scenes/    Boot (builds textures) and Level
scripts/     the two headless verification harnesses
assets/concepts/   concept art and ASSET-LOG.md
```

Two seams are deliberate: `input/controls.ts` is the only file that touches the
keyboard plugin, so gamepads and rebinding are a change to one file; and
`level/buildLevel.ts` is the only file that knows the level format, so swapping
in Tiled JSON means changing that file and deleting `levels.ts`.

## Art

Everything on screen is generated at boot as placeholder canvas textures, drawn
from the palette locked in [`assets/concepts/ASSET-LOG.md`](assets/concepts/ASSET-LOG.md).
The concept art in that folder is art direction, not shipped assets.

The **green scarf is not decoration.** It exists to solve white-on-white
silhouette readability when a cream-furred bear stands on snow, and it is in the
placeholder for exactly the same reason it is in the concept art.

Worth recording, since it shaped the pipeline: FLUX produces good art direction
but **does not produce grid-aligned sprite sheets** — the requested 4×3
turnaround came back as a ragged 4/3/1 layout, and a generated run cycle was
five near-identical poses rather than eight usable frames. Real locomotion needs
one generation per pose. The tilesets were the surprise win and are usable after
manual slicing; nothing has been sliced yet.

## Roadmap

- **The ice mechanic** — `TILE_INDEX.ICE` is drawn and reserved, unused
- **Real art** — slice the tilesets, add `load.atlas()` in `BootScene`, delete the `make*` calls
- **Animation** — idle/run/jump, which `Player.tick()`'s physics/presentation split was built for
- **More levels** — there is currently exactly one, and it is a feel-test rig

## License

No license has been chosen yet, so all rights are reserved by default. Open an
issue if you would like to use any of this.
