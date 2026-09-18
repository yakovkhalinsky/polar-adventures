/**
 * Slices the game's runtime art out of the concept sheet.
 *
 * The concept art is a JPEG illustration, not an asset. This turns one sheet
 * into the two PNGs the game loads, and it does it reproducibly: re-running it
 * produces byte-identical files, so a diff on public/art/ always means the art
 * actually changed. (That takes `-strip` and an explicit `-depth 8` — see
 * writePng. Both outputs are written through ImageMagick, so the guarantee is
 * only as strong as the installed build's palette choice; look at the preview
 * before committing a re-slice on a different version.)
 *
 * Run with `npm run slice-art`. Needs ImageMagick `magick` on PATH for JPEG
 * decode and PNG encode only; the OUTPUTS ARE COMMITTED, so neither the build
 * nor either test harness needs it.
 *
 * What the sheet gives us, and why the numbers are what they are:
 *
 *   hero    568x743 source px at 6 source px per art pixel = 95x124 art px,
 *           which is HERO_H exactly. The game was rescaled against this sheet,
 *           so the art drops in at 1:1 with nothing resampled.
 *   brick   213x136 source px = 35x22 art px. A collision tile is a 2x3 GROUP
 *           of bricks (70x66) — see the note in src/config/game.ts.
 *
 * The hard part is not slicing, it is keying. See `keyHero`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- source -----------------------------------------------------------------

const SOURCE = join(ROOT, 'assets/concepts/07-asset-sheet-bear-and-tiles.jpg');

/**
 * The tile grid's half of the sheet. The character lives to the left of it, so
 * this rect is also what separates the two.
 */
const TILE_REGION = { x: 780, y: 40, w: 690, h: 920 };

/**
 * Which grid row supplies which brick, 0-based in the detected grid.
 *
 * Measured, not guessed: rows 1-2 carry 29-30% snow pixels and rows 3-6 carry
 * 0%, so the snow cap is unambiguous. Among the snow-free rows, row 5 is the
 * darker, more cracked one (avg 107,147,179 against row 3's 112,156,188), which
 * is what makes it read as a distinct ice surface rather than as more of the
 * same fill. `assertBricks` re-checks the snow split, so a future sheet cannot
 * quietly swap the ceiling for the floor.
 */
const BRICK_ROW = { surface: 0, interior: 2, ice: 4 };

// ---- target sizes -----------------------------------------------------------

const BRICK_W = 35;
const BRICK_H = 22;
const BRICK_COLS = 2;
const BRICK_ROWS = 3;
const TILE_W = BRICK_W * BRICK_COLS; // 70
const TILE_H = BRICK_H * BRICK_ROWS; // 66

const HERO_W = 95;
const HERO_H = 124;

/** Source pixels per art pixel. The art is drawn on a 6px block. */
const BLOCK = 6;

// ---- keying thresholds ------------------------------------------------------

/**
 * The sheet's flat backdrop. Worth knowing: it is NOT safely separable from the
 * bear by colour. The backdrop is rgb(165,164,159) and the bear's shaded fur is
 * rgb(174,177,170) — nine levels apart. Any tolerance wide enough to key the
 * backdrop punches straight through the bear's hip and hind leg. That single
 * fact is why keyHero floods from the border instead of thresholding.
 */
const BACKDROP = [165, 164, 159];

/** Tolerance for the backdrop test, used on tiles and for grid detection. */
const BG_TOL = 26;

/** Luminance above which nothing is the navy outline (outline is ~34). */
const OUTLINE_LUM = 80;

/** Luminance below which a pixel is structure the flood must not cross (~34). */
const WALL_LUM = 140;

/** The drop shadow: cool mid-tones. Fur shade is ~174 and warm (R-B +4). */
const SHADOW_LUM = [100, 152];

// -----------------------------------------------------------------------------

const magick = (() => {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error(
      'ImageMagick not found. This script shells out to `magick` for JPEG ' +
        'decode and PNG encode.\nInstall it (Arch: `pacman -S imagemagick`), ' +
        'or use the already-committed PNGs in public/art/.',
    );
    process.exit(2);
  }
  return true;
})();

/** Reads any image into raw non-premultiplied RGBA. */
function loadRGBA(file) {
  const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', file])
    .toString()
    .trim()
    .split(' ')
    .map(Number);
  const buf = execFileSync('magick', [file, '-depth', '8', 'rgba:-'], {
    maxBuffer: 1 << 28,
  });
  return { w, h, buf };
}

/** Writes raw RGBA out as a PNG, via ImageMagick's raw reader. */
function writePng(file, w, h, buf) {
  execFileSync(
    'magick',
    // -depth 8 explicitly: this machine's magick is a Q16 build, and 8-bit
    // output is its default for raw input rather than a guarantee. Sixteen-bit
    // PNGs would load fine and double the file size for nothing.
    //
    // -strip keeps the output byte-reproducible; see the note in quantise().
    ['-size', `${w}x${h}`, '-depth', '8', 'rgba:-', '-strip', '-depth', '8', file],
    { input: buf },
  );
}

/**
 * Reduces an image to a small palette. Runs LAST, after keying — the ASSET-LOG
 * records that quantising first "makes it worse", because the backdrop then
 * snaps onto the fur colours and becomes a halo.
 *
 * `png:color-type=6` forces truecolour-with-alpha output. Without it the
 * encoder is free to emit a palette PNG, which is fine for the opaque tiles but
 * would mangle the hero's keyed alpha.
 *
 * NOTE on reproducibility: `-colors` is deterministic for a given ImageMagick
 * build, but the choice of palette is not specified across versions. Re-running
 * this is only guaranteed to reproduce the committed PNGs on a matching magick;
 * otherwise expect the same art in slightly different colours, and look at the
 * preview before committing it.
 */
function quantise(file, colors) {
  const tmp = `${file}.tmp.png`;
  try {
    execFileSync('magick', [
      file,
      '-colors',
      String(colors),
      '-dither',
      'None',
      '-define',
      'png:color-type=6',
      tmp,
    ]);
    // -strip drops the tEXt chunks magick writes by default, which carry
    // date:create / date:modify / date:timestamp. Without it the output is
    // pixel-identical run to run but never byte-identical, so the committed
    // PNGs churn on every re-slice and a real change is invisible in the diff.
    execFileSync('magick', [tmp, '-strip', '-depth', '8', file]);
  } finally {
    // In a finally, so a failed quantise does not leave a stray .tmp.png in
    // public/art/ that the next run would then pick up and ship.
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

const lum = (buf, p) =>
  0.299 * buf[p * 4] + 0.587 * buf[p * 4 + 1] + 0.114 * buf[p * 4 + 2];

const isBackdrop = (buf, p) =>
  Math.abs(buf[p * 4] - BACKDROP[0]) <= BG_TOL &&
  Math.abs(buf[p * 4 + 1] - BACKDROP[1]) <= BG_TOL &&
  Math.abs(buf[p * 4 + 2] - BACKDROP[2]) <= BG_TOL;

// -----------------------------------------------------------------------------
// decimation
// -----------------------------------------------------------------------------

/**
 * Reduces a source rect to `ow x oh` art pixels, one output pixel per drawn
 * block.
 *
 * Takes the MEDIAN colour of each block rather than a sampled or averaged one.
 * The source is a JPEG at six times the art resolution, so every block edge
 * carries ringing; an average spreads that ringing into the block, and nearest
 * sampling keeps it. The median discards it, which is what lets the result look
 * like pixel art instead of a photograph of pixel art.
 *
 * The block is fractional (568/95 = 5.98) deliberately: the art was drawn on a
 * 6px grid but the illustration's own bbox is a pixel or two off it, so the
 * mapping is spread evenly across the whole rect rather than dropped.
 */
function decimate(src, sx, sy, sw, sh, ow, oh) {
  const out = Buffer.alloc(ow * oh * 4);
  const R = [];
  const G = [];
  const B = [];

  for (let oy = 0; oy < oh; oy++) {
    const y0 = sy + (oy * sh) / oh;
    const y1 = sy + ((oy + 1) * sh) / oh;
    for (let ox = 0; ox < ow; ox++) {
      const x0 = sx + (ox * sw) / ow;
      const x1 = sx + ((ox + 1) * sw) / ow;

      R.length = 0;
      G.length = 0;
      B.length = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const i = (y * src.w + x) * 4;
          R.push(src.buf[i]);
          G.push(src.buf[i + 1]);
          B.push(src.buf[i + 2]);
        }
      }
      R.sort((a, b) => a - b);
      G.sort((a, b) => a - b);
      B.sort((a, b) => a - b);

      const m = R.length >> 1;
      const o = (oy * ow + ox) * 4;
      out[o] = R[m];
      out[o + 1] = G[m];
      out[o + 2] = B[m];
      out[o + 3] = 255;
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// hero keying
// -----------------------------------------------------------------------------

/**
 * Cuts the bear out of the sheet.
 *
 * Three passes, because no single one is enough:
 *
 * 1. FLOOD the backdrop from the border, treating dark pixels as walls. Colour
 *    thresholding cannot work here (the fur shade is nine levels off the
 *    backdrop), but connectivity can: the backdrop is one big region touching
 *    every edge, and the bear is inside a closed navy outline. The walls are
 *    dilated 1px first because the outline is not quite closed at the scale
 *    this runs at, and a single gap lets the flood into the whole hip.
 *
 * 2. EAT THE DROP SHADOW. The flood stops at the shadow, because the shadow
 *    (lum ~132) is dark enough to count as a wall — and that is load-bearing,
 *    since the shadow is also the path the flood was using to reach the bear's
 *    underside. So the shadow is removed after the fact, by flooding again
 *    *within the opaque region* from the transparent boundary through pixels
 *    that look like shadow: cool mid-tones. The outline (lum ~34) is too dark
 *    and the fur (R-B +4) is too warm, so neither is caught.
 *
 * 3. CUT AT THE GROUND PLANE, defined as the lowest row carrying a real outline
 *    pixel. Everything below it is shadow that pass 2 could not reach — the
 *    flat smear directly under the paws. Note the outline test is much darker
 *    than the wall test on purpose: reuse the wall threshold and the shadow
 *    would define its own ground plane and survive.
 *
 * Returns a mask of pixels to CLEAR, plus the ground row.
 */
function keyHero(buf, w, h) {
  const n = w * h;

  const wall = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (lum(buf, p) < WALL_LUM) wall[p] = 1;
  const thick = Uint8Array.from(wall);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (wall[p]) continue;
      if (
        (x > 0 && wall[p - 1]) ||
        (x < w - 1 && wall[p + 1]) ||
        (y > 0 && wall[p - w]) ||
        (y < h - 1 && wall[p + w])
      ) {
        thick[p] = 1;
      }
    }
  }

  // 1. flood the backdrop from every border pixel
  const clear = new Uint8Array(n);
  const stack = [];
  const flood = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (clear[p] || thick[p]) return;
    clear[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) {
    flood(x, 0);
    flood(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    flood(0, y);
    flood(w - 1, y);
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p - x) / w;
    flood(x + 1, y);
    flood(x - 1, y);
    flood(x, y + 1);
    flood(x, y - 1);
  }

  // 2. eat the drop shadow, spreading only from the already-transparent edge
  const isShadow = (p) => {
    const l = lum(buf, p);
    return l >= SHADOW_LUM[0] && l < SHADOW_LUM[1] && buf[p * 4] - buf[p * 4 + 2] < 0;
  };
  const eats = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (clear[p] || !isShadow(p)) continue;
      if (
        (x > 0 && clear[p - 1]) ||
        (x < w - 1 && clear[p + 1]) ||
        (y > 0 && clear[p - w]) ||
        (y < h - 1 && clear[p + w])
      ) {
        clear[p] = 1;
        eats.push(p);
      }
    }
  }
  while (eats.length) {
    const p = eats.pop();
    const x = p % w;
    const y = (p - x) / w;
    for (const q of [p + 1, p - 1, p + w, p - w]) {
      if (q < 0 || q >= n) continue;
      if (Math.abs((q % w) - x) > 1) continue; // no wrap around a row
      if (clear[q] || !isShadow(q)) continue;
      clear[q] = 1;
      eats.push(q);
    }
  }

  // 3. cut below the ground plane
  let ground = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (lum(buf, p) < OUTLINE_LUM) ground = Math.max(ground, y);
    }
  }
  if (ground < 0) throw new Error('no outline pixels found — is this the sheet?');
  for (let y = ground + 1; y < h; y++) {
    for (let x = 0; x < w; x++) clear[y * w + x] = 1;
  }

  return { clear, ground };
}

// -----------------------------------------------------------------------------
// tile keying
// -----------------------------------------------------------------------------

/**
 * Makes a brick fully opaque, by extruding its own edge colours outward to the
 * cell box.
 *
 * Bricks are cut from a grid where they touch their neighbours, so their rounded
 * corners are backdrop. Left as-is, a floor of them is full of one-pixel holes
 * you can see the sky through. The ASSET-LOG's step 3, and it warns about the
 * same trap this avoids: sample a few pixels INSIDE the outline, or the border
 * colour gets painted down the whole tile as a visible collar. Extruding from
 * the first opaque pixel in each row and column is exactly that.
 *
 * Colour test rather than a flood here, and that is safe: a brick's body is
 * 50+ levels off the backdrop in every channel, unlike the bear's fur.
 */
function squareOff(buf, w, h) {
  const at = (x, y) => (y * w + x) * 4;
  const blank = (p) => isBackdrop(buf, p);

  for (let y = 0; y < h; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < w; x++) {
      if (blank(at(x, y))) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first < 0) continue;
    for (let x = 0; x < first; x++) {
      for (let c = 0; c < 4; c++) buf[at(x, y) + c] = buf[at(first, y) + c];
    }
    for (let x = last + 1; x < w; x++) {
      for (let c = 0; c < 4; c++) buf[at(x, y) + c] = buf[at(last, y) + c];
    }
  }

  for (let x = 0; x < w; x++) {
    let first = -1;
    let last = -1;
    for (let y = 0; y < h; y++) {
      if (blank(at(x, y))) continue;
      if (first < 0) first = y;
      last = y;
    }
    if (first < 0) continue;
    for (let y = 0; y < first; y++) {
      for (let c = 0; c < 4; c++) buf[at(x, y) + c] = buf[at(x, first) + c];
    }
    for (let y = last + 1; y < h; y++) {
      for (let c = 0; c < 4; c++) buf[at(x, y) + c] = buf[at(x, last) + c];
    }
  }
  return buf;
}

// -----------------------------------------------------------------------------

function detectGrid(src, region) {
  const blankRuns = (isBlank, from, to, min) => {
    const runs = [];
    let start = -1;
    for (let i = from; i <= to; i++) {
      const blank = i < to && isBlank(i);
      if (blank && start === -1) start = i;
      else if (!blank && start !== -1) {
        if (i - start >= min) runs.push([start, i - 1]);
        start = -1;
      }
    }
    return runs;
  };
  const cells = (runs, from, to) => {
    const out = [];
    let edge = from;
    for (const [s, e] of runs) {
      out.push([edge, s - 1]);
      edge = e + 1;
    }
    out.push([edge, to - 1]);
    return out.filter(([a, b]) => b >= a);
  };

  const colBlank = (x) => {
    for (let y = region.y; y < region.y + region.h; y++) {
      if (!isBackdrop(src.buf, y * src.w + x)) return false;
    }
    return true;
  };
  const rowBlank = (y) => {
    for (let x = region.x; x < region.x + region.w; x++) {
      if (!isBackdrop(src.buf, y * src.w + x)) return false;
    }
    return true;
  };

  const colRuns = blankRuns(colBlank, region.x, region.x + region.w, 4);
  const rowRuns = blankRuns(rowBlank, region.y, region.y + region.h, 4);
  return {
    cols: cells(colRuns, region.x, region.x + region.w),
    rows: cells(rowRuns, region.y, region.y + region.h),
  };
}

/** Bbox of non-backdrop pixels within a region — the bear, or a single cell. */
function bboxOf(src, region) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      if (isBackdrop(src.buf, y * src.w + x)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Fraction of a brick's pixels that read as snow. */
function snowFraction(brick, w, h) {
  let snow = 0;
  for (let p = 0; p < w * h; p++) {
    if (brick[p * 4] > 200 && brick[p * 4 + 1] > 205 && brick[p * 4 + 2] > 200) snow++;
  }
  return snow / (w * h);
}

// -----------------------------------------------------------------------------

function buildHero(src) {
  const region = { x: 0, y: 0, w: TILE_REGION.x, h: src.h };
  const box = bboxOf(src, region);

  const blockX = box.w / HERO_W;
  const blockY = box.h / HERO_H;
  const within = (v) => Math.abs(v - BLOCK) / BLOCK < 0.05;
  if (!within(blockX) || !within(blockY)) {
    throw new Error(
      `hero bbox ${box.w}x${box.h} is not ${HERO_W}x${HERO_H} at a ${BLOCK}px ` +
        `block (got ${blockX.toFixed(2)} and ${blockY.toFixed(2)}). The sheet ` +
        `and the game have drifted apart — check HERO_H in config/movement.ts.`,
    );
  }

  const art = decimate(src, box.x, box.y, box.w, box.h, HERO_W, HERO_H);
  const { clear, ground } = keyHero(art, HERO_W, HERO_H);
  for (let p = 0; p < HERO_W * HERO_H; p++) if (clear[p]) art[p * 4 + 3] = 0;

  // The hitbox is pinned to the sprite's LAST row (Player.setOffset), so the
  // paws have to land there. The keyed art's ground plane sits a couple of rows
  // above the bottom of the box it was cut from — that gap is the shadow.
  const shift = HERO_H - 1 - ground;
  if (shift < 0) throw new Error(`ground plane ${ground} is outside the sprite`);
  const out = Buffer.alloc(HERO_W * HERO_H * 4);
  for (let y = 0; y < HERO_H - shift; y++) {
    art.copy(
      out,
      ((y + shift) * HERO_W) * 4,
      y * HERO_W * 4,
      (y + 1) * HERO_W * 4,
    );
  }

  return { png: out, box, ground, shift };
}

function buildBricks(src, grid) {
  const pick = (rowIndex) => {
    const [x0, x1] = grid.cols[0];
    const [y0, y1] = grid.rows[rowIndex];
    const brick = decimate(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, BRICK_W, BRICK_H);
    return squareOff(brick, BRICK_W, BRICK_H);
  };

  const bricks = {
    surface: pick(BRICK_ROW.surface),
    interior: pick(BRICK_ROW.interior),
    ice: pick(BRICK_ROW.ice),
  };

  // The one measurable claim the tile roles rest on: the surface brick has snow
  // on it and the other two do not. If a future sheet inverts that, the ice
  // mechanic becomes invisible in play — so fail here rather than ship it.
  const snow = {
    surface: snowFraction(bricks.surface, BRICK_W, BRICK_H),
    interior: snowFraction(bricks.interior, BRICK_W, BRICK_H),
    ice: snowFraction(bricks.ice, BRICK_W, BRICK_H),
  };
  if (snow.surface < 0.2) {
    throw new Error(`surface brick is only ${(snow.surface * 100).toFixed(0)}% snow`);
  }
  if (snow.interior > 0 || snow.ice > 0) {
    throw new Error(
      `interior/ice bricks must have no snow, got ${(snow.interior * 100).toFixed(1)}% ` +
        `and ${(snow.ice * 100).toFixed(1)}%`,
    );
  }
  return { bricks, snow };
}

/**
 * Lays bricks into one collision-sized cell. The cell is the unit the tilemap
 * addresses, so this composition is the only place the 2x3 relationship exists
 * in the assets — see the note in src/config/game.ts.
 */
function composeCell(top, bottom) {
  const out = Buffer.alloc(TILE_W * TILE_H * 4);
  for (let r = 0; r < BRICK_ROWS; r++) {
    const brick = r === 0 ? top : bottom;
    for (let c = 0; c < BRICK_COLS; c++) {
      for (let y = 0; y < BRICK_H; y++) {
        for (let x = 0; x < BRICK_W; x++) {
          const s = (y * BRICK_W + x) * 4;
          const d = ((r * BRICK_H + y) * TILE_W + c * BRICK_W + x) * 4;
          out[d] = brick[s];
          out[d + 1] = brick[s + 1];
          out[d + 2] = brick[s + 2];
          out[d + 3] = brick[s + 3];
        }
      }
    }
  }
  return out;
}

/** A cell with a transparent lower half: the one-way ledge is one brick row. */
function composeLedge(brick) {
  const out = Buffer.alloc(TILE_W * TILE_H * 4);
  for (let c = 0; c < BRICK_COLS; c++) {
    for (let y = 0; y < BRICK_H; y++) {
      for (let x = 0; x < BRICK_W; x++) {
        const s = (y * BRICK_W + x) * 4;
        const d = (y * TILE_W + c * BRICK_W + x) * 4;
        out[d] = brick[s];
        out[d + 1] = brick[s + 1];
        out[d + 2] = brick[s + 2];
        out[d + 3] = brick[s + 3];
      }
    }
  }
  return out;
}

function composeTiles(cells) {
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

// -----------------------------------------------------------------------------

/**
 * A scene at the game's real geometry, so the slicer can be judged without
 * booting Phaser. This is the evidence image the ASSET-LOG refers to.
 */
function composePreview(hero, tiles) {
  const W = 480;
  const H = 300;
  const out = Buffer.alloc(W * H * 4);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = (y * W + x) * 4;
      out[d] = 0x10;
      out[d + 1] = 0x1a;
      out[d + 2] = 0x2b;
      out[d + 3] = 255;
    }
  }

  const blit = (src, sw, sh, dx, dy) => {
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const s = (y * sw + x) * 4;
        if (!src[s + 3]) continue;
        const ox = dx + x;
        const oy = dy + y;
        if (ox < 0 || oy < 0 || ox >= W || oy >= H) continue;
        const d = (oy * W + ox) * 4;
        out[d] = src[s];
        out[d + 1] = src[s + 1];
        out[d + 2] = src[s + 2];
        out[d + 3] = 255;
      }
    }
  };

  // The cells, in TILE_INDEX order, as a legend strip along the top.
  tiles.cells.forEach((cell, i) => blit(cell, TILE_W, TILE_H, 8 + i * (TILE_W + 6), 8));

  const groundTop = 210;
  const row = (cell, y, from, to) => {
    for (let x = from; x < to; x += TILE_W) blit(cell, TILE_W, TILE_H, x, y);
  };

  // Ground: snow-capped surface, then interior fill below. This is what the
  // autotile pass in buildLevel produces for a solid column.
  for (let r = 0; r < 3; r++) {
    row(tiles.cells[r === 0 ? 1 : 0], groundTop + r * TILE_H, 0, W);
  }
  // An ice patch on the surface — no snow cap, darker brick.
  for (let x = 120; x < 260; x += TILE_W) blit(tiles.cells[3], TILE_W, TILE_H, x, groundTop);
  // A floating one-way ledge, 3 cells wide.
  for (let x = 300; x < 300 + TILE_W * 3; x += TILE_W) {
    blit(tiles.ledge, TILE_W, TILE_H, x, groundTop - TILE_H * 2);
  }
  // The hero, feet on the surface.
  blit(hero, HERO_W, HERO_H, 60, groundTop - HERO_H);

  return { w: W, h: H, buf: out };
}

// -----------------------------------------------------------------------------

function imageSize(file) {
  return execFileSync('magick', ['identify', '-format', '%w %h', file])
    .toString()
    .trim()
    .split(' ')
    .map(Number);
}

/**
 * Checks what was actually WRITTEN, not what we meant to write.
 *
 * Everything here is a way for the assets and the game to disagree without
 * anything erroring:
 *
 * - A tiles.png that is not an exact multiple of the cell is WARNED about, not
 *   rejected, by `Tileset.updateTileData`, and then samples shifted UVs.
 * - A tiles.png whose height disagrees with TILE_H makes `load.spritesheet`
 *   register ZERO frames, which is also only a warning; the tilemap stays
 *   correct, so the only visible symptom is the one-way ledges drawing the
 *   whole strip.
 * - A hero whose art does not reach the last row hovers above the ground,
 *   because the body's bottom is pinned to that row.
 * - And the ice brick collapsing into the fill brick under `-colors` would make
 *   the game's only mechanic invisible, with no error anywhere at all.
 */
function verifyOutputs(heroPath, tilesPath) {
  const [hw, hh] = imageSize(heroPath);
  if (hw !== HERO_W || hh !== HERO_H) {
    throw new Error(`hero.png is ${hw}x${hh}, expected ${HERO_W}x${HERO_H}`);
  }
  const hero = loadRGBA(heroPath);
  let bottomRowPx = 0;
  for (let x = 0; x < HERO_W; x++) {
    if (hero.buf[((HERO_H - 1) * HERO_W + x) * 4 + 3] >= 8) bottomRowPx++;
  }
  if (bottomRowPx < 10) {
    throw new Error(
      `hero.png has ${bottomRowPx} opaque pixels on its last row — the art has ` +
        `floated off the row the hitbox is pinned to`,
    );
  }

  const [tw, th] = imageSize(tilesPath);
  if (tw !== TILE_W * 4 || th !== TILE_H) {
    throw new Error(
      `tiles.png is ${tw}x${th}, expected ${TILE_W * 4}x${TILE_H} ` +
        `(4 cells of ${TILE_W}x${TILE_H})`,
    );
  }

  const tiles = loadRGBA(tilesPath);
  const meanTopBrick = (cell) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = 0; y < BRICK_H; y++) {
      for (let x = 0; x < BRICK_W; x++) {
        const p = (y * tw + cell * TILE_W + x) * 4;
        r += tiles.buf[p];
        g += tiles.buf[p + 1];
        b += tiles.buf[p + 2];
        n++;
      }
    }
    return [r / n, g / n, b / n];
  };
  const fill = meanTopBrick(0);
  const ice = meanTopBrick(3);
  const gap =
    (Math.abs(fill[0] - ice[0]) +
      Math.abs(fill[1] - ice[1]) +
      Math.abs(fill[2] - ice[2])) /
    3;
  if (gap < 4) {
    throw new Error(
      `the ice brick and the fill brick came out ${gap.toFixed(1)} levels apart ` +
        `after quantising — the slippery surface would be invisible in play. ` +
        `Raise the palette size or pick an ice row with more contrast.`,
    );
  }
  return { bottomRowPx, iceGap: gap };
}

// -----------------------------------------------------------------------------

function main() {
  const src = loadRGBA(SOURCE);
  console.log(`source ${SOURCE.replace(ROOT + '/', '')}  ${src.w}x${src.h}`);

  const grid = detectGrid(src, TILE_REGION);
  if (grid.cols.length !== 3 || grid.rows.length !== 6) {
    throw new Error(
      `expected a 3x6 tile grid, detected ${grid.cols.length}x${grid.rows.length}`,
    );
  }
  console.log(
    `tile grid  cols ${grid.cols.map(([a, b]) => `${a}-${b}`).join(' ')}  ` +
      `rows ${grid.rows.map(([a, b]) => `${a}-${b}`).join(' ')}`,
  );

  const hero = buildHero(src);
  console.log(
    `hero  src bbox ${hero.box.w}x${hero.box.h} -> ${HERO_W}x${HERO_H} art px ` +
      `(block ${(hero.box.w / HERO_W).toFixed(2)}), ground row ${hero.ground}, ` +
      `shifted ${hero.shift}px onto the last row`,
  );

  const { bricks, snow } = buildBricks(src, grid);
  console.log(
    `bricks  snow  surface ${(snow.surface * 100).toFixed(0)}%  ` +
      `interior ${(snow.interior * 100).toFixed(0)}%  ice ${(snow.ice * 100).toFixed(0)}%  ` +
      `each ${BRICK_W}x${BRICK_H}, ${BRICK_COLS}x${BRICK_ROWS} per ${TILE_W}x${TILE_H} cell`,
  );

  const cells = [
    composeCell(bricks.interior, bricks.interior), // 0 INTERIOR
    composeCell(bricks.surface, bricks.interior), // 1 SOLID
    composeLedge(bricks.surface), // 2 ONEWAY
    composeCell(bricks.ice, bricks.interior), // 3 ICE
  ];
  const ledge = composeLedge(bricks.surface);

  mkdirSync(join(ROOT, 'public/art'), { recursive: true });

  const heroPath = join(ROOT, 'public/art/hero.png');
  writePng(heroPath, HERO_W, HERO_H, hero.png);
  quantise(heroPath, 32);

  const tilesPath = join(ROOT, 'public/art/tiles.png');
  writePng(tilesPath, TILE_W * cells.length, TILE_H, composeTiles(cells));
  quantise(tilesPath, 28);

  const preview = composePreview(hero.png, { cells, ledge });
  const previewPath = join(ROOT, 'assets/concepts/tests/sliced-scene.png');
  writePng(previewPath, preview.w, preview.h, preview.buf);
  execFileSync('magick', [previewPath, '-filter', 'point', '-resize', '300%', previewPath]);

  const checked = verifyOutputs(heroPath, tilesPath);
  console.log(
    `checked  hero feet on the last row (${checked.bottomRowPx}px), ` +
      `ice brick ${checked.iceGap.toFixed(1)} levels off the fill brick`,
  );

  for (const p of [heroPath, tilesPath]) {
    const [w, h] = imageSize(p);
    console.log(`wrote ${p.replace(ROOT + '/', '')}  ${w}x${h}`);
  }
  console.log(`wrote ${previewPath.replace(ROOT + '/', '')}  (preview, 3x)`);
}

main();
