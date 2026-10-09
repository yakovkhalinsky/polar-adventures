/**
 * Turning a PixelLab character sheet into the game's sprite frame.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * Two scripts need to agree on exactly where a bear's feet land: the preview
 * page you judge the art on (scripts/preview-hero.mjs) and the limb-visibility
 * review (scripts/review-limbs.mjs). If they each carried their own copy of the
 * registration, the review could pass on frames the preview never drew — which
 * is the same class of mistake as the two copies of the keyer that
 * scripts/slice-poses.mjs imports rather than duplicates.
 *
 * THE REGISTRATION RULE, which is the only judgement in here
 *
 * A frame is translated so its opaque bbox sits on the frame's ground row and
 * its centre column. That is what scripts/slice-poses.mjs already did for the
 * FLUX pose frames (ANIMATION-LOG.md §4 step 4), reused rather than reinvented.
 * It guarantees the foot never sinks through the ground and no frame clips,
 * because each is placed by its own extent.
 *
 * That rule is for GROUNDED art. A jump must not be registered this way —
 * planting each airborne frame would clamp it back onto the floor and delete
 * the leap — so callers pass one fixed offset for airborne states instead. See
 * preview-hero.mjs.
 */

import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writePng } from './png.mjs';

/**
 * The game's frame.
 *
 * WIDTH IS 104, not the shipping sprite's 95, and that is deliberate — this is
 * the widening ANIMATION-LOG.md §4 already designed for the FLUX run ("the
 * sprite canvas widens 95 -> 104 ... height is unchanged, so HERO_H, the 61x116
 * hitbox and every movement constant stay put — only the hitbox offset moves,
 * 17 -> 21").
 *
 * Measured, the widest art across the four states is the run at 93px, so 104
 * covers everything. At 95 the JUMP clipped: its two airborne frames are placed
 * by one FIXED offset (so the leap survives), and on those frames the trailing
 * leg reaches the edge of PixelLab's cell and ran 3-4px off the frame.
 * Re-centring those frames instead would shift the body 9px sideways mid-leap,
 * which is worse — the frame was simply too narrow.
 *
 * HEIGHT stays 124 because that is what the physics is built on: HERO_H drives
 * JUMP_HEIGHT_PX (3.5 * 124 = 434) and every movement constant scales with it.
 */
export const FRAME_W = 104;
export const FRAME_H = 124;
export const GROUND_ROW = FRAME_H - 1;
export const CENTRE_COL = (FRAME_W - 1) / 2;

/** Opaque bounding box, or null if the image is empty. */
export function bbox({ w, h, buf }) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < x0 ? null : { x0, y0, x1, y1 };
}

/** Copies one cell out of a uniform sheet grid. */
export function cell(sheet, col, row, size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = ((row * size + y) * sheet.w + col * size) * 4;
    sheet.buf.copy(buf, y * size * 4, src, src + size * 4);
  }
  return { w: size, h: size, buf };
}

/**
 * Translates art onto the game frame by (dx, dy). Returns the frame plus how
 * many pixels had to be dropped, so art that does not fit is reported rather
 * than silently shaved — a clipped foot is invisible in a preview and obvious
 * in play.
 */
export function translate(src, dx, dy) {
  const buf = Buffer.alloc(FRAME_W * FRAME_H * 4);
  let clipped = 0;
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (src.buf[i + 3] === 0) continue;
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || tx >= FRAME_W || ty < 0 || ty >= FRAME_H) {
        clipped++;
        continue;
      }
      src.buf.copy(buf, (ty * FRAME_W + tx) * 4, i, i + 4);
    }
  }
  return { frame: { w: FRAME_W, h: FRAME_H, buf }, clipped };
}

/** The offset that puts an image's silhouette on the ground row and centre column. */
export function plantOffset(src) {
  const box = bbox(src);
  if (!box) return { dx: 0, dy: 0 };
  return {
    dx: Math.round(CENTRE_COL - (box.x0 + box.x1) / 2),
    dy: GROUND_ROW - box.y1,
  };
}

/**
 * Mirrors an image horizontally.
 *
 * The animations are generated on `west`, which is this character's clean side
 * profile — but west faces LEFT, and the game's hero faces right with
 * `setFlipX` handling the left. Flipping here keeps the game's existing
 * convention untouched; deriving the facing from `sign(vx)` instead would spin
 * the bear around mid-slide on ice (ANIMATION-LOG.md §5).
 *
 * Mirror BEFORE measuring. An offset computed on unflipped art and applied to
 * flipped art lands the bear off the frame edge — measured, that silently
 * clipped 77px of the run.
 */
export function flipX(src) {
  const buf = Buffer.alloc(src.w * src.h * 4);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const from = (y * src.w + x) * 4;
      const to = (y * src.w + (src.w - 1 - x)) * 4;
      src.buf.copy(buf, to, from, from + 4);
    }
  }
  return { w: src.w, h: src.h, buf };
}

/** Lays frames out in a row, so CSS can step through them. */
export function strip(frames) {
  const w = FRAME_W * frames.length;
  const buf = Buffer.alloc(w * FRAME_H * 4);
  frames.forEach((f, i) => {
    for (let y = 0; y < FRAME_H; y++) {
      const src = y * FRAME_W * 4;
      f.buf.copy(buf, (y * w + i * FRAME_W) * 4, src, src + FRAME_W * 4);
    }
  });
  return { w, h: FRAME_H, buf };
}

/**
 * Encodes raw RGBA to a data URI by round-tripping through the one PNG writer
 * this repo has, rather than adding a second encoder for a preview.
 */
export function dataUri(w, h, buf) {
  const tmp = join(tmpdir(), `hero-preview-${w}x${h}.png`);
  writePng(tmp, w, h, buf);
  return `data:image/png;base64,${readFileSync(tmp).toString('base64')}`;
}
