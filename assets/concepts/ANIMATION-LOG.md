# Animation — progress and how to resume

**Status: paused at the stage-1 gate.** The run cycle is generated, sliced,
registered, quantised and measurable; it has not been wired into the game, and
the other six poses have not been generated.

The poses, this file and the preview page are **committed** (the header and §9
said otherwise until 2026-09-19; they were committed in `342a59e` and the tree
is clean).

Companion: [`ASSET-LOG.md`](ASSET-LOG.md) (rounds 1–3, the static art),
`run-cycle-preview.html` in this folder (the run cycle animating at 1×, for
judging by eye).

---

## 1. Why this is not a strip

Two earlier rounds established that FLUX **cannot** produce a usable animation
strip — an 8-frame run request came back as 5 near-identical stances, and a
turnaround as a ragged 4/3/1 layout. So the approach here is **one generation
per pose**, conditioned on the shipping bear, with the numbers imposed
afterwards by the slicer rather than requested from the model.

That was tested before anything was built on it. Findings, all measured:

| finding | detail |
|---|---|
| **The reference image does real work** | The same prompt with no reference produced a *different* bear — grey, chunkier, not this character. Conditioned on the bear, identity transfers: same warm cream fur, same navy outline, same head and ears. |
| **The bipedal stance must be stated** | A run prompt without it produced a bear on all fours. The clause **"standing upright on two legs like image 1"** is the difference between usable and not. Every prompt needs it. |
| **Scale is consistent, placement is not** | Across poses, the bear's height agrees within ±1%, but its position in the frame drifts by **±1px**. So poses must be **registered** (translated onto a common ground line and centre column), not cropped by one fixed window. Two samples suggested a fixed window would work; six disproved it. |
| **Long prompts are moderated** | 4 of 8 attempts came back `MODERATED_INPUT` before rendering — the long ones with style boilerplate. Short prompts pass. **Blocked attempts are not charged.** |

## 2. What is done

- **`assets/concepts/poses/`** — the four run poses, as generated (608×784
  JPEGs). These are the durable input; everything else here is derived from
  them.
  - `run-0-contact-near.jpg` — near leg forward, foot down
  - `run-1-passing-near.jpg` — near leg passing under
  - `run-2-contact-far.jpg` — far leg forward, foot down
  - `run-3-passing-far.jpg` — far leg passing under
- **`assets/concepts/poses/registered/`** — the derived output, rebuilt by
  `npm run slice-poses` (2026-09-19): `run-sheet.png` (416×124, the four frames
  side by side, **one shared 32-colour palette**) and `run-0..3.png` (104×124
  each, cut back out of the quantised sheet).
- **Measured, at the game's 1:1 scale:** frames differ by **29.9%, 37.5%, 36.1%
  and 35.4%** against the next one, and the closest pair *anywhere* is 29.9%
  (frames 0–1). The failure this guards against is a strip of near-identical
  stances; this is not that.
- **The two "contact" poses are the most different pair in the set** — frames 0–2
  score 40.3%, above every consecutive pair. That is the reassuring shape for a
  four-frame run: the near-leg contact and the far-leg contact are further apart
  than either is from its own passing frame, which is what a genuine leg swap
  looks like rather than one lead leg repeated.
- **The metric, which was not written down before** — and which two reasonable
  readings get wrong by an order of magnitude. It is the share of pixels over the
  **whole 104×124 canvas** (transparent background included) where the summed RGB
  delta exceeds 40, or alpha changed. Strict per-pixel equality gives ~100%
  (each generation carries its own tone) and silhouette-only gives 20–25%; the
  figure above is the 40-tolerance one. Both are now computed in
  `scripts/slice-poses.mjs` (`frameDiff()`, and the silhouette measure) rather
  than living on a throwaway script — all six pairs, under both, for the record:
  0–1 29.9/20.1, 0–2 40.3/24.9, 0–3 35.4/22.7, 1–2 37.5/24.9, 1–3 33.0/25.0,
  2–3 36.1/23.4.

**Not done:** wiring into the game, the other six poses, any test change.

## 3. The generation recipe

Model `flux2_pro_preview`. **Reference image:** the bear cropped out of
`07-asset-sheet-bear-and-tiles.jpg` at source resolution (`-crop 610x790+25+110`),
uploaded once — media id `c2ea3727-2073-455a-bdfa-381acc1c717b`, passed as
`input_medias: [{id}]`. Conditioned generations come back at the reference's own
aspect (608×784), which is what makes the registration numbers below so small.

**The four run prompts, verbatim** (each prefixed with the identical clause
*"The same pixel-art polar bear as image 1, standing upright on two legs like
image 1, seen from the side, running to the right:"*):

| frame | pose text |
|---|---|
| 0 | the near leg forward with its foot on the ground, the far leg back, body upright and leaning slightly forward, arms close to the body |
| 1 | the near leg lifted and passing under the body, the far leg straight underneath, body tall, arms close to the body |
| 2 | the far leg reaching forward and landing, the near leg stretched back, body leaning forward, arms close to the body |
| 3 | the far leg lifted and passing under the body, the near leg straight underneath, body tall, arms close to the body |

Two lessons from getting here:

- **A four-frame run covers a full stride**, not four quarters of one leg:
  near leg forward → near leg passing → far leg forward → far leg passing. Four
  frames of the same leg limps.
- **Frame 0 was regenerated.** The first attempt ("the near leg reaching forward
  and landing, the far leg stretched back") came back as a horizontal sprawl —
  a 96×54 extent instead of ~96×124. Adding **"body upright"** and "with its
  foot on the ground" fixed it. Measure every pose's extent; a bad generation is
  obvious as a wrong aspect, and re-prompting costs 4.5 credits.

## 4. The slicing recipe

Implemented as **`scripts/slice-poses.mjs`** (`npm run slice-poses`, re-runnable
and byte-stable). It **imports** `decimate`, `keyHero`, `writePng` and `quantise`
from `scripts/slice-art.mjs` rather than copying them — those functions are
exported for it, and the keying is far too subtle to keep two copies of. The
recipe, and why each step is not optional:

1. **Decimate the whole frame** by the art's 6px block into a canonical
   **102×132** art-pixel frame. Whole-frame, not bbox — bbox decimation would
   stretch each pose to fill the canvas and destroy the character's proportions
   as the stride changes. This normalises the 608×784 generations and the
   610×790 sheet reference onto one grid.
2. **Key** with `keyHero` from `scripts/slice-art.mjs`, unchanged: flood the
   backdrop from the border with the outline as a wall (dilated 1px), eat the
   drop shadow (cool mid-tones, `R−B < 0`) from the transparent edge, then cut
   everything below the lowest true-outline row (`lum < 80`).
3. **Measure** the opaque bbox and the ground row (lowest `lum < 80` pixel).
4. **Register**: translate so the **ground row lands on 123** (the row
   `Player.setOffset` pins the hitbox bottom to) and the **bbox centre-x lands
   on 51.5** (the body's centre). Measured shifts are ±1px, and every pose must
   be asserted to *fit* — a pose that clips has to fail at slicing time, named,
   not draw a missing leg in the game.
5. **Assert** scale agreement across poses (height within ~±2px) so that
   registration by translation alone is legitimate. If a future pose is drawn at
   a genuinely different size, this must fail loudly rather than silently ship a
   character that changes size mid-run.
6. **Quantise** — the step this recipe was missing until 2026-09-19, and the one
   that was visible. The shipped hero goes through `quantise()` at 32 colours;
   the registered poses arrived with **1,569–2,192 opaque colours each**, because
   they are decimated JPEGs and nothing reduced them afterwards. Same character,
   different visual idiom — and it showed at the ×2 the game always renders at
   (960×540 internal on a 1080p display), which an earlier note here had dismissed
   as an edge case. It is the normal case; see §9.

   The pass runs **once on the composed sheet**, not per frame: `-colors` derives
   one palette for the whole image, so all four frames share it. Per-frame
   quantisation would give each its own, which is the inter-frame tone drift this
   also fixes (each separate generation picks its own fur highlight, ~7 levels
   apart across the cycle). Result: **1,569–2,192 → 24–28 colours**, one shared
   palette, binary alpha preserved, and the ground row and centre column still
   exactly where step 4 put them.

**Do not "improve" the speckle with a median.** Quantising gradients leaves a few
isolated pixels in the fur (8.8% of the bear's pixels differ from all four
neighbours, against 6.7% in the shipping sprite — close enough). A 3×3 median
before quantising drops that to 4.1%, and **destroys the 1px navy outline** doing
it: measured on frame 0 through the same pass, outline pixels fall from ~600 to
115, well under the 300 that `smoke.mjs` requires. The outline is what keeps the
bear readable against snow. Measured, both ways.

**The sprite canvas widens 95 → 104.** A running stride is up to 102 art px
across where a standing bear is 95. Height is unchanged, so `HERO_H`, the
61×116 hitbox and every movement constant stay put — only the hitbox **offset**
moves, **17 → 21**, to stay centred (body spans 21..82, centre 51.5). Scaling the
poses down to fit 95 would shrink the character ~5% and break the 1:1 claim.

The margin is only a pixel, not a comfortable one: frame 2's registered bbox
spans x[1..102] of the 104-wide canvas. That is why step 4's fit assertion is
load-bearing rather than a formality, and why a future pose a pixel wider must
fail at slicing time.

**The palettes do agree with the shipping art.** Quantising independently landed
within 1–2 levels of it — fur highlight `rgb(229,217,177)` in `hero.png` against
`rgb(228,217,179)` in the poses, shade `rgb(172,174,166)` against
`rgb(173,176,168)` — so a generated idle and the existing sprite would read as the
same character. (Byte-equality says "0 of 23 colours shared", which is the
rounding, not a mismatch. Compare the levels, not the bytes.) The only real
difference is the outline, which comes out a shade darker (`rgb(40,42,54)`
against `rgb(51,55,71)`).

## 5. The game side — designed, not written

- **`BootScene`**: `load.image` → `load.spritesheet(TEX.hero, 'art/hero.png',
  { frameWidth: 104, frameHeight: 124 })`, and create the anims there (not
  lazily in the state machine, which would throw `key already exists` on a scene
  restart).
- **`Player.present(deltaMs, surface)`**, called from `LevelScene.update` right
  after `tick`. `tick` stays physics-only — that split is why this change should
  not move a single `verify-feel` number.
- **State machine** (in this order):

  | state | animation |
  |---|---|
  | airborne, `vy < 0` | `jump` |
  | airborne, falling | `fall` |
  | grounded on ice and moving | `slide` |
  | grounded, `\|vx\| > threshold` | `run`, `timeScale` from `\|vx\| / MAX_RUN_SPEED` |
  | grounded, within ~120ms of landing | `land` |
  | otherwise | `idle` |

**Four Phaser gotchas, verified in the 4.2.1 source — each one is silent:**

1. **`anims.play(key)` called every frame restarts the animation**, so the bear
   sits on frame 0 forever. Use `anims.play(key, true)` (`ignoreIfPlaying`) or
   guard on `anims.currentAnim?.key !== key`.
2. **Single-frame animations need `repeat: -1` too.** With the default `repeat:
   0` a one-frame anim completes, `isPlaying` goes false, and `play(key, true)`
   then restarts it every frame.
3. **`timeScale` is per-sprite and sticky.** If only the run branch writes it,
   idle/jump/fall inherit the last run value. Reset it to 1 in every other
   branch, clamp it (~0.6–1.25), and put hysteresis on the run/idle threshold —
   crossing it restarts the run anim at frame 0, which pops.
4. **`grounded` is one frame stale on takeoff.** `tick` reads `blocked.down`
   before the jump writes velocity, so a takeoff frame picks idle/run. Test
   `blocked.down && velocity.y >= 0` for presentation purposes.

Keep `setFlipX(dir < 0)` where it is, driven by **input**. Moving it into
presentation and deriving it from `sign(vx)` would spin the hero around mid-slide
on ice.

## 6. Verification, when it exists

- `npm run verify` — **all ten numbers unchanged.** That is the acceptance
  criterion for "this was presentation-only".
- `npm run smoke` — the existing hero checks must become **per frame**, not
  aggregates over the sheet: every frame's art on the last row, every frame
  facing right. Averaged across ten frames they pass vacuously. The thresholds
  transfer with room: the dark-rim check wants ≥300 dark pixels and the four run
  frames carry 595, 679, 603 and 650 after quantising (the shipping sprite is
  709). Note `heroSprite.width === 95` (`scripts/smoke.mjs`) is the check that
  fails the moment the canvas widens,
  and `load.spritesheet(..., {frameWidth: 104})` cannot land before that — Phaser
  floors 95/104 to zero frames, so the order in §8 is not a preference.
- New: the sheet is exactly N×104×124 (the loader floors a non-multiple and
  silently drops a column); each animation's frames index inside the sheet;
  **the run frames differ by more than a token amount**; and the registered
  frames' ground rows and centre columns agree.
- Not checkable from one snapshot: that the animation actually cycles. Sample
  `player.frame.name` over ~500ms in `verify-feel.mjs`.

## 7. Costs and what is left

**368.5 credits** (from 394). Spent 39: 16.5 finding out whether the route works
at all, then five poses at 4.5 each (four run frames, one regenerated).

Remaining poses, ~27 credits: **idle ×2, jump, fall, land, slide.** The slide is
a deliberate extra so the ice mechanic still reads once the legs move — without
it, "sliding" plays a full-rate run cycle and looks like running.

## 8. How to resume

1. Open `run-cycle-preview.html` and decide whether the four frames read as a
   run. **This is the gate** — if they read as a wobble, better to find out at
   39 credits than 66. It now shows the **quantised** frames (§4 step 6), which
   is the version that would ship, so judge that and not the older soft one.
   `npm run slice-poses` rebuilds the page from the pose JPEGs if it ever needs
   regenerating.
2. Generate the remaining six poses with the §3 recipe (reference id above, the
   bipedal clause, short prompts, "body upright" on anything that might sprawl).
3. Add them to `POSES_SRC` in `scripts/slice-poses.mjs` — the registration, the
   fit and scale assertions and the sheet are all per-pose and do not need
   touching. Ten frames means a 1040×124 sheet; `load.spritesheet` floors a
   non-multiple and silently drops a column, so assert the width.
4. Wire §5, then §6.
5. Regenerate `docs/*.png` via `npm run screenshots`, update the README's Art
   section and roadmap, add a Round 4 to `ASSET-LOG.md`, commit.

## 9. Loose ends

- The poses, the preview and this file are **committed** as of `342a59e`. The
  registered output in `assets/concepts/poses/registered/` is committed too, but
  it is derived — `npm run slice-poses` regenerates it byte-for-byte.
- The registered frames and the preview were **originally** built by throwaway
  scripts in `/tmp/pa/`. Those still exist as of 2026-09-19 but `/tmp` does not
  survive a reboot, and nothing in the repo depends on them any more: §4 is
  `scripts/slice-poses.mjs` and §3's prompts are in this file.
- **The generated poses are softer than the sheet art.** That was visible as
  1,569–2,192 opaque colours against the shipping sprite's 23, and it is what §4
  step 6 fixed; the frames are now 24–28 colours and the softness at ×2 is the
  mild fur speckle noted in §4, not a gradient. §9's old caveat — "visible at ×2,
  not at 1×" — was wrong about which case matters: ×2 *is* how the game renders
  (960×540 internal on a 1080p display). If the idle still looks wrong beside the
  shipping sprite, the fallback is a single-frame idle using the existing art,
  and the palettes now agree to within 1–2 levels, so that fallback would not
  read as a different character.
