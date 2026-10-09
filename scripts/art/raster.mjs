/**
 * The drawing primitives. Everything in scripts/art/ that puts a pixel down
 * goes through here.
 *
 * WHY A SHAPE CARRIES A SHADE CHANNEL
 *
 * A mask alone says *which* pixels are limb; art also needs to say *how round*
 * each one is, or a limb renders as a flat paper cut-out. So every shape builder
 * returns two arrays: `mask` (0/1 coverage) and `shade` (0..1, where 1 faces the
 * light). `paint()` turns the pair into a ramp lookup. The shade is derived from
 * the shape's own geometry — the direction from the limb's axis, or from an
 * ellipse's centre — so limbs shade like tubes and heads shade like balls
 * without any of it being authored per part.
 *
 * WHY PARTS ARE PAINTED BORDER-FIRST
 *
 * A near arm has to read as separate from the torso it crosses, and a 1px navy
 * line is what does it. The obvious implementation — paint everything, then
 * outline the union — cannot produce that line, because an outline pass only
 * fills *transparent* pixels and the arm's edge lands on opaque torso. So each
 * part is painted as a dilated border followed by its own fill: the border
 * overwrites whatever is already there, and the fill covers all but 1px of it.
 * Painting parts far-to-near then builds both the internal separation lines and
 * the outer silhouette in one pass, with no global outline pass needed.
 */

// -----------------------------------------------------------------------------
// canvas

/**
 * An RGBA canvas. Not premultiplied — every helper here keeps straight alpha,
 * which is what scripts/art/png.mjs expects on the way out.
 */
export function makeCanvas(w, h) {
  return { w, h, buf: Buffer.alloc(w * h * 4) };
}

export function clear(canvas) {
  canvas.buf.fill(0);
}

const idx = (c, x, y) => (y * c.w + x) * 4;

/** Writes one pixel, unconditionally. */
export function putPixel(canvas, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= canvas.w || y >= canvas.h) return;
  const i = idx(canvas, x, y);
  canvas.buf[i] = r;
  canvas.buf[i + 1] = g;
  canvas.buf[i + 2] = b;
  canvas.buf[i + 3] = a;
}

/** Reads one pixel as [r,g,b,a]. */
export function getPixel(canvas, x, y) {
  const i = idx(canvas, x, y);
  return [canvas.buf[i], canvas.buf[i + 1], canvas.buf[i + 2], canvas.buf[i + 3]];
}

// -----------------------------------------------------------------------------
// shade

/**
 * Light comes from the upper LEFT, which is the convention 16-bit art uses and
 * the reason the bear's far side reads as far. `LIGHT` is a unit vector in
 * screen space (y grows downward, so a negative y is "up").
 */
export const LIGHT = (() => {
  const x = -0.45;
  const y = -0.89;
  const n = Math.hypot(x, y);
  return [x / n, y / n];
})();

/** A surface normal facing `nx,ny` -> 0..1, where 1 is fully lit. */
const lit = (nx, ny) => 0.5 + 0.5 * (nx * LIGHT[0] + ny * LIGHT[1]);

/** A flat top surface, used where a shape has no meaningful normal. */
const LIT_TOP = lit(0, -1);

// -----------------------------------------------------------------------------
// shapes

/**
 * A capsule between two points with independent end radii, which is the whole
 * reason limbs can taper: a thigh is thick at the hip and thin at the knee, and
 * a constant-radius capsule reads as a pipe.
 */
export function capsule(w, h, x0, y0, x1, y1, r0, r1) {
  const mask = new Uint8Array(w * h);
  const shade = new Float32Array(w * h);
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy || 1e-6;
  const rMax = Math.max(r0, r1);

  const px0 = Math.max(0, Math.floor(Math.min(x0, x1) - rMax - 1));
  const px1 = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + rMax + 1));
  const py0 = Math.max(0, Math.floor(Math.min(y0, y1) - rMax - 1));
  const py1 = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + rMax + 1));

  for (let y = py0; y <= py1; y++) {
    for (let x = px0; x <= px1; x++) {
      // Sample at the pixel centre, or every edge lands on a half-pixel and the
      // silhouette wobbles by one depending on where the limb sits.
      const cx = x + 0.5;
      const cy = y + 0.5;
      let t = ((cx - x0) * vx + (cy - y0) * vy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ax = x0 + t * vx;
      const ay = y0 + t * vy;
      const dx = cx - ax;
      const dy = cy - ay;
      const r = r0 + t * (r1 - r0);
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      const p = y * w + x;
      mask[p] = 1;
      // Normal is radial from the axis: this is what makes a limb shade as a
      // tube rather than as a disc.
      const d = Math.sqrt(d2) || 1e-6;
      shade[p] = lit(dx / d, dy / d);
    }
  }
  return { mask, shade };
}

/** An axis-aligned ellipse. `cx,cy` are the centre in pixel space. */
export function ellipse(w, h, cx, cy, rx, ry) {
  const mask = new Uint8Array(w * h);
  const shade = new Float32Array(w * h);
  for (let y = Math.max(0, Math.floor(cy - ry - 1)); y <= Math.min(h - 1, Math.ceil(cy + ry + 1)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx - 1)); x <= Math.min(w - 1, Math.ceil(cx + rx + 1)); x++) {
      const ux = (x + 0.5 - cx) / rx;
      const uy = (y + 0.5 - cy) / ry;
      const d2 = ux * ux + uy * uy;
      if (d2 > 1) continue;
      const p = y * w + x;
      mask[p] = 1;
      // The ellipse's own normal, so a squashed head still shades correctly.
      const nxu = ux / rx;
      const nyu = uy / ry;
      const n = Math.hypot(nxu, nyu) || 1e-6;
      // Bias toward "lit from above": an ellipse's normal at the centre row is
      // horizontal, which would flatten the top of a head into mid-tone.
      shade[p] = Math.min(1, lit(nxu / n, nyu / n) * 0.75 + LIT_TOP * 0.25);
    }
  }
  return { mask, shade };
}

/** Even-odd filled polygon. Used for the muzzle and the feet. */
export function polygon(w, h, pts) {
  const mask = new Uint8Array(w * h);
  const shade = new Float32Array(w * h);
  let minY = h;
  let maxY = 0;
  let minX = w;
  let maxX = 0;
  for (const [x, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(h - 1, Math.ceil(maxY));
  minX = Math.max(0, Math.floor(minX));
  maxX = Math.min(w - 1, Math.ceil(maxX));

  for (let y = minY; y <= maxY; y++) {
    const cy = y + 0.5;
    // Scanline crossings, then fill between alternating pairs — even-odd.
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if (ay === by) continue;
      const lo = Math.min(ay, by);
      const hi = Math.max(ay, by);
      if (cy < lo || cy >= hi) continue;
      xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(minX, Math.ceil(xs[i] - 0.5));
      const to = Math.min(maxX, Math.floor(xs[i + 1] - 0.5));
      for (let x = from; x <= to; x++) {
        const p = y * w + x;
        mask[p] = 1;
        // No meaningful normal on a flat polygon, so fall back to a vertical
        // gradient: top lit, bottom shaded. Enough to stop a foot reading flat.
        const t = maxY > minY ? (cy - minY) / (maxY - minY) : 0.5;
        shade[p] = LIT_TOP * 0.45 + (1 - t) * 0.55;
      }
    }
  }
  return { mask, shade };
}

/** Grows a mask by `r` pixels, 4-neighbour, `r` times. */
export function dilate(mask, w, h, r = 1) {
  let cur = mask;
  for (let pass = 0; pass < r; pass++) {
    const next = Uint8Array.from(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (cur[p]) continue;
        if (
          (x > 0 && cur[p - 1]) ||
          (x < w - 1 && cur[p + 1]) ||
          (y > 0 && cur[p - w]) ||
          (y < h - 1 && cur[p + w])
        ) {
          next[p] = 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

/** Union of any number of masks. */
export function union(w, h, ...masks) {
  const out = new Uint8Array(w * h);
  for (const m of masks) for (let p = 0; p < m.length; p++) if (m[p]) out[p] = 1;
  return out;
}

/**
 * Merges several shapes into ONE, taking the brightest shade where they overlap.
 *
 * This exists so a group of primitives can be painted as a single part with a
 * single border. Painting a skull, its ears and its neck as three separate parts
 * draws a 1px line at every seam, and the head then reads as a disc balanced on
 * a stalk rather than as a head — which is exactly what the first fitted version
 * looked like, even though its silhouette profile matched the reference closely.
 * A profile metric cannot see a seam.
 *
 * Brightest-wins rather than first-or-last: the overlap between a skull and its
 * ears is on the lit top of the head, so the brighter value is the right one.
 */
export function mergeShapes(shapes) {
  const n = shapes[0].mask.length;
  const mask = new Uint8Array(n);
  const shade = new Float32Array(n);
  for (const s of shapes) {
    for (let p = 0; p < n; p++) {
      if (!s.mask[p]) continue;
      mask[p] = 1;
      if (s.shade[p] > shade[p]) shade[p] = s.shade[p];
    }
  }
  return { mask, shade };
}

// -----------------------------------------------------------------------------
// painting

/** Fills a mask with one colour, overwriting whatever was underneath. */
export function paintFlat(canvas, shape, colour, alpha = 255) {
  const { mask } = shape;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    canvas.buf[i] = colour[0];
    canvas.buf[i + 1] = colour[1];
    canvas.buf[i + 2] = colour[2];
    canvas.buf[i + 3] = alpha;
  }
}

/** Fills a mask with a shaded ramp lookup, using the shape's own shade channel. */
export function paint(canvas, shape, ramp) {
  // `palette.mjs` exports both `RAMP` (hex strings, for reading and for the
  // allow-list) and `rgb` (parsed triples, for drawing). Passing the former here
  // does not throw — indexing a string yields characters, which coerce to 0 in a
  // numeric buffer — it silently paints everything black, which is a slow thing
  // to notice in a 104px sprite.
  if (typeof ramp[0] === 'string') {
    throw new Error(`paint() wants parsed rgb triples from palette.rgb, got the hex strings in RAMP`);
  }
  const { mask, shade } = shape;
  const last = ramp.length - 1;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const c = ramp[Math.max(0, Math.min(last, Math.round(shade[p] * last)))];
    canvas.buf[i] = c[0];
    canvas.buf[i + 1] = c[1];
    canvas.buf[i + 2] = c[2];
    canvas.buf[i + 3] = 255;
  }
}

/**
 * The workhorse for a rigged part: a dilated border, then the shaded fill.
 *
 * Order matters and is the whole point — the border is painted first so it
 * overwrites whatever the part is crossing, then the fill covers all but the
 * outermost pixel of it, leaving a 1px line. See the module comment.
 */
export function paintPart(canvas, shape, ramp, border) {
  const grown = { mask: dilate(shape.mask, canvas.w, canvas.h, 1), shade: shape.shade };
  paintFlat(canvas, grown, border);
  paint(canvas, shape, ramp);
}

/**
 * Adds a 1px rim of `colour` just inside the mask's lit edge — the small
 * highlight that stops a bold flat shape reading as a paper cut-out. Only
 * applied where the pixel already faces the light, so the rim lands on the top
 * of a limb and never wraps underneath it.
 */
export function paintInnerRim(canvas, shape, colour, minShade = 0.82) {
  const { mask, shade } = shape;
  for (let y = 0; y < canvas.h; y++) {
    for (let x = 0; x < canvas.w; x++) {
      const p = y * canvas.w + x;
      if (!mask[p] || shade[p] < minShade) continue;
      // Only the boundary of the mask, not its interior.
      const edge =
        x === 0 ||
        y === 0 ||
        x === canvas.w - 1 ||
        y === canvas.h - 1 ||
        !mask[p - 1] ||
        !mask[p + 1] ||
        !mask[p - canvas.w] ||
        !mask[p + canvas.w];
      if (!edge) continue;
      const i = p * 4;
      canvas.buf[i] = colour[0];
      canvas.buf[i + 1] = colour[1];
      canvas.buf[i + 2] = colour[2];
      canvas.buf[i + 3] = 255;
    }
  }
}

/**
 * Paints `colour` into every transparent pixel touching the opaque silhouette.
 * Only needed where parts were not painted with `paintPart` — it cannot draw
 * internal separation lines, for the reason in the module comment.
 */
export function outline(canvas, colour) {
  const { w, h, buf } = canvas;
  const toPaint = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (buf[p * 4 + 3] !== 0) continue;
      if (
        (x > 0 && buf[(p - 1) * 4 + 3] === 255) ||
        (x < w - 1 && buf[(p + 1) * 4 + 3] === 255) ||
        (y > 0 && buf[(p - w) * 4 + 3] === 255) ||
        (y < h - 1 && buf[(p + w) * 4 + 3] === 255)
      ) {
        toPaint.push(p);
      }
    }
  }
  for (const p of toPaint) {
    const i = p * 4;
    buf[i] = colour[0];
    buf[i + 1] = colour[1];
    buf[i + 2] = colour[2];
    buf[i + 3] = 255;
  }
}

/** Copies `src` onto `dst` at (dx,dy), skipping fully transparent source pixels. */
export function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const s = (y * src.w + x) * 4;
      if (src.buf[s + 3] === 0) continue;
      const tx = dx + x;
      const ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= dst.w || ty >= dst.h) continue;
      const d = (ty * dst.w + tx) * 4;
      dst.buf[d] = src.buf[s];
      dst.buf[d + 1] = src.buf[s + 1];
      dst.buf[d + 2] = src.buf[s + 2];
      dst.buf[d + 3] = src.buf[s + 3];
    }
  }
}

// -----------------------------------------------------------------------------
// measurement

/** Opaque bounding box, or null if nothing was drawn. */
export function bbox(canvas) {
  const { w, h, buf } = canvas;
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1) / 2 };
}

/** Distinct RGB values among opaque pixels — the "is this really pixel art" number. */
export function opaqueColours(canvas) {
  const seen = new Set();
  const { buf } = canvas;
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] === 0) continue;
    seen.add((buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]);
  }
  return seen;
}
