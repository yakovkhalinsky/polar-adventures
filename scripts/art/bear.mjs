/**
 * The bear, as a rig rather than as a drawing.
 *
 * WHY A RIG
 *
 * The previous approach generated one image per pose with FLUX and then had to
 * *register* them — translate each onto a common ground line and centre column —
 * because placement drifted ±1px between generations. Two of the four run frames
 * also shipped with a grey ground shadow the keyer could not remove, because the
 * shadow and the bear's own cool shading were the same colour (see
 * ANIMATION-LOG.md and the git history).
 *
 * Drawing from one skeleton deletes all of that. There is no backdrop to key and
 * no shadow, because the rig emits its own alpha. Every frame is the same bear by
 * construction, so nothing needs registering, and a frame costs nothing, so the
 * run can be eight frames instead of four.
 *
 * HOW A POSE IS EXPRESSED
 *
 * A pose is joint ANGLES in degrees, plus a root offset. 0 means "pointing up"
 * and angles increase clockwise, so a limb hanging straight DOWN is 180 — this
 * is worth stating loudly, because the first version of this file used angles
 * near 0 for the legs and drew them pointing up into the torso.
 *
 *   180 = down      170 = down and slightly forward      190 = down and back
 *
 * Angles are absolute for limbs and relative for the knees, elbows and neck, so
 * a pose reads as "the thigh is 14 degrees forward, the knee bends 10".
 *
 * FOOT PLANTING IS AUTOMATIC, and this is what makes the run work. Rather than
 * authoring the body's vertical bob by hand, `plant` slides the whole rig until
 * its lowest pixel lands on GROUND. The bob then falls out of the leg angles for
 * free: a leg straight under the body is taller than a leg reaching forward, so
 * the bear rises over the passing frame and drops onto the contact frame, which
 * is exactly the pendulum motion a run has. Authoring the bob separately would
 * mean keeping two numbers in agreement by hand.
 */

import { rgb } from './palette.mjs';
import {
  bbox,
  capsule,
  ellipse,
  makeCanvas,
  mergeShapes,
  paintFlat,
  paintPart,
} from './raster.mjs';

export const CANVAS_W = 104;
export const CANVAS_H = 124;
export const GROUND = 123;

/**
 * Proportions, measured against the shipping bear rather than guessed.
 *
 * `npm run`-less, but /tmp/pa-review/profile.mjs compares this rig's silhouette
 * width at 21 heights against the reference's, as a percentage of each one's own
 * height, and reports a mean absolute error. Everything below was set by driving
 * that number down, which is the only reason to trust any of it — the first
 * version looked plausible on screen and was 12.7 points out.
 *
 * What the profile caught, in order of size:
 *
 * - THE BEAR WAS FAR TOO NARROW. The reference peaks at ~56% of its height; the
 *   first rig peaked at 32%. A bear is a heavy animal and the silhouette has to
 *   carry that.
 * - THERE WAS NO NECK. At a quarter of the way down the reference narrows to 26%
 *   — the dip between the jaw and the shoulders — and the first rig was 43%
 *   there, because the head sat directly on the torso. The torso is now an
 *   ellipse whose top edge (y=36) sits well below the jaw (y=36 at its widest,
 *   tapering to nothing by y=30), so the dip is structural rather than drawn.
 * - THE LEGS WERE TOO THICK AND THE FEET TOO SMALL. The reference narrows to
 *   ~10% through the shins and then widens to ~41% at the feet, which stand
 *   apart. The first rig was 27% at the shins and 8% at the feet.
 */
const REST = {
  rootX: 50,
  rootY: 78,
  spine: 2, // torso lean, degrees forward of vertical
  neck: 8, // head angle, relative to the spine
  armFar: [162, -38],
  armNear: [156, -48],
  legFar: [182, 3],
  legNear: [178, -6],
};

const TORSO_LEN = 38; // hip to shoulder, along the spine
const NECK_LEN = 30; // shoulder to head centre
const HEAD_RX = 21;
const HEAD_RY = 15;

/** The torso is an ellipse, not a capsule. A capsule of this length bulges a
 *  full radius above its shoulder point, which is what buried the neck. */
const TORSO_RX = 30;
const TORSO_RY = 30;

/**
 * The shoulder hump. A bear's is pronounced, and without it the profile is a
 * plain ellipse that is hollow exactly where the reference is fullest — the rig
 * measured 10-14 points narrow through the upper chest until this was added.
 * Drawn as a separate mass rather than by fattening the torso, because
 * fattening the torso also fattens the belly, which was already right.
 */
const HUMP_X = -3; // relative to the shoulder, i.e. set back along the spine
const HUMP_Y = 6;
const HUMP_RX = 18;
const HUMP_RY = 14;

const UPPER_ARM = 16;
const FOREARM = 14;
const THIGH = 19;
const SHIN = 15;

const rad = (d) => (d * Math.PI) / 180;

/** Unit vector for an angle: 0 is up, 90 is forward, 180 is down. */
const dir = (a) => [Math.sin(rad(a)), -Math.cos(rad(a))];

const advance = ([x, y], angle, len) => {
  const [dx, dy] = dir(angle);
  return [x + dx * len, y + dy * len];
};

/**
 * A limb: two tapered capsules and an end. Returned unpainted, for depth ordering.
 *
 * `footed` gives the end a plantigrade foot — a forward-pointing capsule rather
 * than a circle. A bear walks on the whole sole, so the foot reads as long, and
 * a round paw both loses that and leaves the silhouette too narrow at the ground
 * line: the reference measures 41% of its height across the feet where a circle
 * gave 8%.
 */
function limb(from, a1, a2, l1, l2, r0, r1, r2, rEnd, ramp, footed = false) {
  const mid = advance(from, a1, l1);
  const end = advance(mid, a1 + a2, l2);
  const shapes = [
    { shape: capsule(CANVAS_W, CANVAS_H, from[0], from[1], mid[0], mid[1], r0, r1), ramp },
    { shape: capsule(CANVAS_W, CANVAS_H, mid[0], mid[1], end[0], end[1], r1, r2), ramp },
  ];
  if (footed) {
    // A flat, long ellipse, not a circle: a capsule of this length is as tall as
    // it is wide and the profile caught it as +27 points too wide at the ankles,
    // because the reference's feet are half as deep as they are long.
    shapes.push({
      shape: ellipse(CANVAS_W, CANVAS_H, end[0] + 2, end[1] + 1, rEnd + 8, rEnd - 1),
      ramp,
    });
  } else {
    shapes.push({ shape: ellipse(CANVAS_W, CANVAS_H, end[0], end[1], rEnd, rEnd - 1), ramp });
  }
  return shapes;
}

/** The head: ears, skull, muzzle. Returned in paint order. */
function headParts(cx, cy, tilt) {
  const out = [];
  // Ears first so the skull overlaps their bases and they read as attached
  // rather than as two circles floating above the head.
  // On top of the skull, but small and set BACK (the skull's centre is forward
  // of the head's, because the muzzle pulls the silhouette right). Sunk onto the
  // sides they disappear into the outline and the head reads as a dog's.
  for (const ex of [-13, 4]) {
    out.push({ shape: ellipse(CANVAS_W, CANVAS_H, cx + ex, cy - HEAD_RY + 9, 6, 6), ramp: rgb.fur });
  }
  out.push({ shape: ellipse(CANVAS_W, CANVAS_H, cx, cy, HEAD_RX, HEAD_RY), ramp: rgb.fur });

  // The muzzle, as a tapered capsule rather than a polygon: a quad has four
  // hard corners and at this size they read as a box bolted to the face. The
  // taper is what makes it a snout.
  const t = rad(tilt);
  const spin = (px, py) => [
    cx + (px - cx) * Math.cos(t) - (py - cy) * Math.sin(t),
    cy + (px - cx) * Math.sin(t) + (py - cy) * Math.cos(t),
  ];
  const [ax, ay] = spin(cx + 3, cy + 1);
  const [bx, by] = spin(cx + HEAD_RX + 5, cy + 4);
  out.push({ shape: capsule(CANVAS_W, CANVAS_H, ax, ay, bx, by, 10, 6), ramp: rgb.fur });
  return { parts: out, noseX: bx - 1, noseY: by };
}

/**
 * Renders one frame.
 *
 * Draw order is far-to-near: the far arm and leg behind the torso, then the head,
 * then the near leg and near arm in front. Each part is painted as a 1px border
 * plus its own fill, so a near limb crossing the torso cuts a separation line
 * into it — see scripts/art/raster.mjs for why that cannot be done with a
 * whole-silhouette outline pass.
 */
export function renderBear(pose = {}, { plant = true } = {}) {
  const P = { ...REST, ...pose };

  const once = (rootY) => {
    const hip = [P.rootX, rootY];
    const shoulder = advance(hip, P.spine, TORSO_LEN);
    const headC = advance(shoulder, P.spine + P.neck, NECK_LEN);

    const legAnchor = (side) => [hip[0] + side * 3, hip[1] + 1];
    // Arms sit at the FRONT of the chest, not down the middle of the belly. A
    // side view of a standing bear has its forelimbs at the leading edge of the
    // silhouette; anchored centrally they read as a lump on the torso, which is
    // exactly how the first version looked.
    const armAnchor = (side) => [shoulder[0] + 14 + side * 5, shoulder[1] + 8];

    // Far limbs one tone darker — see `furFar` in palette.mjs.
    const farArm = limb(armAnchor(-1), P.armFar[0], P.armFar[1], UPPER_ARM, FOREARM, 8, 7, 6, 7, rgb.furFar);
    const farLeg = limb(legAnchor(-1), P.legFar[0], P.legFar[1], THIGH, SHIN, 15, 11, 7, 8, rgb.furFar, true);
    const nearLeg = limb(legAnchor(1), P.legNear[0], P.legNear[1], THIGH, SHIN, 15, 11, 7, 8, rgb.fur, true);
    const nearArm = limb(armAnchor(1), P.armNear[0], P.armNear[1], UPPER_ARM, FOREARM, 8, 7, 6, 7, rgb.fur);

    // The torso is centred on the spine so the lean tilts it with the rest of
    // the body, and the neck fills the gap up to the jaw — without it the head
    // reads as detached.
    const mid = [(hip[0] + shoulder[0]) / 2, (hip[1] + shoulder[1]) / 2];
    const body = {
      shape: mergeShapes([
        ellipse(CANVAS_W, CANVAS_H, mid[0], mid[1], TORSO_RX, TORSO_RY),
        ellipse(CANVAS_W, CANVAS_H, shoulder[0] + HUMP_X, shoulder[1] + HUMP_Y, HUMP_RX, HUMP_RY),
      ]),
      ramp: rgb.fur,
    };
    // The head is the skull, its ears, the muzzle AND the neck, merged into one
    // shape so it is painted with a single border — see mergeShapes().
    const neckShape = capsule(
      CANVAS_W,
      CANVAS_H,
      shoulder[0] + 1,
      shoulder[1] + 2,
      headC[0],
      headC[1] + HEAD_RY - 3,
      24,
      15,
    );
    const { parts: headPartsRaw, noseX, noseY } = headParts(headC[0], headC[1], P.spine + P.neck);
    const headShapes = [{ shape: mergeShapes([...headPartsRaw.map((h) => h.shape), neckShape]), ramp: rgb.fur }];

    const c = makeCanvas(CANVAS_W, CANVAS_H);
    const paintAll = (list) => {
      for (const s of list) paintPart(c, s.shape, s.ramp, rgb.outline[0]);
    };
    paintAll(farArm);
    paintAll(farLeg);
    paintAll([body]);
    paintAll(headShapes);
    paintAll(nearLeg);
    paintAll(nearArm);

    // Face marks last and unoutlined: an outlined 2px eye is a 4px blob and
    // reads as a smudge. These are the only `ink` in the sprite, and
    // scripts/smoke.mjs checks they sit right of centre in the head band —
    // setFlipX mirrors the whole sprite, so a centred face is wrong both ways.
    paintFlat(c, ellipse(CANVAS_W, CANVAS_H, noseX, noseY, 4, 3), rgb.ink[0]);
    paintFlat(c, ellipse(CANVAS_W, CANVAS_H, headC[0] + 6, headC[1] - 4, 2, 2), rgb.ink[0]);

    return c;
  };

  if (!plant) return { canvas: once(P.rootY) };

  // Plant: one measure, one correction. Translation is linear, so a single
  // pass lands exactly rather than converging.
  const first = once(P.rootY);
  const box = bbox(first);
  if (!box) throw new Error('the rig rendered nothing');
  const shift = GROUND - box.y1;
  return { canvas: shift === 0 ? first : once(P.rootY + shift) };
}
