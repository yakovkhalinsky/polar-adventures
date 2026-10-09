/**
 * The tileset: four collision cells of 2x3 bricks, drawn from the palette.
 *
 * The game addresses one cell per tile index, and the order is a hard contract
 * with src/art/tileset.ts:
 *
 *   0 INTERIOR  buried fill, no snow
 *   1 SURFACE   snow cap over the SAME fill brick
 *   2 ONEWAY    one brick row; the lower 44px transparent
 *   3 ICE       no snow cap, and visibly not the fill
 *
 * Two of those are load-bearing beyond looking nice:
 *
 * - CELLS 0 AND 1 SHARE THEIR LOWER BRICK. buildLevel swaps a SURFACE cell for
 *   an INTERIOR cell wherever the sky is not above it, so a column of ground
 *   shows both. If the two fills differed at all, every snow line would grow a
 *   seam. They are drawn from one `rockBody()` for exactly this reason.
 * - ICE MUST READ AS DIFFERENT FROM FILL. That gap is the game's only mechanic
 *   being visible in play, and the build asserts a mean per-channel separation
 *   rather than trusting the eye.
 *
 * Everything is deterministic — no RNG, no timestamps — so `npm run build-art`
 * reproduces byte-for-byte and a diff in public/art/ always means the art moved.
 */

import { RAMP, rgb, tone } from './palette.mjs';
import { makeCanvas, bbox, opaqueColours, paintFlat } from './raster.mjs';

// Mirrored from src/config/game.ts. A collision tile is a 2x3 group of bricks,
// which is why it is 70x66 and not square — the grouping is baked in here so the
// tilemap can go on addressing one index per cell.
export const BRICK_W = 35;
export const BRICK_H = 22;
export const BRICK_COLS = 2;
export const BRICK_ROWS = 3;
export const TILE_W = BRICK_W * BRICK_COLS; // 70
export const TILE_H = BRICK_H * BRICK_ROWS; // 66

/** Cell order in the strip. Do not reorder — see src/art/tileset.ts. */
export const CELL_ORDER = ['INTERIOR', 'SURFACE', 'ONEWAY', 'ICE'];

/**
 * Sparse pitting, placed by hand rather than scattered by hash.
 *
 * The first attempt used `hash(x,y) > 0.88` across the lower half, which put
 * roughly 46 marks in every 35x22 brick and read as visual noise at 1:1 — the
 * eye resolves it as dirt on the screen rather than as stone. A handful of
 * deliberate marks carries the same texture while staying legible.
 */
const PITS = [
  [7, 6, 2],
  [19, 9, 1],
  [26, 5, 2],
  [12, 15, 2],
  [29, 13, 1],
  [4, 17, 2],
  [22, 18, 1],
];

/**
 * The rock body shared by the fill brick and by everything under a snow cap.
 *
 * Bevel is top-light / bottom-dark and the seams sit on the bottom row and the
 * right column, so adjacent bricks read as blocks without a gutter between them.
 */
function rockBody(x, y) {
  for (const [px, py, pw] of PITS) {
    if (y === py && x >= px && x < px + pw) return rgb.rock[0];
  }
  if (y === BRICK_H - 1 || x === BRICK_W - 1) return rgb.rock[0];
  if (y === 0 || x === 0) return rgb.rock[2];
  if (y === 1) return rgb.rock[1];
  return rgb.rock[1];
}

/** The buried fill brick: plain rock, no snow. */
export function fillBrick() {
  const c = makeCanvas(BRICK_W, BRICK_H);
  for (let y = 0; y < BRICK_H; y++) {
    for (let x = 0; x < BRICK_W; x++) {
      const col = rockBody(x, y);
      const i = (y * BRICK_W + x) * 4;
      c.buf[i] = col[0];
      c.buf[i + 1] = col[1];
      c.buf[i + 2] = col[2];
      c.buf[i + 3] = 255;
    }
  }
  return c;
}

/**
 * How deep the snow sits at each column of the brick.
 *
 * The first attempt was a triangle wave (`[0,1,2,1,0,-1,0]`), which produced a
 * sawtooth that read as teeth rather than snow. Snow hangs in rounded DRIPS off
 * a mostly flat line, so that is what this draws: a level cap with two drips
 * per brick, each with a rounded profile.
 *
 * The drips repeat every 35px, which is exactly one brick, so the pattern
 * continues across the joins instead of stepping at them. Getting that wrong is
 * immediately visible as a vertical line every 35px across a field of snow.
 */
const CAP_BASE = 12;
const DRIPS = [
  { at: 5, profile: [1, 3, 4, 3, 1] },
  { at: 21, profile: [1, 2, 3, 2, 1] },
];

function capDepth(x) {
  let d = CAP_BASE;
  for (const { at, profile } of DRIPS) {
    const i = x - at;
    if (i >= 0 && i < profile.length) d = Math.max(d, CAP_BASE + profile[i]);
  }
  return d;
}

/** The snow-capped brick: snow over the same rock body the fill brick uses. */
export function surfaceBrick() {
  const c = makeCanvas(BRICK_W, BRICK_H);
  for (let y = 0; y < BRICK_H; y++) {
    for (let x = 0; x < BRICK_W; x++) {
      const depth = capDepth(x);
      let col;
      if (y < depth - 2) col = rgb.snow[2]; // the bulk of the cap
      else if (y === depth - 2) col = rgb.snow[1]; // turning over
      else if (y === depth - 1) col = rgb.snow[0]; // the shadow under the lip
      else col = rockBody(x, y);
      const i = (y * BRICK_W + x) * 4;
      c.buf[i] = col[0];
      c.buf[i + 1] = col[1];
      c.buf[i + 2] = col[2];
      c.buf[i + 3] = 255;
    }
  }
  return c;
}

/**
 * The ice brick. Smooth where rock is pitted and bevelled, so the two differ in
 * *texture* as well as in hue — at 1:1 in a busy scene, hue alone is a weak
 * signal, and a flat unbewelled face is exactly what glassy ice looks like next
 * to blocky rock.
 *
 * ICE IS THE SAME DEPTH AS THE SNOW. An earlier version filled the whole 22px
 * brick with ice, which in a composited scene read as a raised kerb: the snow
 * cap is only ~12px of its brick, so an ice band of 22px put the ice surface
 * visually higher than the snow beside it even though both cells collide at the
 * same row. Matching the depth is what makes the ground read as one level.
 *
 * The two dashes are the sheen. Deliberately short and few: an earlier version
 * ran a repeating 17px diagonal across the whole brick, which read as a stripe
 * pattern rather than as a highlight on a surface.
 */
const SHEEN = [
  { x: 5, y: 6, len: 5 },
  { x: 20, y: 9, len: 4 },
];

export function iceBrick() {
  const c = makeCanvas(BRICK_W, BRICK_H);
  for (let y = 0; y < BRICK_H; y++) {
    for (let x = 0; x < BRICK_W; x++) {
      let col = rgb.ice[2];
      if (y >= CAP_BASE) {
        // Below the surface: the same rock the fill brick is made of, so an ice
        // patch sits in the ground rather than on it.
        col = rockBody(x, y);
      } else {
        for (const s of SHEEN) {
          const dx = x - s.x;
          if (dx >= 0 && dx < s.len && y === s.y + dx) col = rgb.ice[3];
        }
        // A 1px darker line under the ice, the counterpart of the snow's lip
        // shading, so the surface has a bottom edge instead of just stopping.
        if (y === CAP_BASE - 1) col = rgb.ice[1];
      }
      const i = (y * BRICK_W + x) * 4;
      c.buf[i] = col[0];
      c.buf[i + 1] = col[1];
      c.buf[i + 2] = col[2];
      c.buf[i + 3] = 255;
    }
  }
  return c;
}

/**
 * Lays bricks into one collision-sized cell. The cell is the unit the tilemap
 * addresses, so this is the only place the 2x3 relationship exists in the
 * assets — see the note in src/config/game.ts.
 */
export function composeCell(top, bottom) {
  const out = Buffer.alloc(TILE_W * TILE_H * 4);
  for (let r = 0; r < BRICK_ROWS; r++) {
    const brick = r === 0 ? top : bottom;
    for (let c = 0; c < BRICK_COLS; c++) {
      for (let y = 0; y < BRICK_H; y++) {
        for (let x = 0; x < BRICK_W; x++) {
          const s = (y * BRICK_W + x) * 4;
          const d = ((r * BRICK_H + y) * TILE_W + c * BRICK_W + x) * 4;
          out[d] = brick.buf[s];
          out[d + 1] = brick.buf[s + 1];
          out[d + 2] = brick.buf[s + 2];
          out[d + 3] = brick.buf[s + 3];
        }
      }
    }
  }
  return out;
}

/** A cell carrying one brick row and nothing below: the one-way ledge. */
export function composeLedge(brick) {
  const out = Buffer.alloc(TILE_W * TILE_H * 4);
  for (let c = 0; c < BRICK_COLS; c++) {
    for (let y = 0; y < BRICK_H; y++) {
      for (let x = 0; x < BRICK_W; x++) {
        const s = (y * BRICK_W + x) * 4;
        const d = (y * TILE_W + c * BRICK_W + x) * 4;
        out[d] = brick.buf[s];
        out[d + 1] = brick.buf[s + 1];
        out[d + 2] = brick.buf[s + 2];
        out[d + 3] = brick.buf[s + 3];
      }
    }
  }
  return out;
}

/** Concatenates cells left to right into the strip the game loads. */
export function composeTiles(cells) {
  const out = Buffer.alloc(TILE_W * cells.length * TILE_H * 4);
  cells.forEach((cell, i) => {
    for (let y = 0; y < TILE_H; y++) {
      for (let x = 0; x < TILE_W; x++) {
        const s = (y * TILE_W + x) * 4;
        const d = (y * TILE_W * cells.length + i * TILE_W + x) * 4;
        out[d] = cell[s];
        out[d + 1] = cell[s + 1];
        out[d + 2] = cell[s + 2];
        out[d + 3] = cell[s + 3];
      }
    }
  });
  return out;
}

/** Draws the whole strip. Returns `{ canvas, bricks }` so the build can assert on it. */
export function buildTileSet() {
  const bricks = { fill: fillBrick(), surface: surfaceBrick(), ice: iceBrick() };
  const cells = [
    composeCell(bricks.fill, bricks.fill), // 0 INTERIOR
    composeCell(bricks.surface, bricks.fill), // 1 SURFACE
    composeLedge(bricks.surface), // 2 ONEWAY
    composeCell(bricks.ice, bricks.fill), // 3 ICE
  ];
  const buf = composeTiles(cells);

  const canvas = makeCanvas(TILE_W * cells.length, TILE_H);
  buf.copy(canvas.buf);
  return { canvas, bricks, cells };
}

/** Mean per-channel colour of a brick, for the ice-vs-fill contrast assertion. */
export function meanColour(brick) {
  const sums = [0, 0, 0];
  const n = brick.w * brick.h;
  for (let i = 0; i < n; i++) {
    sums[0] += brick.buf[i * 4];
    sums[1] += brick.buf[i * 4 + 1];
    sums[2] += brick.buf[i * 4 + 2];
  }
  return sums.map((s) => s / n);
}

export { bbox, opaqueColours, paintFlat, tone };
