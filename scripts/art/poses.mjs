/**
 * The pose tables: one entry per animation frame, in joint angles.
 *
 * See scripts/art/bear.mjs for what an angle means — 0 is up, 180 is down and
 * slightly forward is 170. Angles are the ONLY thing here; the body's vertical
 * bob is not authored, because the rig plants each frame on the ground line and
 * the bob falls out of the leg angles. That is why nothing below mentions height.
 *
 * WHY EXPLICIT TABLES RATHER THAN SINE WAVES
 *
 * A run can be written as `180 - 30*cos(t)` and it will look approximately
 * right. It was tried, and the problem is the knee: a knee is not a sine. It
 * bends hard through the lift and is nearly straight at contact, and expressing
 * that with a phase-shifted cosine means stacking clamps until the numbers stop
 * meaning anything. Eight explicit rows can be read, argued with and tuned.
 *
 * THE RUN IS EIGHT FRAMES, not four. The four-frame version needed a generation
 * per pose and still had to be measured to prove the frames differed at all;
 * here a frame costs nothing, and eight gives the near and far legs a proper
 * half-stride offset instead of making one leg do all the work.
 */

/**
 * Run, 8 frames, one full stride.
 *
 * Only the NEAR side is authored; the far side is the same cycle half a stride
 * out of phase, derived below. That is what makes this read as running rather
 * than hopping — at frame 0 the near leg is forward and planted while the far
 * leg trails, and four frames later they have swapped. Getting it wrong (four
 * frames of the SAME leg) is the exact failure the generated run cycle shipped
 * with and had to be measured against.
 *
 * THE STANCE IS SHORTER THAN THE SWING, and that is not a detail. A first
 * version ran the thigh through a symmetric arc — 150 up to 210 and back — and
 * measured frames 1 and 7 at only 3.6% apart in silhouette, because a leg at
 * 162 degrees on the way up and a leg at 162 degrees on the way down really are
 * the same picture once the foot is planted. A real gait spends frames 0-2 in
 * stance pushing back, then 3-7 lifting, tucking and reaching, and the numbers
 * below follow that: the thigh lingers near the back and swings forward fast.
 *
 *             0     1     2     3     4     5     6     7
 *             contact    push-off    tuck       reach        contact
 */
const NEAR_THIGH = [148, 168, 190, 206, 196, 172, 152, 144];
const NEAR_KNEE = [-6, -12, -20, -70, -78, -56, -22, -10];
const NEAR_ARM = [206, 190, 170, 158, 166, 188, 204, 210];
const NEAR_ELBOW = [-30, -34, -40, -46, -44, -38, -32, -30];

/** The far side is the near side half a stride later. */
const HALF_STRIDE = NEAR_THIGH.length / 2;
const shifted = (arr, i) => arr[(i + HALF_STRIDE) % arr.length];

const RUN = NEAR_THIGH.map((thigh, i) => ({
  legNear: [thigh, NEAR_KNEE[i]],
  legFar: [shifted(NEAR_THIGH, i), shifted(NEAR_KNEE, i)],
  armNear: [NEAR_ARM[i], NEAR_ELBOW[i]],
  armFar: [shifted(NEAR_ARM, i), shifted(NEAR_ELBOW, i)],
  // A run leans. The lean is split across the spine and the neck so the head
  // stays level and looks where it is going rather than at the floor.
  spine: 11 + (i % 2 ? 1 : 0),
  neck: -9,
}));

/** Idle, 4 frames: a slow breath. Small numbers on purpose — this loops for
 *  minutes and anything larger reads as a twitch. */
const IDLE = [0, 1, 2, 1].map((k) => ({
  spine: 2 + k,
  neck: 5 - k,
  armNear: [155 - k, -55 + k * 2],
  armFar: [160 - k, -45 + k * 2],
  legFar: [184, 4],
  legNear: [174, -12],
}));

/**
 * Airborne and impact poses.
 *
 * These deliberately keep a paw near the ground line. The sprite's last row is
 * pinned to the bottom of the physics body (Player.setOffset), so a frame whose
 * art stops short of that row draws the bear hovering above its own hitbox and
 * then popping down on landing. A leap reads through the extended trailing leg
 * and the raised arms instead of through tucking.
 */
const JUMP = [
  { spine: 8, neck: -4, legNear: [170, -14], legFar: [190, -10], armNear: [120, -20], armFar: [128, -24] },
  { spine: 10, neck: -6, legNear: [166, -6], legFar: [196, -4], armNear: [100, -14], armFar: [110, -18] },
];

const FALL = [
  { spine: 4, neck: 6, legNear: [168, -30], legFar: [188, -24], armNear: [145, -40], armFar: [152, -34] },
  { spine: 3, neck: 8, legNear: [172, -22], legFar: [184, -18], armNear: [140, -46], armFar: [148, -40] },
];

const LAND = [
  { spine: 16, neck: -12, legNear: [158, -40], legFar: [196, -34], armNear: [130, -50], armFar: [138, -44] },
  { spine: 10, neck: -4, legNear: [168, -22], legFar: [190, -18], armNear: [148, -50], armFar: [152, -44] },
  { spine: 4, neck: 3, legNear: [174, -14], legFar: [184, -10], armNear: [155, -52], armFar: [158, -46] },
];

/** The ice slide: leaning back with the legs braced forward, which is what
 *  distinguishes it from the run at a glance — without it, sliding plays a
 *  full-rate run cycle and reads as running. */
const SLIDE = [
  { spine: -10, neck: 12, legNear: [136, -18], legFar: [150, -12], armNear: [200, -20], armFar: [206, -16] },
  { spine: -12, neck: 14, legNear: [132, -14], legFar: [146, -10], armNear: [206, -22], armFar: [212, -18] },
  { spine: -10, neck: 12, legNear: [136, -18], legFar: [150, -12], armNear: [200, -20], armFar: [206, -16] },
  { spine: -8, neck: 10, legNear: [140, -20], legFar: [154, -14], armNear: [196, -18], armFar: [202, -14] },
];

/**
 * Frame durations in ms. The run is 12fps, which suits the 8-frame stride; the
 * others are slow because they are held rather than cycled.
 */
export const STATES = {
  idle: { frames: IDLE, fps: 6, repeat: -1 },
  run: { frames: RUN, fps: 12, repeat: -1 },
  jump: { frames: JUMP, fps: 8, repeat: 0 },
  fall: { frames: FALL, fps: 6, repeat: -1 },
  land: { frames: LAND, fps: 14, repeat: 0 },
  slide: { frames: SLIDE, fps: 8, repeat: -1 },
};

/** The order frames are laid out in the sheet. Fixed, because the game indexes
 *  into it by frame number when it builds the animations. */
export const STATE_ORDER = ['idle', 'run', 'jump', 'fall', 'land', 'slide'];

export const frameCount = (name) => STATES[name].frames.length;
export const totalFrames = STATE_ORDER.reduce((n, s) => n + frameCount(s), 0);
