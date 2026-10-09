#!/usr/bin/env node
/**
 * Builds public/art/ from the procedural generators.
 *
 * This replaces scripts/slice-art.mjs, which turned one FLUX JPEG into the two
 * shipped PNGs. The source of the art is now code in scripts/art/, so this file
 * is mostly *assertions*: the drawing is deterministic, and everything that
 * could silently disagree with the game is checked here rather than noticed in
 * play.
 *
 * Two differences from the old pipeline worth knowing:
 *
 * - NOTHING IS QUANTISED. The art is drawn in scripts/art/palette.mjs, so it
 *   cannot leave those colours; the check below asserts that instead of a
 *   quantise pass enforcing it after the fact. The old pipeline needed
 *   quantisation because it started from a JPEG carrying 1,500-2,200 distinct
 *   colours per sprite.
 * - NOTHING IS KEYED. There is no backdrop and no drop shadow, because the
 *   generators emit their own alpha. The old keyer was where the ground-shadow
 *   artefact came from.
 *
 * Deterministic: running it twice produces byte-identical PNGs.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writePng } from './art/png.mjs';
import { paletteKeys } from './art/palette.mjs';
import {
  BRICK_H,
  CELL_ORDER,
  TILE_H,
  TILE_W,
  buildTileSet,
  meanColour,
  opaqueColours,
} from './art/tiles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/art');

/**
 * Reads a numeric constant out of a TypeScript config file.
 *
 * The old slicer hardcoded 70 and 66 with a comment asking the reader to keep
 * them in step with src/config/game.ts, which is a promise no one can check. The
 * tileset and the collision grid disagreeing is a silent failure — the level
 * still runs, the art is just wrong — so this reads the real value and the build
 * fails loudly if the generator has drifted from it.
 */
function tsConst(file, name) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`could not find \`export const ${name}\` in ${file}`);
  return Number(m[1]);
}

/** Per-channel mean gap between two bricks. */
function meanGap(a, b) {
  const ma = meanColour(a);
  const mb = meanColour(b);
  return Math.max(...ma.map((v, i) => Math.abs(v - mb[i])));
}

// -----------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const { canvas, bricks, cells } = buildTileSet();
const expectedW = TILE_W * CELL_ORDER.length;

// --- the generator agrees with the game ---------------------------------------

const gameW = tsConst('src/config/game.ts', 'TILE_W');
const gameH = tsConst('src/config/game.ts', 'TILE_H');
if (gameW !== TILE_W || gameH !== TILE_H) {
  throw new Error(
    `the generator draws ${TILE_W}x${TILE_H} cells but src/config/game.ts says ` +
      `${gameW}x${gameH}. The tilemap would address cells the art does not have.`,
  );
}

// --- what was drawn -----------------------------------------------------------

if (canvas.w !== expectedW || canvas.h !== TILE_H) {
  throw new Error(`tileset is ${canvas.w}x${canvas.h}, expected ${expectedW}x${TILE_H}`);
}

// The one-way cell is a single brick row; buildLevel collapses a run of ledges
// into one TileSprite of the cell's full height and relies on the rest being
// empty, or the ledge draws a solid wall below itself.
const onewayX = CELL_ORDER.indexOf('ONEWAY') * TILE_W;
for (let y = BRICK_H; y < TILE_H; y++) {
  for (let x = onewayX; x < onewayX + TILE_W; x++) {
    if (canvas.buf[(y * canvas.w + x) * 4 + 3] !== 0) {
      throw new Error(`the one-way cell has art below its brick row (row ${y})`);
    }
  }
}

// Binary alpha everywhere: a partly-transparent edge would fringe against snow.
for (let i = 3; i < canvas.buf.length; i += 4) {
  const a = canvas.buf[i];
  if (a !== 0 && a !== 255) {
    throw new Error(`tileset alpha is not binary (found ${a} at byte ${i - 3})`);
  }
}

// Palette discipline, which is what quantise() used to guarantee.
const used = opaqueColours(canvas);
const strays = [...used]
  .map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255].join(','))
  .filter((k) => !paletteKeys.has(k));
if (strays.length) {
  throw new Error(
    `tileset uses ${strays.length} colour(s) outside the palette: ${strays.slice(0, 5).join(' | ')}`,
  );
}

// The mechanic. Ice and fill converging is the game's only surface distinction
// going invisible, and it is a slow drift rather than a break.
const gap = meanGap(bricks.fill, bricks.ice);
if (gap < 4) {
  throw new Error(
    `ice and fill are only ${gap.toFixed(1)} levels apart on average — the slippery ` +
      `surface would be invisible in play.`,
  );
}

// Cells 0 and 1 must share their lower brick, or an autotiled column shows a
// seam wherever buildLevel swaps SURFACE for INTERIOR.
for (let y = BRICK_H; y < TILE_H; y++) {
  for (let x = 0; x < TILE_W; x++) {
    const a = (y * canvas.w + x) * 4;
    const b = (y * canvas.w + TILE_W + x) * 4;
    if (canvas.buf[a] !== canvas.buf[b] || canvas.buf[a + 3] !== canvas.buf[b + 3]) {
      throw new Error(`INTERIOR and SURFACE differ below the snow line (at ${x},${y})`);
    }
  }
}

// --- write --------------------------------------------------------------------

const tilesPath = join(OUT, 'tiles.png');
writePng(tilesPath, canvas.w, canvas.h, canvas.buf);

console.log(`tiles.png  ${canvas.w}x${canvas.h}  ${CELL_ORDER.length} cells:`);
CELL_ORDER.forEach((name, i) => {
  console.log(`  ${i} ${name.padEnd(9)} ${TILE_W}x${TILE_H}  cell ${i * TILE_W}..${(i + 1) * TILE_W - 1}`);
});
console.log(`  ${used.size} colours, all in the palette`);
console.log(`  ice vs fill separation  ${gap.toFixed(1)} levels (floor 4)`);
console.log(`  bricks ${BRICK_H}px tall, ${CELL_ORDER.length} cells, no quantisation pass`);
console.log(`\nwrote ${tilesPath.replace(`${ROOT}/`, '')}`);
