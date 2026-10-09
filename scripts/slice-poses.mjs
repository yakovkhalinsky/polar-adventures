#!/usr/bin/env node
/**
 * Slices the generated run poses into registered, quantised sprite frames, and
 * rebuilds the review page.
 *
 * `ANIMATION-LOG.md` §4 is the recipe this implements — read it first. The four
 * poses in assets/concepts/poses/ are the durable input; everything this writes
 * is derived from them and can be rebuilt at any time.
 *
 * Why each step is not optional:
 *
 * 1. DECIMATE THE WHOLE FRAME, not its bbox. Each pose is a 608x784 JPEG at the
 *    art's native 6px block, so it decimates to a canonical 102x132 art-pixel
 *    frame. Bbox decimation would stretch each pose to fill the canvas and
 *    destroy the character's proportions as the stride changes.
 *
 * 2. KEY WITH slice-art.mjs's OWN keyHero. Not a copy — imported. Three passes
 *    (dilated-wall flood, drop-shadow eat, ground-plane cut) and the subtleties
 *    are all in that file's comments. Two copies would drift.
 *
 * 3. REGISTER BY TRANSLATION onto a common ground line and centre column.
 *    Scale agrees across poses to within ~1% but placement drifts by a pixel or
 *    two, so a fixed crop window would leave the feet floating. Every pose is
 *    asserted to FIT: one that clipped has to fail here, named, rather than draw
 *    a missing leg in the game.
 *
 * 4. QUANTISE — the step §4 was missing. The shipped hero goes through
 *    slice-art.mjs's quantise(), which is why public/art/hero.png carries 23
 *    opaque colours. The registered poses arrived with 1,500-2,200 each, because
 *    they are decimated JPEGs and nothing reduced them afterwards: same
 *    character, different visual idiom, and it showed at the 2x the game always
 *    renders at. Quantising the SHEET once — rather than each frame separately —
 *    is deliberate: `-colors` derives one palette for the whole image, so all
 *    four frames share it. Per-frame quantisation would give each its own, which
 *    is the inter-frame tone drift this is also fixing (each separate generation
 *    picks its own fur highlight, ~7 levels apart across the cycle).
 *
 * 5. REBUILD THE REVIEW PAGE. The frames are substituted into
 *    run-cycle-preview.html and its "N% to next" labels are recomputed, so the
 *    page can never disagree with the frames it is showing.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { decimate, keyHero, loadRGBA, quantise, writePng } from './slice-art.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSES = join(ROOT, 'assets/concepts/poses');
const OUT = join(POSES, 'registered');
const PREVIEW = join(ROOT, 'assets/concepts/run-cycle-preview.html');

/** The canvas BootScene will load: HERO_W x HERO_H per frame. */
const HERO_W = 104;
const HERO_H = 124;

/**
 * The decimation target. Bigger than the sprite canvas in both directions on
 * purpose: the canon is the whole generation normalised onto the art's grid, and
 * registration then crops a window out of it. Decimating straight to 104x124
 * would bake the registration into the decimation and lose the margin the
 * shifts need.
 */
const CANON_W = 102;
const CANON_H = 132;

/**
 * Where the feet go. 123 is the LAST row of the sprite, and it is not a choice:
 * Player pins its hitbox bottom there (setOffset(17, 8) + height 116, see
 * src/objects/Player.ts), and slice-art.mjs plants the shipping hero on the same
 * row. A pose registered anywhere else hovers or sinks.
 */
const GROUND = 123;

/** The body's centre column, from §4 — the bbox centre every pose lands on. */
const CX = 51.5;

/** Poses may disagree in height by this much and still register by translation. */
const HEIGHT_TOLERANCE = 2;

/** Same pass, same count as the shipping hero (slice-art.mjs main()). */
const SHEET_COLOURS = 32;

/** alpha >= this is art; below it is keyed out. Both keyers emit binary alpha. */
const OPAQUE = 128;

const POSES_SRC = [
  { file: 'run-0-contact-near.jpg', label: 'contact', note: 'near leg forward, foot down' },
  { file: 'run-1-passing-near.jpg', label: 'passing', note: 'near leg passing under' },
  { file: 'run-2-contact-far.jpg', label: 'contact', note: 'far leg forward, foot down' },
  { file: 'run-3-passing-far.jpg', label: 'passing', note: 'far leg passing under' },
];

// -----------------------------------------------------------------------------

const lum = (buf, p) =>
  0.299 * buf[p * 4] + 0.587 * buf[p * 4 + 1] + 0.114 * buf[p * 4 + 2];

const alphaAt = (buf, w, x, y) => buf[(y * w + x) * 4 + 3];

/** Opaque bounding box, plus the lowest real-outline row inside it. */
function measure(buf, w, h) {
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  let ground = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (alphaAt(buf, w, x, y) < OPAQUE) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      // The outline test is deliberately much darker than the keyer's wall test:
      // reuse the wall threshold and the drop shadow would define its own ground.
      if (lum(buf, p) < 80) ground = Math.max(ground, y);
    }
  }
  if (x1 < 0) throw new Error('nothing opaque left after keying');
  return { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1) / 2, ground };
}

/** Distinct RGB values among opaque pixels — the "is this pixel art?" number. */
function opaqueColours(buf, w, h) {
  const seen = new Set();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (buf[p + 3] < OPAQUE) continue;
      seen.add((buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2]);
    }
  }
  return seen.size;
}

/**
 * The §2 difference metric, written down here because §2 did not record it and
 * two reasonable readings disagree by an order of magnitude.
 *
 * DEFINITION: over the WHOLE frame (104x124 = 12,896px, transparent background
 * included), the share of pixels where the summed RGB delta exceeds 40, or where
 * alpha changed. Strict per-pixel equality gives ~100% (each generation carries
 * its own tone); silhouette-only gives 20-25%. This is the figure §2 quotes.
 */
function frameDiff(a, b) {
  let n = 0;
  for (let p = 0; p < a.length; p += 4) {
    const delta =
      Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]);
    if (delta > 40 || a[p + 3] !== b[p + 3]) n++;
  }
  return n;
}

/**
 * The other half of the same question: how much the SILHOUETTE moves, ignoring
 * colour entirely. Share of the union of the two bears whose alpha changed.
 *
 * This is the number that says whether a pose actually differs in shape, and it
 * is the one to quote when asking "are these four frames distinct?" — frameDiff
 * above is inflated by the per-generation tone drift that sharing a palette has
 * already reduced.
 */
function silhouetteDiff(a, b) {
  let changed = 0;
  let union = 0;
  for (let p = 0; p < a.length; p += 4) {
    const aOpaque = a[p + 3] >= OPAQUE;
    const bOpaque = b[p + 3] >= OPAQUE;
    if (!aOpaque && !bOpaque) continue;
    union++;
    if (aOpaque !== bOpaque) changed++;
  }
  return (100 * changed) / union;
}

// -----------------------------------------------------------------------------

const frames = [];
const report = [];

for (const pose of POSES_SRC) {
  const src = loadRGBA(join(POSES, pose.file));
  const canon = decimate(src, 0, 0, src.w, src.h, CANON_W, CANON_H);

  const { clear, ground } = keyHero(canon, CANON_W, CANON_H);
  for (let p = 0; p < CANON_W * CANON_H; p++) {
    if (clear[p]) canon[p * 4 + 3] = 0;
  }

  const box = measure(canon, CANON_W, CANON_H);
  const dx = Math.round(CX - box.cx);
  const dy = GROUND - ground;

  // A pose that clips must fail here, named. Silently cropping it draws a
  // missing leg in the game; silently refusing it would be worse.
  const clipped =
    box.x0 + dx < 0 || box.x1 + dx >= HERO_W || box.y0 + dy < 0 || box.y1 + dy >= HERO_H;
  if (clipped) {
    throw new Error(
      `${pose.file}: registering it would clip (bbox ${box.w}x${box.h} at ` +
        `(${box.x0},${box.y0}) shifted by (${dx},${dy}) in ${HERO_W}x${HERO_H}). ` +
        `The sprite canvas needs to grow, or the pose needs regenerating.`,
    );
  }

  const frame = Buffer.alloc(HERO_W * HERO_H * 4);
  for (let y = 0; y < HERO_H; y++) {
    for (let x = 0; x < HERO_W; x++) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx < 0 || sy < 0 || sx >= CANON_W || sy >= CANON_H) continue;
      const s = (sy * CANON_W + sx) * 4;
      const d = (y * HERO_W + x) * 4;
      frame[d] = canon[s];
      frame[d + 1] = canon[s + 1];
      frame[d + 2] = canon[s + 2];
      frame[d + 3] = canon[s + 3];
    }
  }

  const coloursBefore = opaqueColours(frame, HERO_W, HERO_H);
  frames.push({ pose, frame, box, dx, dy, coloursBefore });
  report.push(
    `${pose.file.padEnd(24)} bbox ${box.w}x${box.h} at (${box.x0},${box.y0})  ` +
      `shift (${dx},${dy})  fits  ${String(coloursBefore).padStart(4)} colours`,
  );
}
console.log(report.join('\n'));

// Scale must agree, or registering by translation alone is not legitimate. A
// future pose drawn at a genuinely different size has to fail loudly rather than
// ship a character that changes size mid-run.
const heights = frames.map((f) => f.box.h);
const spread = Math.max(...heights) - Math.min(...heights);
if (spread > HEIGHT_TOLERANCE) {
  throw new Error(
    `poses disagree in height by ${spread}px (${heights.join(', ')}), over the ` +
      `${HEIGHT_TOLERANCE}px tolerance — they cannot be registered by translation alone`,
  );
}
console.log(`\nscale  heights ${heights.join(', ')}px  spread ${spread}px  (tolerance ${HEIGHT_TOLERANCE})`);

// --- one sheet, one palette --------------------------------------------------

mkdirSync(OUT, { recursive: true });

const sheetW = HERO_W * frames.length;
const sheet = Buffer.alloc(sheetW * HERO_H * 4);
for (const [i, f] of frames.entries()) {
  for (let y = 0; y < HERO_H; y++) {
    const from = y * HERO_W * 4;
    const to = (y * sheetW + i * HERO_W) * 4;
    f.frame.copy(sheet, to, from, from + HERO_W * 4);
  }
}

const sheetPath = join(OUT, 'run-sheet.png');
writePng(sheetPath, sheetW, HERO_H, sheet);
quantise(sheetPath, SHEET_COLOURS);

// Read the quantised sheet back and cut the frames out of it, so what the page
// shows is exactly what quantise wrote rather than what we hoped it would.
const quantised = loadRGBA(sheetPath);
if (quantised.w !== sheetW || quantised.h !== HERO_H) {
  throw new Error(`sheet is ${quantised.w}x${quantised.h}, expected ${sheetW}x${HERO_H}`);
}

for (const [i, f] of frames.entries()) {
  const cut = Buffer.alloc(HERO_W * HERO_H * 4);
  for (let y = 0; y < HERO_H; y++) {
    const from = (y * sheetW + i * HERO_W) * 4;
    quantised.buf.copy(cut, y * HERO_W * 4, from, from + HERO_W * 4);
  }
  f.cut = cut;

  // End-to-end checks, on the pixels that will actually ship. Each one is a way
  // the frame and the game can disagree with nothing erroring.
  const alphas = new Set();
  for (let p = 3; p < cut.length; p += 4) alphas.add(cut[p]);
  if (alphas.size > 2 || !alphas.has(0) || !alphas.has(255)) {
    throw new Error(
      `frame ${i}: alpha is not binary after quantising (${[...alphas].sort((a, b) => a - b).join(', ')}) ` +
        `— partly-transparent edges would fringe the bear against snow`,
    );
  }

  const m = measure(cut, HERO_W, HERO_H);
  if (m.ground !== GROUND) {
    throw new Error(`frame ${i}: feet landed on row ${m.ground}, not ${GROUND}`);
  }
  if (Math.abs(m.cx - CX) > 1) {
    throw new Error(`frame ${i}: centre column is ${m.cx}, not ${CX} +/- 1`);
  }
  f.after = { ...m, colours: opaqueColours(cut, HERO_W, HERO_H) };

  const framePath = join(OUT, `run-${i}.png`);
  writePng(framePath, HERO_W, HERO_H, cut);
  // The PAGE embeds these as data URIs, and a data URI has to carry a real PNG —
  // base64 of the raw RGBA happens to be the right shape and length, decodes to
  // nothing, and shows up only as a gallery of blank images. So hold the bytes
  // magick actually wrote, not the buffer that went into it.
  f.png = readFileSync(framePath);
}

console.log('\nquantised sheet  one palette for all four frames');
for (const [i, f] of frames.entries()) {
  console.log(
    `  run-${i}  ${String(f.coloursBefore).padStart(4)} -> ${String(f.after.colours).padStart(3)} colours  ` +
      `ground row ${f.after.ground}  centre ${f.after.cx}  height ${f.after.h}`,
  );
}

const diffs = frames.map((_, i) => frameDiff(frames[i].cut, frames[(i + 1) % frames.length].cut));
const diffsPct = diffs.map((n) => (100 * n) / (HERO_W * HERO_H));
console.log(
  `\nframe difference  ${diffsPct.map((p) => `${p.toFixed(1)}%`).join('  ')}  ` +
    `(consecutive, whole frame, summed RGB delta > 40 or alpha change — see frameDiff() in this file)`,
);

// Every pair, both ways: the closest pair anywhere is the number that answers
// "is any frame a near-duplicate of another", and the shape-only figure is the
// one that answers "did the pose move". A four-frame run wants its two contact
// frames to be the most different pair in the set.
console.log('\nall pairs          metric40   silhouette');
let closest = { pct: Infinity, pair: '' };
for (let i = 0; i < frames.length; i++) {
  for (let j = i + 1; j < frames.length; j++) {
    const m = (100 * frameDiff(frames[i].cut, frames[j].cut)) / (HERO_W * HERO_H);
    const s = silhouetteDiff(frames[i].cut, frames[j].cut);
    if (m < closest.pct) closest = { pct: m, pair: `${i}-${j}` };
    console.log(`  ${i}-${j}              ${m.toFixed(1).padStart(5)}%     ${s.toFixed(1)}%`);
  }
}
console.log(`  closest pair anywhere: ${closest.pair} at ${closest.pct.toFixed(1)}%`);

// --- rebuild the review page -------------------------------------------------

const html = readFileSync(PREVIEW, 'utf8');

// The page carries eight payloads in a fixed order: the two animated stage
// images (both showing frame 0), the shipping-hero reference, the four gallery
// frames, then the second hero reference. Assert that shape rather than assume
// it, so a restructured page fails here instead of shipping a page whose picture
// does not match its caption.
// The page carries thirteen payloads, in this order: a CSS ground texture, the
// two animated stage images (both showing frame 0), the two shipping-hero
// references, the four gallery frames, and the four-frame JS array that the
// animation actually plays. The frames therefore appear three times over.
//
// ROLE is asserted below, not assumed: a restructured page has to fail HERE
// rather than ship a page whose picture does not match its caption.
const ROLE = ['ground', 0, 'hero', 0, 1, 2, 3, 0, 'hero', 0, 1, 2, 3];

const blobs = [...html.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map((m) => ({
  uri: m[0],
  buf: Buffer.from(m[1], 'base64'),
}));
if (blobs.length !== ROLE.length) {
  throw new Error(`expected ${ROLE.length} payloads in the page, found ${blobs.length}`);
}

const sizes = blobs.map((b) => {
  const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', '-'], { input: b.buf })
    .toString()
    .trim()
    .split(' ')
    .map(Number);
  return { w, h };
});

for (const [i, role] of ROLE.entries()) {
  const { w, h } = sizes[i];
  const ok =
    role === 'ground'
      ? // A backdrop strip, not a sprite: it is neither the frame nor the hero width.
        w !== HERO_W && w !== 95 && h !== HERO_H
      : role === 'hero'
        ? w === 95 && h === HERO_H
        : w === HERO_W && h === HERO_H;
  if (!ok) {
    throw new Error(
      `page payload ${i} is ${w}x${h}, which is not right for role '${role}' — ` +
        `the page has been restructured and the frame mapping is no longer valid`,
    );
  }
}

const same = (a, b) => a.buf.equals(b.buf);
const at = (role) => ROLE.map((r, i) => (r === role ? i : -1)).filter((i) => i >= 0);

// Every occurrence of one role must be the same bytes: the animated stage image,
// the gallery still and the JS array entry for frame N are the same picture
// three times over, and the two hero references are the shipping sprite.
for (const role of [0, 1, 2, 3, 'hero']) {
  const idx = at(role);
  if (idx.length < 2) throw new Error(`role '${role}' appears once; expected repeats`);
  if (idx.some((i) => !same(blobs[i], blobs[idx[0]]))) {
    throw new Error(`role '${role}' payloads differ from each other: ${idx.join(', ')}`);
  }
}
// And the four frames must still be four DIFFERENT frames.
for (const i of at(0)) {
  for (const j of at(1)) if (same(blobs[i], blobs[j])) throw new Error('frames 0 and 1 are identical');
}

const replacement = blobs.map((b, i) =>
  typeof ROLE[i] === 'number'
    ? `data:image/png;base64,${frames[ROLE[i]].png.toString('base64')}`
    : b.uri,
);

let rebuilt = html;
for (const [i, b] of blobs.entries()) rebuilt = rebuilt.replace(b.uri, replacement[i]);

// Recompute the per-frame "N% to next" captions from the frames being shown.
let cursor = 0;
rebuilt = rebuilt.replace(/\d+\.\d% to next/g, () => `${diffsPct[cursor++].toFixed(1)}% to next`);
if (cursor !== frames.length) {
  throw new Error(`expected ${frames.length} "to next" captions in the page, replaced ${cursor}`);
}

// The brief has to say what the frames are, because the palette is the point of
// this run. Assert the whole sentence before replacing: replace() on a string
// pattern is silently a no-op if it does not match, and a page that quietly kept
// the old wording would describe art it is no longer showing. The guard is what
// makes re-running this script safe — the clause is inserted once, not stacked.
const PALETTE_CLAUSE = `All four share one ${SHEET_COLOURS}-colour palette`;
const ANCHOR =
  'Everything below runs at <strong>1&times;</strong> — the size it will actually be on screen.';
if (!rebuilt.includes(PALETTE_CLAUSE)) {
  if (!rebuilt.includes(ANCHOR)) {
    throw new Error('page brief changed — cannot describe the palette honestly, aborting');
  }
  rebuilt = rebuilt.replace(
    ANCHOR,
    `${PALETTE_CLAUSE} — the same quantise pass the shipping art goes through. ${ANCHOR}`,
  );
}

writeFileSync(PREVIEW, rebuilt);

// Verify what was written, by reading the page back the way a browser would.
// This is the check that would have caught the raw-RGBA-in-a-PNG-data-URI bug:
// it is the right shape, the right length, and decodes to nothing.
const written = [...readFileSync(PREVIEW, 'utf8').matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)]
  .map((m) => Buffer.from(m[1], 'base64'));
if (written.length !== ROLE.length) {
  throw new Error(`page has ${written.length} payloads after the rewrite, expected ${ROLE.length}`);
}
for (const [i, role] of ROLE.entries()) {
  if (typeof role !== 'number') continue;
  const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', '-'], { input: written[i] })
    .toString()
    .trim()
    .split(' ')
    .map(Number);
  if (w !== HERO_W || h !== HERO_H) {
    throw new Error(
      `page payload ${i} (frame ${role}) decodes as ${w}x${h}, not ${HERO_W}x${HERO_H} — ` +
        `the browser would show a blank or broken image`,
    );
  }
}

console.log(`\nwrote ${sheetPath.replace(`${ROOT}/`, '')}  ${sheetW}x${HERO_H}`);
console.log(`wrote ${OUT.replace(`${ROOT}/`, '')}/run-0..3.png  ${HERO_W}x${HERO_H}`);
console.log(`rebuilt ${PREVIEW.replace(`${ROOT}/`, '')}  (${written.length} payloads re-checked)`);
