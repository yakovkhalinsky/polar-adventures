# Polar Adventures — Asset Prototype Log

Prototype round 1, 2026-09-16. Model: `flux2_pro_preview` for all six.

Local files are concept/reference art, not production sprites. See "Known limits" below.

## Locked art direction

- Style: 16-bit pixel art, SNES-era platformer
- Hero: stocky athletic polar bear, cream-white fur
  (`#F2F5F8` highlight / `#9FB3C8` shadow)
- Signature accent: vivid green knitted scarf — base `#3AAE52`,
  highlight `#6FD98A`, shadow `#1F6B33`.
  This exists to solve white-on-white silhouette readability on snow.
- The green is deliberately brighter and more saturated than the taiga forest
  palette (`#2F4F3E` pine / `#5C7A46` moss) so the scarf still separates against
  that biome. **Not yet verified in situ — check this on the first forest level.**
- Superseded: an earlier `#E8503A` red-orange scarf. The `-green` files are current;
  the unsuffixed `01`/`02` files are the red versions, kept for comparison.
- Target platform: **web**.

## Round 1 outputs

| File | Request ID | What it is |
|---|---|---|
| `01-hero-turnaround-sheet.jpg` | `2ca0613f-2867-4783-bd3b-aa2c995f19cf` | Hero turnaround + poses. Concept reference only. |
| `02-hero-idle-closeup.jpg` | `5ad2892b-a7f3-4de7-b07d-7f45e6b22d24` | Hero idle, large (red scarf version). |
| `02-hero-idle-closeup-green.jpg` | `b84db1d2-444e-4c55-ac83-06207dce715b` | **THE ANCHOR.** Hero idle, green scarf. Clean, no artifacts. |
| `01-hero-turnaround-sheet-green.jpg` | `3d75cbe8-4895-433e-9e21-c7428b8d00f9` | Turnaround, green scarf. Residual red on inner ears — see limits. |
| `03-hero-run-cycle.jpg` | `703aa3f0-bf67-4792-936c-a1bd3939f249` | Run cycle strip. Weakest asset — see limits. |
| `04-tileset-arctic-ice.jpg` | `b9a330ab-95bd-4c84-a3e2-03b329c88b45` | Arctic ice tileset. Usable after slicing. |
| `05-tileset-taiga-forest.jpg` | `f2ff51e9-87d6-4ffa-9f6d-b371b2860758` | Taiga forest tileset. Usable after slicing. |
| `06-mockup-level-01.jpg` | `664b44bf-519a-4495-9260-b9360cee1a6d` | In-situ game screen mockup. Good for pitch/art direction. |

## Known limits of this approach

1. **FLUX does not produce grid-aligned sprite sheets.** The turnaround came back as a
   4/3/1 ragged layout, not the requested 4x3 grid. Frames drift in scale and spacing.
   These are art direction, not frames you can pack into an atlas.
2. **The run cycle failed as animation.** 5 frames instead of 8, and the poses are barely
   differentiated — nearly the same stance repeated. Real locomotion needs one generation
   per pose, not a strip.
3. **Character drift across generations.** The bear in `06` is close to but not identical
   with the bear in `01`/`02`. Locking identity needs image-to-image against an anchor.
4. **Tilesets are the surprise win.** They key cleanly off the flat gray background and are
   close to real tile dimensions. They still lack a true autotile set: no 45-degree slopes,
   no left/right edge caps, no separate interior-fill vs top-cap variants.

## Reproducing / iterating

Pass any request ID as `input_medias: [{id: "<request_id>"}]` to `generate_image`
to iterate on that specific image.

---

# Round 2, 2026-09-17 — can these assets actually be used?

Question: the concept art is good but was never usable in the game. Can FLUX
produce something that is? Model: `flux2_pro_preview` throughout. 12 generations.

Working images in `assets/concepts/tests/`. Raw evidence for each claim below.

## The headline: put the character and the terrain in ONE image

Every failure in this round came from generating assets **separately** and
reconciling them afterwards. A character and a tileset generated independently
carry no shared frame of reference, and no amount of prompt wording fixes it —
the model picks each one's scale on its own.

Generating them **in the same image** fixes it, because then they agree by
construction. `07-asset-sheet-bear-and-tiles.jpg` is that sheet: the bear
isolated on the left, a clean tile grid on the right, one consistent scale.

This is the single most useful thing learned. Generate against a reference, not
against a number.

## What FLUX ignores

Text instructions that specify **numbers or geometry** are not honoured:

| Asked for | Got back |
|---|---|
| "flat uniform solid magenta #FF00FF background" | flat **gray** in all 4 generations — nothing to key against |
| "at most 32 pixels tall", "exactly 24x32 pixels" | full illustration detail; a 24x32 downscale still had **190-289 distinct colours** (real pixel art is under ~20) |
| "each tile fills its cell edge to edge" | rounded rectangles on a backdrop, **35-44% of each corner box** was background |
| "two and a half blocks tall" | ~4.4 in a composed scene, ~5.6 in the asset sheet |

Text instructions that specify **content** are honoured well: "interior fill
with no snow" produced exactly that, cleanly separable from the snow-capped
tiles (snow fraction 0.70 vs 0.00, no ambiguous tiles).

**Conclusion: FLUX is reliable when it has a reference image to look at, and
unreliable when it has to take your word for a number.**

## Sizes, measured

- The native pixel block of the art is **6 source px** — measured from the
  outline stroke (6px in 499 samples; see `tests/anchor-zoom.png`).
- So the anchor hero is **90 x 140 art pixels**, not 542 x 842.
- `tests/downscale-test.png`: crushing the 1024² anchor to a 24x32 sprite slot
  is an illegible blob, and quantising makes it **worse** — the gray backdrop
  snaps to the fur colours and becomes a halo.

## The pipeline that works

All four steps are proven, not assumed:

1. **Key the backdrop** — threshold the flat gray at native scale. Works; the
   earlier failures were all at sprite scale.
2. **Slice** — gutter detection works first try on a tidy tile grid (round 1's
   `04` and round 2's `08`). It does **not** work on a composed scene: brick-laid
   blocks mean a vertical outline in one row does not continue into the next,
   and internal crack lines read as seams.
3. **Square off the corners** — extrude each row's edge colour outward to the
   bbox. Removes the pinholes. Sample a few px *inside* the outline, or the
   border colour gets painted down the tile as a visible vertical collar.
4. **Compose at native scale** — 1 art pixel = 1 screen pixel, no downscaling
   anywhere. `tests/sliced-scene.png` is the result: hero and terrain from one
   generation, stacking seamlessly.

## Still open

- **Animation.** Unchanged from round 1 — one generation per pose. Strips drift.
- **The hero:terrain ratio.** The model settles on ~4-5.6 tiles regardless of
  what is asked; the round-1 mockup uses 2.4. Fix by scaling the tiles by an
  integer factor (2x gets it to ~2.8), accepting that the two then have
  different pixel sizes — or design around the ratio it picks.
- **No true autotile semantics.** There is snow-cap and interior-fill, but no
  left/right edge caps and no 45-degree slopes.

