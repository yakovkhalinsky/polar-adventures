#!/usr/bin/env node
/**
 * Reviews whether the bear's LIMBS read during movement.
 *
 * WHY THIS IS NEEDED
 *
 * A run cycle fails in a specific, quiet way: the near and far legs are the same
 * colour and overlap, so they merge into a single blob and the cycle reads as a
 * wobble rather than a stride. Nothing in the existing checks would catch it —
 * the frames differ by plenty of pixels, the heights agree, and the sprite is
 * the right size. It only shows up when someone looks at the legs.
 *
 * So this measures the two things that decide it, per frame:
 *
 *   1. HOW MANY SEPARATE SHAPES the legs make. Connected components of the
 *      opaque silhouette in the lower band. Two shapes read as two legs; one
 *      reads as a single limb however much the outline wiggles.
 *   2. HOW MANY DISTINCT TONES are in that band. Two legs are far easier to
 *      tell apart if the far one is drawn darker. If the whole band is one
 *      colour, geometry is doing all the work.
 *
 * It writes a contact sheet of the leg bands at 5x so the numbers can be checked
 * by eye, because a component count is a proxy and the point is the look.
 *
 * Frames come from the SAME registration the preview page uses
 * (scripts/art/frames.mjs), so this cannot pass frames the preview never drew.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FRAME_H,
  FRAME_W,
  GROUND_ROW,
  bbox,
  cell,
  flipX,
  plantOffset,
  translate,
} from './art/frames.mjs';
import { loadRGBA, writePng } from './art/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONCEPTS = join(ROOT, 'assets/concepts');
const STEM = process.argv[2] ?? 'polar-bear-ref';
const SHEET = join(CONCEPTS, 'pixellab', `${STEM}.png`);
const LAYOUT = join(CONCEPTS, 'pixellab', `${STEM}.json`);
const OUT_PNG = join(CONCEPTS, `${STEM}-limbs.png`);

/**
 * The band of the frame the legs occupy, counted from the ground row up.
 *
 * The bear stands ~120px tall in a 124px frame, so the bottom 56 rows are
 * everything below the hips — thighs, shins and feet. Taking it as a fixed band
 * rather than trying to detect the hips keeps this comparable between frames:
 * the band must not move, or a leg leaving it would look like a merge.
 */
const BAND_H = 56;
const BAND_TOP = GROUND_ROW - BAND_H + 1;

/**
 * Which animations to review, as [label, sheetAnimationName, plantedPerFrame].
 *
 * Default is run and jump. `node scripts/review-limbs.mjs <stem> <a,b,c>`
 * reviews an explicit list instead, which is how candidate animations get
 * compared — a template that draws a leg as an indistinct mass is only visible
 * lined up against the alternatives.
 *
 * `planted` is true for grounded cycles and false for a jump: planting a jump's
 * airborne frames would clamp the leap to the floor and delete it. This is the
 * one flag kept in step with preview-hero.mjs by hand; the registration, which
 * is the subtle part, is imported rather than copied.
 */
const GROUNDED = new Set(['idle', 'run', 'slide']);

const WANT = (() => {
  const given = process.argv[3];
  const names = given ? given.split(',') : ['run-w', 'jump-w'];
  return names.map((name) => [name.replace(/-w$/, ''), name, GROUNDED.has(name.replace(/-w$/, ''))]);
})();

const ZOOM = 5;

// -----------------------------------------------------------------------------

const sheet = loadRGBA(SHEET);
const layout = JSON.parse(readFileSync(LAYOUT, 'utf8'));
const size = layout.spritesheet.cell_size.width;
const byName = new Map();
for (const row of layout.spritesheet.rows) {
  if (row.type === 'animation') byName.set(row.animation, row);
}

const cellsOf = (row) =>
  Array.from({ length: row.frame_count }, (_, i) => flipX(cell(sheet, i, row.row, size)));

const anchor = plantOffset(cellsOf(byName.get('idle-w'))[0]);

/**
 * How many separate runs of opaque pixels each row has, in the band.
 *
 * This is the measurement that actually answers the question. Counting blobs
 * across the whole band does not: the legs join the torso at the hips, so the
 * band is ONE connected component in every frame — measured, every run frame
 * reported "1 blob" and the number was useless.
 *
 * A row with two runs means the legs are separated at that height, with
 * background showing between them. The failure this guards against is a cycle
 * where no row ever splits: the two legs overlap and the stride reads as one
 * limb however much the outline moves.
 */
function rowRuns(frame, top) {
  const runs = [];
  for (let y = top; y <= GROUND_ROW; y++) {
    let n = 0;
    let prev = false;
    for (let x = 0; x < FRAME_W; x++) {
      const on = frame.buf[(y * FRAME_W + x) * 4 + 3] > 0;
      if (on && !prev) n++;
      prev = on;
    }
    runs.push(n);
  }
  return runs;
}

/** Largest gap (in px) between two opaque runs on any row of the band — the
 *  visible space between the legs. Zero means the legs never separate. */
function widestGap(frame, top) {
  let best = 0;
  for (let y = top; y <= GROUND_ROW; y++) {
    let lastEnd = -1;
    let x = 0;
    while (x < FRAME_W) {
      if (frame.buf[(y * FRAME_W + x) * 4 + 3] > 0) {
        if (lastEnd >= 0) best = Math.max(best, x - lastEnd - 1);
        while (x < FRAME_W && frame.buf[(y * FRAME_W + x) * 4 + 3] > 0) x++;
        lastEnd = x - 1;
      } else {
        x++;
      }
    }
  }
  return best;
}

/** Distinct opaque colours in a band, most common first. */
function tones(frame, top) {
  const counts = new Map();
  for (let y = top; y <= GROUND_ROW; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      const i = (y * FRAME_W + x) * 4;
      if (frame.buf[i + 3] === 0) continue;
      const key = `${frame.buf[i]},${frame.buf[i + 1]},${frame.buf[i + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// --- gather -------------------------------------------------------------------

const results = [];
for (const [state, source, planted] of WANT) {
  const row = byName.get(source);
  if (!row) throw new Error(`the sheet has no animation named "${source}"`);
  const frames = [];
  for (const src of cellsOf(row)) {
    const off = planted ? plantOffset(src) : anchor;
    frames.push(translate(src, off.dx, off.dy).frame);
  }
  results.push({ state, source, frames });
}

// --- report -------------------------------------------------------------------

console.log(`frame ${FRAME_W}x${FRAME_H}, leg band rows ${BAND_TOP}..${GROUND_ROW} (${BAND_H}px)\n`);
console.log(
  `${'state'.padEnd(6)} ${'frm'.padStart(3)}  ${'maxRuns'.padStart(7)} ${'rowsSplit'.padStart(9)} ` +
    `${'gap px'.padStart(6)}  verdict`,
);

for (const { state, frames } of results) {
  frames.forEach((f, i) => {
    const runs = rowRuns(f, BAND_TOP);
    const maxRuns = Math.max(...runs);
    const rowsSplit = runs.filter((n) => n >= 2).length;
    const gap = widestGap(f, BAND_TOP);
    // Two legs read as two when at least one row splits them AND there is real
    // space between them. A 1-2px gap is a crack, not a separation.
    const verdict =
      maxRuns < 2 ? 'MERGED — legs never separate'
        : gap < 3 ? `BARELY — only ${gap}px of daylight`
          : 'separated';
    console.log(
      `${state.padEnd(6)} ${String(i).padStart(3)}  ${String(maxRuns).padStart(7)} ` +
        `${String(rowsSplit).padStart(9)} ${String(gap).padStart(6)}  ${verdict}`,
    );
  });
  console.log();
}

// --- tone check ---------------------------------------------------------------
// Geometry is only half of it: two legs of the SAME colour still merge visually
// even when a thin gap separates them. The far leg being a shade darker is what
// makes the near/far pair legible.

console.log('tones in the leg band (top 4):');
for (const { state, frames } of results) {
  const t = tones(frames[0], BAND_TOP);
  console.log(
    `  ${state.padEnd(6)} ${t.length} distinct — ` +
      t.slice(0, 4).map(([c, n]) => `${c.split(',').map(Number).join('/')} (${n}px)`).join(', '),
  );
}
console.log();

// --- contact sheet ------------------------------------------------------------
// Full frames at 2x on top, the leg band at 5x underneath, so the eye can check
// what the numbers claim.

const COLS = Math.max(...results.map((r) => r.frames.length));
const CELL_W = FRAME_W * 2;
const CELL_H = FRAME_H * 2;
const BAND_ZOOM_W = FRAME_W * ZOOM;
const BAND_ZOOM_H = BAND_H * ZOOM;
const ROW_H = CELL_H + BAND_ZOOM_H + 12;

const sheetBuf = Buffer.alloc(CELL_W * COLS * ROW_H * results.length * 4);

function blit(dst, dw, dx, dy, src, sx0, sy0, sw, sh, zoom) {
  for (let y = 0; y < sh * zoom; y++) {
    for (let x = 0; x < sw * zoom; x++) {
      const si = ((sy0 + Math.floor(y / zoom)) * src.w + (sx0 + Math.floor(x / zoom))) * 4;
      const di = ((dy + y) * dw + dx + x) * 4;
      if (di + 3 >= dst.length) continue;
      src.buf.copy(dst, di, si, si + 4);
    }
  }
}

const DW = CELL_W * COLS;
results.forEach((r, ri) => {
  const baseY = ri * ROW_H;
  r.frames.forEach((f, i) => {
    const x = i * CELL_W;
    blit(sheetBuf, DW, x, baseY, f, 0, 0, FRAME_W, FRAME_H, 2);
    blit(sheetBuf, DW, x, baseY + CELL_H + 6, f, 0, BAND_TOP, FRAME_W, BAND_H, ZOOM);
  });
});

mkdirSync(dirname(OUT_PNG), { recursive: true });
writePng(OUT_PNG, DW, ROW_H * results.length, sheetBuf);
console.log(`wrote ${OUT_PNG.replace(`${ROOT}/`, '')}  (${DW}x${ROW_H * results.length})`);
console.log('rows: top = full frame at 2x, bottom = the leg band at 5x');
