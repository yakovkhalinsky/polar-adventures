#!/usr/bin/env node
/**
 * Builds assets/concepts/hero-preview.html — the page you look at to decide
 * whether the PixelLab bear becomes the hero.
 *
 * WHY THIS EXISTS
 *
 * The hero is being replaced. The old sprite was sliced from a FLUX JPEG; the
 * new one is a PixelLab character (`bear-cartoon`, id 9588f009-…), whose
 * spritesheet is a uniform grid of 176x176 cells with a layout JSON beside it.
 * This script cuts the four animations out of that grid, registers them into
 * the game's own 95x124 frame, and inlines them into one self-contained page —
 * the same shape as run-cycle-preview.html, and for the same reason: a run
 * cycle has to be judged by eye, and a JPEG strip cannot be.
 *
 * THE REGISTRATION RULE, which is the only judgement in here
 *
 * Every frame is translated so its opaque bbox sits on the frame's bottom row
 * and its centre column. That is exactly what scripts/slice-poses.mjs does for
 * the FLUX pose frames (ANIMATION-LOG.md §4 step 4), reused rather than
 * reinvented. It guarantees two things at once: nobody's foot sinks through the
 * ground, and no frame clips, because each is placed by its own extent.
 *
 * The cost of that rule is that the bear's bob is now the BOTTOM of its
 * silhouette rather than its hips, so a frame whose lowest pixel is a dangling
 * rather than a planted foot is pulled down. Look at the run on this page and
 * decide whether that reads as a stride or as a wobble — that is the whole
 * point of building it.
 *
 * NOTHING IS QUANTISED HERE. The page shows what PixelLab drew, in its own
 * colours, so the art can be judged before a palette pass touches it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CENTRE_COL,
  FRAME_H,
  FRAME_W,
  GROUND_ROW,
  bbox,
  cell,
  dataUri,
  flipX,
  plantOffset,
  strip,
  translate,
} from './art/frames.mjs';
import { loadRGBA } from './art/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONCEPTS = join(ROOT, 'assets/concepts');

/**
 * Which character to preview: `node scripts/preview-hero.mjs <stem>`, where the
 * stem names `assets/concepts/pixellab/<stem>.png` and its `.json` layout.
 *
 * Two characters were generated. `polar-bear-ref` is conditioned on the
 * shipping hero.png and inherits its palette, so it sits in the same world as
 * the existing art — that is the one in use. `bear-cartoon` is the text-only
 * one, kept only so the two can be compared.
 */
const STEM = process.argv[2] ?? 'polar-bear-ref';
const SHEET = join(CONCEPTS, 'pixellab', `${STEM}.png`);
const LAYOUT = join(CONCEPTS, 'pixellab', `${STEM}.json`);
const OLD_HERO = join(ROOT, 'public/art/hero.png');
const OUT_HTML = join(CONCEPTS, `${STEM}-preview.html`);

// The frame (104x124), the registration rule, the mirroring and the strip
// packing all live in scripts/art/frames.mjs, so this page and the
// limb-visibility review cannot disagree about where a bear's feet land.
// The reasoning for 104 rather than the shipping 95 is there too.

/** Playback, in frames per second. Copied from scripts/art/poses.mjs STATES so
 *  the page cycles at the rate the game would actually play. */
const FPS = { run: 12, idle: 6, jump: 8, slide: 8 };

// -----------------------------------------------------------------------------

const sheet = loadRGBA(SHEET);
const layout = JSON.parse(readFileSync(LAYOUT, 'utf8'));
const size = layout.spritesheet.cell_size.width;

/**
 * The states to preview, and which generated animation supplies each.
 *
 * All four are the `-w` (west) variants, because `east` on this character is a
 * REAR three-quarter view — animating on it produced a bear that read as
 * "hunched" when it was really facing away, and cost several rounds of
 * re-prompting before the viewpoint was spotted. The east animations still
 * exist on the server and are deliberately not shown.
 */
const WANT = [
  ['idle', 'idle-w'],
  ['run', 'run-w'],
  ['slide', 'slide-w'],
  ['jump', 'jump-w'],
];

/**
 * Which states are planted per frame, and which are not.
 *
 * A grounded cycle (idle, run, slide) wants every frame's lowest pixel on the
 * ground row — that is what stops the bear drifting vertically as the stride
 * changes. A JUMP must not be treated that way: planting each frame would clamp
 * the airborne frames back onto the floor and delete the leap, which is the
 * entire animation. So `jump` inherits one fixed offset instead, taken from the
 * rest pose, and its own rise is preserved exactly as generated.
 */
const PLANTED = new Set(['idle', 'run', 'slide']);

const byName = new Map();
for (const row of layout.spritesheet.rows) {
  if (row.type === 'animation') byName.set(row.animation, row);
}

/**
 * The sheet cells, already mirrored.
 *
 * Mirroring happens HERE, before any measurement, and that order is load
 * bearing: flipping reverses x, so an offset measured on the unflipped art
 * lands the bear off the edge of the frame instead of centred (measured: 77px
 * of the run silently clipped). Measure what you are going to draw.
 */
const cellsOf = (row) =>
  Array.from({ length: row.frame_count }, (_, i) => flipX(cell(sheet, i, row.row, size)));

// The rest pose anchors the unplanted states, so a jump starts from exactly
// where the idle stands rather than an arbitrary offset.
const anchor = plantOffset(cellsOf(byName.get(WANT[0][1]))[0]);

const anims = [];
for (const [state, source] of WANT) {
  const row = byName.get(source);
  if (!row) throw new Error(`the sheet has no animation named "${source}"`);

  const frames = [];
  const heights = [];
  const clips = [];
  let clipped = 0;
  for (const src of cellsOf(row)) {
    const box = bbox(src);
    heights.push(box ? box.y1 - box.y0 + 1 : 0);
    const off = PLANTED.has(state) ? plantOffset(src) : anchor;
    const r = translate(src, off.dx, off.dy);
    clipped += r.clipped;
    clips.push(r.clipped);
    frames.push(r.frame);
  }

  const laid = strip(frames);
  anims.push({
    name: state,
    source,
    frames,
    heights,
    clips,
    clipped,
    planted: PLANTED.has(state),
    uri: dataUri(laid.w, FRAME_H, laid.buf),
    width: laid.w,
  });
}

/**
 * The shipping sprite, placed on the SAME frame as the new art so the two are
 * compared like for like. It is 95 wide and the frame is now 104, so it goes
 * through the same centring rule rather than hanging off one edge — otherwise
 * the comparison would show a 4px shift that is an artifact of the frame change
 * rather than a difference between the two bears.
 */
const oldHero = loadRGBA(OLD_HERO);
const oldUri = (() => {
  const off = plantOffset(oldHero);
  return dataUri(FRAME_W, FRAME_H, translate(oldHero, off.dx, off.dy).frame.buf);
})();

/** A single still of the new bear, for the side-by-side comparison. */
const idle = anims.find((a) => a.name === 'idle');
const idleFirstUri = dataUri(FRAME_W, FRAME_H, idle.frames[0].buf);

// Report to the terminal, because the page cannot say whether a frame CLIPPED
// — it just draws a bear with a missing foot.
console.log(`sheet ${sheet.w}x${sheet.h}, cells ${size}x${size}`);
for (const a of anims) {
  const lo = Math.min(...a.heights);
  const hi = Math.max(...a.heights);
  console.log(
    `  ${a.name.padEnd(6)} <- ${a.source.padEnd(8)} ${String(a.frames.length).padStart(2)}f  ` +
      `height ${lo}-${hi} (spread ${hi - lo})  ` +
      `${a.planted ? 'planted per frame' : 'fixed offset (airborne)'}  clipped ${a.clipped}` +
      // Naming the offending frames matters: "7px clipped" cannot tell you
      // whether it is every frame's foot or one frame's ear tip.
      (a.clipped ? ` [frame${a.clips.filter((c) => c > 0).length > 1 ? 's' : ''} ` +
        a.clips.map((c, i) => (c ? `${i}:${c}` : null)).filter(Boolean).join(' ') + ']' : ''),
  );
}

const animCss = anims
  .map(
    (a) => `  .anim-${a.name} { width: ${FRAME_W}px; height: ${FRAME_H}px; image-rendering: pixelated;
    background-image: url('${a.uri}'); background-repeat: no-repeat;
    animation: play-${a.name} ${(a.frames.length / FPS[a.name]).toFixed(3)}s steps(${a.frames.length}) infinite; }
  @keyframes play-${a.name} { from { background-position-x: 0; } to { background-position-x: -${a.width}px; } }`,
  )
  .join('\n');

/** One animation, shown at x2 (how the game renders) and x1 (the art's own
 *  scale). A class rather than an id, because both slots play the same strip. */
const slot = (name, n) => `<div class="slot">
          <span class="lbl">×${n}</span>
          <div class="zoom x${n}"><div class="inner"><div class="anim-${name}"></div></div></div>
        </div>`;

const cards = anims
  .map((a) => {
    const lo = Math.min(...a.heights);
    const hi = Math.max(...a.heights);
    const spread = hi - lo;
    // Only a PLANTED state is suspicious when its frames differ in height: the
    // bear should hold its size. A jump is supposed to squash and stretch.
    const bad = a.planted && spread >= 10;
    return `
    <section>
      <h2>${a.name} — ${a.frames.length} frames @ ${FPS[a.name]}fps <span class="src">from ${a.source}</span></h2>
      <div class="stage">
        <div class="row">${slot(a.name, 2)}${slot(a.name, 1)}</div>
        <p class="cap">the dashed line is the ground row — feet on it, or not</p>
      </div>
      <p class="data">art height per frame: ${a.heights.join(', ')}px — spread <strong>${spread}px</strong>
        · ${a.planted ? 'planted per frame' : 'fixed offset, so the leap is preserved'}${
        bad ? ' <span class="flag">size pops; this state should hold its size</span>' : ''
      }${a.clipped ? ` <span class="flag">${a.clipped}px clipped by the frame</span>` : ''}</p>
    </section>`;
  })
  .join('\n');

/**
 * The jump candidates, playing side by side.
 *
 * The shipped jump (`jumping-1`) draws the BACK LEG as an indistinct mass fused
 * to the body — measured, three of its nine frames never separate the legs at
 * all. A still cannot settle which replacement is better, because two
 * candidates can both have separated legs in every frame and still differ in how
 * they move, so this section plays them.
 *
 * The leg measurements for these live in `npm run review-limbs`, which owns that
 * metric; duplicating it here would be two implementations of one judgement.
 */
const CANDIDATES = ['jump-w', 'jump2-w', 'jump2f-w', 'jumprun-w', 'jumpv3-w'];
const CANDIDATE_LABEL = {
  'jump-w': 'jumping-1 — the current one',
  'jump2-w': 'jumping-2',
  'jump2f-w': 'two-footed-jump',
  'jumprun-w': 'running-jump',
  'jumpv3-w': 'custom v3 — asked for separated legs',
};

const candidateCss = [];
const candidateSlots = [];
for (const name of CANDIDATES) {
  const row = byName.get(name);
  if (!row) continue;
  const frames = cellsOf(row).map((src) => translate(src, anchor.dx, anchor.dy).frame);
  const laid = strip(frames);
  const key = name.replace(/[^a-z0-9]/gi, '-');
  candidateCss.push(
    `  .anim-${key} { width: ${FRAME_W}px; height: ${FRAME_H}px; image-rendering: pixelated;
    background-image: url('${dataUri(laid.w, FRAME_H, laid.buf)}'); background-repeat: no-repeat;
    animation: play-${key} ${(frames.length / FPS.jump).toFixed(3)}s steps(${frames.length}) infinite; }
  @keyframes play-${key} { from { background-position-x: 0; } to { background-position-x: -${laid.w}px; } }`,
  );
  candidateSlots.push(`<div class="slot">
          <span class="lbl">${CANDIDATE_LABEL[name] ?? name}</span>
          <div class="zoom x2"><div class="inner"><div class="anim-${key}"></div></div></div>
          <span class="cap">${frames.length} frames</span>
        </div>`);
}

const html = `<title>PixelLab Bear — New Hero Preview (${STEM})</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Silkscreen&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  /* The same arctic-night world as run-cycle-preview.html: a cream bear on a
     white page is exactly the thing this page exists to judge. */
  :root {
    --deep: #0a121f; --sky: #101a2b; --panel: #16253c;
    --line: rgba(234,242,248,.14); --snow: #eaf2f8; --muted: #93a7c0;
    --ice: #8fd8e8; --warn: #ffb454;
    --display: 'Silkscreen','Courier New',monospace;
    --body: 'IBM Plex Sans',system-ui,sans-serif;
    --data: 'IBM Plex Mono',ui-monospace,monospace;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--deep); color:var(--snow);
    font-family:var(--body); font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:880px; margin:0 auto; padding:40px 20px 72px;
    display:flex; flex-direction:column; gap:34px; }
  .eyebrow { font-family:var(--display); font-size:10px; letter-spacing:.08em; color:var(--ice); margin:0; }
  h1 { font-family:var(--display); font-size:clamp(19px,5vw,28px); line-height:1.25; margin:0; font-weight:400; }
  .brief { margin:0; color:var(--muted); max-width:64ch; }
  .brief strong { color:var(--snow); font-weight:500; }
  h2 { font-family:var(--display); font-size:11px; letter-spacing:.08em; color:var(--muted);
    margin:0 0 14px; font-weight:400; }
  section { display:flex; flex-direction:column; }
  .stage { position:relative; background:var(--panel); border:1px solid var(--line);
    border-radius:10px; padding:22px 22px 20px; }
  /* align-items:flex-end puts every sprite's bottom edge on the row's bottom
     edge, and the dashed border IS the ground line — so a bear that floats or
     sinks is visible as a gap against it, which is the thing being judged. */
  .row { display:flex; align-items:flex-end; gap:34px;
    border-bottom:1px dashed rgba(143,216,232,.4); }
  .slot { display:flex; flex-direction:column; align-items:center; }
  .lbl { font-family:var(--data); font-size:10px; color:var(--muted);
    letter-spacing:.04em; margin-bottom:8px; }
  /* scale() does not affect layout, so the wrapper reserves the space the
     scaled sprite will really occupy. Without this the x2 bear overflows the
     panel and lands on top of the text. */
  .zoom { position:relative; }
  .zoom > .inner { position:absolute; top:0; left:0; transform-origin:top left; }
  .zoom.x2 { width:${FRAME_W * 2}px; height:${FRAME_H * 2}px; }
  .zoom.x2 > .inner { transform:scale(2); }
  .zoom.x1 { width:${FRAME_W}px; height:${FRAME_H}px; }
  .cap { margin:14px 0 0; font-family:var(--data); font-size:10.5px; color:var(--muted); }
  .data { font-family:var(--data); font-size:11.5px; color:var(--muted); margin:12px 0 0; }
  .data strong { color:var(--snow); }
  .flag { color:var(--warn); }
  .src { color:var(--ice); font-size:10px; letter-spacing:.04em; }
  .compare { display:flex; align-items:flex-end; gap:30px; }
  .compare figure { margin:0; display:flex; flex-direction:column; gap:8px; align-items:center; }
  .compare img { image-rendering:pixelated; }
  .compare figcaption { font-family:var(--data); font-size:10px; color:var(--muted); }
  .note { background:var(--sky); border:1px solid var(--line); border-radius:10px;
    padding:16px 18px; font-size:13.5px; color:var(--muted); }
  .note strong { color:var(--snow); }
  .note code { font-family:var(--data); font-size:12px; color:var(--ice); }
${animCss}
${candidateCss.join('\n')}
</style>
<div class="wrap">
  <header>
    <p class="eyebrow">PIXELLAB · NEW HERO CANDIDATE</p>
    <h1>Is this our bear?</h1>
    <p class="brief">PixelLab character <strong>${STEM}</strong>, drawn at the game's own
      <strong>95×124</strong> frame — the size <code>smoke.mjs</code> asserts and the 61×116
      hitbox is built for. Each frame is placed by its own silhouette: feet on the bottom row,
      centre on the centre column. Judged at ×2 because that is how the game renders.</p>
  </header>

  <section>
    <h2>Old hero vs new, at game scale (×2)</h2>
    <div class="stage">
      <div class="row">
        <div class="slot">
          <span class="lbl">shipping hero</span>
          <div class="zoom x2"><div class="inner"><img src="${oldUri}" width="${FRAME_W}" height="${FRAME_H}" style="image-rendering:pixelated" alt="current hero"></div></div>
        </div>
        <div class="slot">
          <span class="lbl">PixelLab bear</span>
          <div class="zoom x2"><div class="inner"><img src="${idleFirstUri}" width="${FRAME_W}" height="${FRAME_H}" style="image-rendering:pixelated" alt="new hero"></div></div>
        </div>
      </div>
      <p class="cap">both at ×2 on the same ground row — fur, outline weight and stance are what to compare</p>
    </div>
  </section>
${cards}

  <section>
    <h2>jump candidates — all playing at ×2</h2>
    <div class="stage">
      <div class="row" style="flex-wrap:wrap;gap:26px;">
${candidateSlots.join('\n')}
      </div>
      <p class="cap">all five on the same fixed offset, so the leap is preserved; judge the back leg</p>
    </div>
    <p class="data">The current jump draws its <strong>back leg as a mass fused to the body</strong> —
      three of its nine frames never separate the legs. Numbers for all five are in
      <code>npm run review-limbs</code>.</p>
  </section>

  <div class="note">
    <p><strong>Why the bear faces right.</strong> The animations were generated on this character's
    <code>west</code> direction, which is its clean side profile — <code>east</code> is a
    <em>rear</em> three-quarter view, and animating on it made the bear look hunched when it was
    really facing away from the camera. West faces left, so the art is mirrored here; the game
    keeps its existing right-facing convention and <code>setFlipX</code> untouched.</p>
    <p style="margin:10px 0 0"><strong>Why the jump is registered differently.</strong> Idle, run
    and slide are planted per frame, so the lowest pixel always meets the ground row. The jump is
    not: planting it would clamp its airborne frames back onto the floor and delete the leap. It
    inherits one fixed offset from the rest pose, so its rise is preserved as generated. A wide
    height spread is a fault in a grounded cycle and expected in a jump.</p>
    <p style="margin:10px 0 0">Nothing here is quantised or wired into the game: this is PixelLab's
    own colour, so the palette pass can still be judged separately. These frames are mirrored but
    not otherwise retouched.</p>
  </div>
</div>
`;

writeFileSync(OUT_HTML, html);
console.log(`\nwrote ${OUT_HTML.replace(`${ROOT}/`, '')}  (${(html.length / 1024).toFixed(0)} KB)`);
