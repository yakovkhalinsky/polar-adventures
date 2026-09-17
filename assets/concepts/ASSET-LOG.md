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
