# Polar Adventures

A 16-bit arctic platformer. Phaser 4 · TypeScript · Vite.

### ▶ [Play the current build](https://yakov.khalinsky.com/polar-adventures/)

![The hero standing at the edge of a pit, with a one-way ledge platform to the right](docs/screenshot.png)

## Status: movement prototype

Milestones 1–2. There is one hand-authored test level, no enemies, no
collectibles and no goal. What exists is a hero that is genuinely good to
control, and one mechanic — ice — that changes how it moves. The feel of both is
*measured* rather than asserted.

> "It boots" says nothing about whether the jump is 3.5 hero-heights.

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
JUMP_HEIGHT_PX = 3.5 hero-heights     APEX_TIME_S = 0.40
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
fixed 60 Hz, so the closed-form 434px target lands at **415.9px** in the running
game. The constants stay as readable design intent and the gap is documented and
asserted, rather than the constant being fudged to compensate.

![The same frame with the Arcade physics debug overlay on: a magenta 61x116 hitbox inside the 95px hero sprite, and a blue one-way platform body](docs/physics-debug.png)

*The debug overlay (<kbd>F1</kbd>). The hero's hitbox is deliberately narrower
than its art so it fits through one-tile gaps without pixel-hunting the edge.
The blue box is a one-way platform — note the ground tiles have no bodies,
because tilemap collision is handled by the layer.*

## Ice is a feel mechanic

![The hero sliding across a pale blue ice sheet laid into the snow-capped ground](docs/ice.png)

Ice changes how quickly horizontal speed can change, and nothing else. It
deliberately does **not** raise top speed: Arcade's max-velocity clamp is applied
last and is absolute, so sliding faster than run speed would mean raising the
cap — and ice would become a speed boost rather than a hazard.

One Phaser detail shaped the whole implementation. **Arcade applies drag only on
a step where acceleration is exactly zero.** While a direction is held, drag
contributes nothing at all, so lowering drag alone would not have made ice feel
slippery while steering. Three numbers have to move together, all in
`src/config/movement.ts`:

| | rock | ice |
|---|---|---|
| acceleration | 5038 px/s² | 1628 px/s² |
| turn acceleration | 10075 px/s² | 2713 px/s² |
| drag (after release) | 5813 px/s² | 465 px/s² |

Measured effect: released at top speed, the hero stops in **38.4px on rock** and
coasts **418.5px on ice**.

The ice is placed after the pit so the rock-friction check still runs on rock,
and clear of the plateau wall so a slide is never cut short by a collision — the
level layout is load-bearing for the tests, not just for looks.

## Pixel scale

The game renders at **960×540 internal**, doubled to 1080p, with **1 art pixel =
1 game pixel** everywhere — nothing is resampled, which is what lets concept art
drop in at its native size instead of being crushed into a sprite slot.

| | size |
|---|---|
| screen | 960 × 540 — exactly 2× at 1080p |
| collision tile | 70 × 66 — exactly a 2×3 group of the art's bricks |
| brick | 35 × 22 — the unit the concept art is actually drawn on |
| hero | 95 × 124, hitbox 61 × 116 |
| jump | 434px = 3.5 hero-heights |

The brick is the honest unit: it is what the art has, and the collision tile is
a whole number of them in both axes. An earlier 70 × 67 was a 2×3 group of
35 × 22.33 — near enough to look right and wrong enough to resample every brick
row. That is why the grid is 66 tall and not square.

The design targets are expressed in **hero heights**, not tiles. Those used to be
the same number — the hero was exactly one tile — so nothing ever forced a
choice between them. After the rescale the hero is 1.9 tiles, and a "3.5 tile
jump" would have been 0.6 hero-heights: the hero could barely hop over its own
feet. `movement.ts` now says `HERO_H` out loud.

Rescaling also surfaced a failure that is invisible until it bites. **Phaser
discards a tile collision outright when the overlap exceeds `tileBias`**
(`TileCheckY`: `oy = body.bottom - tileTop; if (oy > tileBias) oy = 0`), and the
default is 16. That is fine while a body moves less than 16px per frame and
silently tunnels through the floor the moment it does not. At this scale a
falling hero moves ~36px per frame, so `tileBias` is raised to 64. The failure
is intermittent rather than total — it depends on the sub-pixel phase at the
contact frame — so it presents as flakiness, not as an obvious bug.

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
npm run smoke       # 24 checks — boots the game, asserts the runtime state
npm run verify      # 10 checks — measures the movement claims above
```

Two more are not checks but keep the repo honest, and both need a binary on
`PATH` rather than a package:

```bash
npm run slice-art     # re-slices public/art/ from the concept sheet (needs ImageMagick)
npm run screenshots   # rewrites docs/*.png from the running game (needs Chromium)
```

`slice-art` is byte-reproducible, so it is only ever needed when the art
changes. The PNGs it produces are committed, which is what keeps `magick` out of
the build and out of CI.

`verify` is the interesting one. It records per-frame state from inside the
scene's own update loop, then drives real key presses and checks the results
against what `movement.ts` claims:

```
PASS  held jump apex ~434px (3.5 hero-heights)  apex 415.9px (3.35 hero-heights)
PASS  tap jump has a floor (>= 151px)           apex 208.0px (1.68 hero-heights)
PASS  run reaches max speed 620px/s             max |vx| 620px/s
PASS  ground friction stops crisply             slid 38.4px, final vx 0.0
PASS  standing still: y is stable               y range 0.000px over 60 frames
PASS  surfaceAt distinguishes ice from rock     x=1500 -> ice, x=80 -> rock
PASS  ice: released at speed, hero slides       slid 418.5px from vx 620
PASS  air tuning ignores the surface            mid-air turn 10075 over ice and rock
```

Three of those guard specific decisions. The standing-still check protects the
choice to leave gravity *on* while grounded rather than zeroing it, which would
make the body oscillate on a two-frame cycle and visibly shimmer by one pixel.
The ice checks are written as **relationships rather than exact distances**
(over 232px of slide, versus under 124px on rock), so the ice constants can be
tuned by feel without the suite fighting back. And the air-tuning check exists
because `isTurning` is evaluated before `grounded`, which makes it easy to
accidentally fold the surface into air control — a bug that is invisible in
normal play, since a mid-air ground probe reads empty air and reports `rock`
anyway. That one pokes the hero's state directly to force each surface rather
than driving the keyboard, because no real jump can reach the case.

## Layout

```
src/
  config/    tuning constants and the Phaser game config
  input/     the single seam between keyboard and game — nothing else reads keys
  level/     the ASCII level source, and the only file that knows that format
  objects/   the hero; tick() is physics only, so animation stays additive
  art/       the texture keys and what each tile index means
  scenes/    Boot (loads the art) and Level
scripts/     the two headless verification harnesses, the art slicer, screenshots
public/art/  the sliced PNGs the game loads
assets/concepts/   concept art and ASSET-LOG.md
```

Three seams are deliberate. `input/controls.ts` is the only file that touches
the keyboard plugin, so gamepads and rebinding are a change to one file.
`level/buildLevel.ts` is the only file that knows the level format, so swapping
in Tiled JSON means changing that file and deleting `levels.ts`. And the hero
never holds a `TilemapLayer` — the level exposes a plain
`surfaceAt(x, y) => 'rock' | 'ice'`, so adding a third surface touches no player
code.

## Art

Everything on screen is real art now, sliced out of one FLUX concept sheet by
[`scripts/slice-art.mjs`](scripts/slice-art.mjs) into two PNGs in `public/art/`.
The sheet is 1536×1024 of illustration at six source pixels per art pixel; the
slicer reduces it to 1:1, keys it, and composes it into the shapes the game asks
for. Nothing is resampled at runtime — the hero drops in at exactly its
`HERO_H` and the bricks at exactly 35×22.

The concept art in `assets/concepts/` is art direction and provenance. The
committed PNGs are the shipped assets, and the slicer is byte-reproducible, so a
diff in `public/art/` always means the art changed.

**The hero has no green scarf, and that is a correction rather than a loss.**
The scarf was introduced for the *placeholder*, whose fur highlight was `#F2F5F8`
against snow at `#EAF2F8` — a few percent apart, so a cream bear vanished into a
snow tile. The real art does not have that problem: the fur is a warm cream
against white snow with a hard navy outline around the whole silhouette, and the
sliced bear composited over a wall of real snow tiles reads cleanly. The scarf
solved a problem the real art never had, and the sheet that pairs the hero with
the terrain in a single generation — the one whose scale the game was rescaled
against — simply doesn't have one.

Two things about the keying are worth knowing, because both are invisible in the
result and both cost real time to find:

- **The sheet's grey backdrop is nearly the same colour as the bear's shaded
  fur** (`rgb(165,164,159)` against `rgb(174,177,170)` — nine levels). Any colour
  tolerance wide enough to key the backdrop punches through the bear's hip and
  hind leg. So the slicer does not threshold: it floods the backdrop from the
  image border, using the closed navy outline as a wall.
- **The drop shadow needs removing on its own terms.** It is cool mid-tones
  (`lum ≈ 132`, `R−B < 0`) where the fur is warm and the outline is far darker,
  so it can be identified — but only after the flood, and only by spreading from
  the transparent edge, because it is also the bridge the flood uses to reach the
  bear's underside. A last cut at the lowest outline row removes the flat smear
  under the paws that survives both.

Four smoke checks guard the shipped sprite, reading the loaded PNG back so they
assert what was *shipped* rather than what the code intended: that the texture is
95×124 at native scale, that the art is planted on the last row (the hitbox is
pinned to it), that the rim is dark enough to hold the silhouette against snow,
and that **the face is not mirrored** — the head's dark features must stay right
of centre, because `setFlipX` mirrors the whole sprite and a left-facing slice
would be wrong in *both* directions.

The tile roles are measured rather than chosen. Rows 1–2 of the sheet's grid
carry 29–30% snow pixels and rows 3–6 carry none, and the slicer fails if that
inverts — otherwise a future sheet could swap the snow cap for the fill brick
and every ground row would grow a snow cap with nothing erroring. It also fails
if the ice brick and the fill brick end up too close in colour after quantising,
because that is the game's only mechanic becoming invisible.

Worth recording, since it shaped all of this: FLUX produces good art direction
but **nothing that a prompt can specify numerically**. Asked for a magenta key
colour it returns gray; asked for a 24×32 sprite it returns full illustration
detail; asked for tiles that fill their cell it returns rounded rectangles on a
backdrop. What it does honour is anything it can see — style, palette and
identity all transfer image-to-image — and what it will not do is agree on a
scale across separate generations, which is why the hero and the terrain have to
come out of the same image. The numbers the game needs are then imposed by the
slicer, not requested from the model.

Full findings, measurements and the pipeline as it was actually built are in
[`assets/concepts/ASSET-LOG.md`](assets/concepts/ASSET-LOG.md), with the raw
evidence in `assets/concepts/tests/`.

## Roadmap

- ~~**Real art**~~ — done: sliced from the concept sheet into `public/art/`, loaded in `BootScene`, with the autotile pass deriving snow caps from the level
- **Animation** — idle/run/jump, which `Player.tick()`'s physics/presentation split was built for. One generation per pose: a strip comes back with near-identical stances
- **More levels** — there is currently exactly one, and it is a feel-test rig
- **Breakable ice** — the surface system is in place; crumbling needs tile mutation, per-tile timers and a way to restore state on respawn. The sheet's grid has three spare brick variants the slicer does not use, which is where its art would come from

## License

No license has been chosen yet, so all rights are reserved by default. Open an
issue if you would like to use any of this.
