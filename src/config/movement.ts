/**
 * The hero's height in game pixels, and the unit every design target below is
 * expressed in.
 *
 * This used to be the collision tile. Both happened to be 32, so "a 3.5 tile
 * jump" and "a 3.5 hero-height jump" were the same number and nobody had to
 * decide which it meant. After the rescale the hero is 1.85 tiles tall, so the
 * two diverge hard: left as tiles, the jump would silently become 0.6
 * hero-heights and the hero could barely hop over its own feet.
 *
 * Every absolute constant in this file scales with the hero, not the tile.
 * Anything measured in SECONDS does not scale at all — that is the whole reason
 * the feel survives the rescale.
 */
export const HERO_H = 124;

/**
 * Every number that decides how the hero feels to control.
 *
 * Units are PIXELS PER SECOND and PIXELS PER SECOND SQUARED. Phaser's Arcade
 * physics is already in these units — `World.computeVelocity` does
 * `velocityY += gravity * delta` with `delta` in SECONDS — so no conversion is
 * needed anywhere. Do not introduce a "pixels per frame" number here; it will
 * silently be 60x wrong.
 *
 * Tuning order if the feel is off:
 *   1. APEX_TIME_S         - snappy vs floaty      (try 0.34 .. 0.46)
 *   2. JUMP_HEIGHT_HEROES  - how much level you can climb (try 3 .. 4)
 *   3. GROUND_ACCEL        - responsiveness        (try 3000 .. 6000)
 *   4. GRAVITY_FALL_RATIO  - weight                (try 1.4 .. 2.0)
 *   5. MAX_RUN_SPEED       - how far gaps are
 */

// --- the two design targets; everything vertical derives from these -------
export const JUMP_HEIGHT_HEROES = 3.5;
export const APEX_TIME_S = 0.4;

export const JUMP_HEIGHT_PX = JUMP_HEIGHT_HEROES * HERO_H; // 434px

export const MOVE = {
  // --- horizontal ---------------------------------------------------------
  MAX_RUN_SPEED: 620, // px/s   5 hero-heights/s
  GROUND_ACCEL: 5038, // px/s^2 -> top speed in 0.12s. The snappiness dial.
  AIR_ACCEL: 2906, // px/s^2 -> ~58% of ground, so a jump commits you
  TURN_ACCEL: 10075, // px/s^2 -> only when input opposes velocity. Without
  //                              this, reversing at speed takes 0.25s and the
  //                              controls read as laggy when they aren't.
  GROUND_DRAG: 5813, // px/s^2 -> friction. Phaser applies drag ONLY when
  //                              acceleration is zero (World.computeVelocity).
  AIR_DRAG: 0, // px/s^2 -> ZERO, deliberately. Non-zero air drag eats your
  //                       horizontal speed at the apex and makes jumps fall
  //                       short. The most common arcade-platformer mistake.

  // --- vertical -----------------------------------------------------------
  // GRAVITY_RISE = 2h/t^2  and  JUMP_VELOCITY = 2h/t.
  // Change the targets above and let these stay derived — don't hand-edit one
  // without the other or the arc stops matching its stated apex.
  GRAVITY_RISE: (2 * JUMP_HEIGHT_PX) / (APEX_TIME_S * APEX_TIME_S), // 5425
  JUMP_VELOCITY: (2 * JUMP_HEIGHT_PX) / APEX_TIME_S, // 2170
  GRAVITY_FALL_RATIO: 1.64, // asymmetric gravity IS the sense of weight;
  //                            1.6-2.0 is the sweet spot
  MAX_FALL_SPEED: 2015, // px/s terminal velocity. Also stops the hero
  //                             tunnelling through thin one-way platforms.

  // --- jump shaping -------------------------------------------------------
  // On release while rising faster than this, velocity.y is CLAMPED to -this.
  // Clamp, not multiply: a clamp guarantees a floor on jump height, which a
  // multiplier does not (it varies with when you released).
  JUMP_CUT_VELOCITY: 1279, // -> min hop 1.22 hero-heights, same as before

  // --- forgiveness windows ------------------------------------------------
  COYOTE_MS: 100, // ~6 frames of grace after walking off a ledge. The single
  //                  highest value-per-line feature in this file.
  JUMP_BUFFER_MS: 120, // ~7 frames of grace for pressing jump before landing
} as const;

/**
 * What the hero is standing on. Only the horizontal constants differ between
 * these — ice never touches gravity, jump height or top speed.
 */
export type Surface = 'rock' | 'ice';

/**
 * Ice is a FEEL surface: it changes how quickly horizontal speed can change,
 * and nothing else.
 *
 * It deliberately does NOT raise MAX_RUN_SPEED. Arcade clamps velocity against
 * maxVelocity LAST (World.computeVelocity), and that clamp is absolute, so
 * sliding faster than run speed would mean raising the cap — which would make
 * ice a speed boost rather than a hazard.
 *
 * ACCEL and TURN are not optional extras. Arcade applies drag ONLY on a step
 * where acceleration is exactly zero (`else if (allowDrag && dragX)`,
 * World.computeVelocity), so while a direction is held, drag contributes
 * nothing at all and these two are the only levers that exist. DRAG governs
 * the coast after you let go.
 */
export const ICE = {
  ACCEL: 1628, // px/s^2 -> 0.38s to top speed, vs 0.12s on rock
  TURN: 2713, // px/s^2 -> reversing at speed carries you a long way
  DRAG: 465, // px/s^2 -> coasts ~413px from top speed, vs ~33px on rock
} as const;

/**
 * The horizontal tuning for a surface. Returning a whole preset rather than
 * having the caller pick fields keeps the branching in one place, and means
 * adding a third surface later is a change to this file alone.
 */
export function groundTuning(surface: Surface): {
  accel: number;
  turn: number;
  drag: number;
} {
  return surface === 'ice'
    ? { accel: ICE.ACCEL, turn: ICE.TURN, drag: ICE.DRAG }
    : {
        accel: MOVE.GROUND_ACCEL,
        turn: MOVE.TURN_ACCEL,
        drag: MOVE.GROUND_DRAG,
      };
}

export const GRAVITY_FALL = MOVE.GRAVITY_RISE * MOVE.GRAVITY_FALL_RATIO;

/**
 * Printed on boot so the tuning readout can never drift out of date with the
 * constants it describes.
 *
 * NOTE the continuous-vs-discrete gap. These are closed-form values, but
 * Phaser integrates with semi-implicit Euler on a fixed 60Hz step, which only
 * reaches ~96% of the continuous apex. Measured: the 434px design target lands
 * at ~416px (3.35 hero-heights) in the running game, not 434px.
 *
 * Design ledges against the MEASURED figure. A "3.5 hero-height" jump clears a
 * 3-hero-height ledge with ~0.35 to spare, not the 0.5 the formula implies.
 * Raising JUMP_HEIGHT_PX to compensate would tie the constant to the tick rate,
 * so the formula stays as readable design intent and the gap is documented
 * instead. scripts/verify-feel.mjs asserts the measured value.
 *
 * `apexHeroes` is the figure to design against. Level geometry is authored in
 * collision tiles, but this file deliberately does not know how big one is —
 * importing TILE_H from config/game would close an import cycle
 * (game -> scenes -> movement -> game), and the hero's height is the right unit
 * here anyway. BootScene converts to tiles for the readout.
 */
export const DERIVED = {
  apexPx: (MOVE.JUMP_VELOCITY * MOVE.JUMP_VELOCITY) / (2 * MOVE.GRAVITY_RISE),
  apexHeroes: JUMP_HEIGHT_PX / HERO_H,
  minJumpPx:
    (MOVE.JUMP_CUT_VELOCITY * MOVE.JUMP_CUT_VELOCITY) / (2 * MOVE.GRAVITY_RISE),
  minJumpHeroes:
    (MOVE.JUMP_CUT_VELOCITY * MOVE.JUMP_CUT_VELOCITY) /
    (2 * MOVE.GRAVITY_RISE) /
    HERO_H,
  riseSeconds: MOVE.JUMP_VELOCITY / MOVE.GRAVITY_RISE,
  fallSeconds: MOVE.JUMP_VELOCITY / GRAVITY_FALL,
  runUpSeconds: MOVE.MAX_RUN_SPEED / MOVE.GROUND_ACCEL,
  // Gap reach at full run, flat: airborne time x run speed.
  gapReachPx:
    MOVE.MAX_RUN_SPEED *
    (MOVE.JUMP_VELOCITY / MOVE.GRAVITY_RISE + MOVE.JUMP_VELOCITY / GRAVITY_FALL),

  // How far a release at top speed coasts on each surface, `v^2 / 2a`.
  rockSlidePx: (MOVE.MAX_RUN_SPEED * MOVE.MAX_RUN_SPEED) / (2 * MOVE.GROUND_DRAG),
  iceSlidePx: (MOVE.MAX_RUN_SPEED * MOVE.MAX_RUN_SPEED) / (2 * ICE.DRAG),
  iceRunUpSeconds: MOVE.MAX_RUN_SPEED / ICE.ACCEL,
} as const;
