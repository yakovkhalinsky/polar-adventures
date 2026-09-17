export const TILE = 32;

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
 *   2. JUMP_HEIGHT_PX      - how much level you can climb (try 3 .. 4 tiles)
 *   3. GROUND_ACCEL        - responsiveness        (try 1000 .. 1800)
 *   4. GRAVITY_FALL_RATIO  - weight                (try 1.4 .. 2.0)
 *   5. MAX_RUN_SPEED       - how far gaps are
 */

// --- the two design targets; everything vertical derives from these -------
export const JUMP_HEIGHT_PX = 3.5 * TILE; // 112px
export const APEX_TIME_S = 0.4;

export const MOVE = {
  // --- horizontal ---------------------------------------------------------
  MAX_RUN_SPEED: 160, // px/s   5 tiles/s
  GROUND_ACCEL: 1300, // px/s^2 -> top speed in 0.12s. The snappiness dial.
  AIR_ACCEL: 750, // px/s^2 -> ~58% of ground, so a jump commits you
  TURN_ACCEL: 2600, // px/s^2 -> only when input opposes velocity. Without
  //                              this, reversing at speed takes 0.25s and the
  //                              controls read as laggy when they aren't.
  GROUND_DRAG: 1500, // px/s^2 -> friction. Phaser applies drag ONLY when
  //                              acceleration is zero (World.computeVelocity).
  AIR_DRAG: 0, // px/s^2 -> ZERO, deliberately. Non-zero air drag eats your
  //                       horizontal speed at the apex and makes jumps fall
  //                       short. The most common arcade-platformer mistake.

  // --- vertical -----------------------------------------------------------
  // GRAVITY_RISE = 2h/t^2  and  JUMP_VELOCITY = 2h/t.
  // Change the targets above and let these stay derived — don't hand-edit one
  // without the other or the arc stops matching its stated apex.
  GRAVITY_RISE: (2 * JUMP_HEIGHT_PX) / (APEX_TIME_S * APEX_TIME_S), // 1400
  JUMP_VELOCITY: (2 * JUMP_HEIGHT_PX) / APEX_TIME_S, //  560
  GRAVITY_FALL_RATIO: 1.64, // asymmetric gravity IS the sense of weight;
  //                            1.6-2.0 is the sweet spot
  MAX_FALL_SPEED: 520, // px/s terminal velocity. Also stops the hero
  //                             tunnelling through thin one-way platforms.

  // --- jump shaping -------------------------------------------------------
  // On release while rising faster than this, velocity.y is CLAMPED to -this.
  // Clamp, not multiply: a clamp guarantees a floor on jump height, which a
  // multiplier does not (it varies with when you released).
  JUMP_CUT_VELOCITY: 330, // -> min hop 330^2/(2*1400) = 38.9px = 1.22 tiles

  // --- forgiveness windows ------------------------------------------------
  COYOTE_MS: 100, // ~6 frames of grace after walking off a ledge. The single
  //                  highest value-per-line feature in this file.
  JUMP_BUFFER_MS: 120, // ~7 frames of grace for pressing jump before landing
} as const;

export const GRAVITY_FALL = MOVE.GRAVITY_RISE * MOVE.GRAVITY_FALL_RATIO;

/**
 * Printed on boot so the tuning readout can never drift out of date with the
 * constants it describes.
 *
 * NOTE the continuous-vs-discrete gap. These are closed-form values, but
 * Phaser integrates with semi-implicit Euler on a fixed 60Hz step, which only
 * reaches ~96% of the continuous apex. Measured: the 112px design target lands
 * at 107.3px (3.35 tiles) in the running game, not 112px.
 *
 * Design ledges against the MEASURED figure. A "3.5 tile" jump clears a 3-tile
 * ledge with ~0.35 tiles to spare, not the 0.5 the formula implies. Raising
 * JUMP_HEIGHT_PX to compensate would tie the constant to the tick rate, so the
 * formula stays as readable design intent and the gap is documented instead.
 * scripts/verify-feel.mjs asserts the measured value.
 */
export const DERIVED = {
  apexPx: (MOVE.JUMP_VELOCITY * MOVE.JUMP_VELOCITY) / (2 * MOVE.GRAVITY_RISE),
  apexTiles:
    (MOVE.JUMP_VELOCITY * MOVE.JUMP_VELOCITY) / (2 * MOVE.GRAVITY_RISE) / TILE,
  minJumpPx:
    (MOVE.JUMP_CUT_VELOCITY * MOVE.JUMP_CUT_VELOCITY) / (2 * MOVE.GRAVITY_RISE),
  riseSeconds: MOVE.JUMP_VELOCITY / MOVE.GRAVITY_RISE,
  fallSeconds: MOVE.JUMP_VELOCITY / GRAVITY_FALL,
  runUpSeconds: MOVE.MAX_RUN_SPEED / MOVE.GROUND_ACCEL,
} as const;
