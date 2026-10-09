## Every number that decides how the hero feels to control.
##
## Ported from the Phaser build's src/config/movement.ts, which is now retired.
## The model is engine-agnostic and worth stating plainly, because it is the one
## thing the port is really carrying:
##
##   two design targets  ->  every vertical constant
##
## GRAVITY_RISE and JUMP_VELOCITY are DERIVED, not tuned. Nothing vertical is
## hand-edited independently, so the arc cannot silently stop matching its
## stated apex. Change the targets and let these follow.
##
## Units are PIXELS PER SECOND and PIXELS PER SECOND SQUARED. Do not introduce a
## "pixels per frame" number anywhere — it will silently be 60x wrong.
##
## Tuning order if the feel is off:
##   1. APEX_TIME_S         - snappy vs floaty      (try 0.34 .. 0.46)
##   2. JUMP_HEIGHT_HEROES  - how much level you can climb (try 3 .. 4)
##   3. GROUND_ACCEL        - responsiveness        (try 3000 .. 6000)
##   4. GRAVITY_FALL_RATIO  - weight                (try 1.4 .. 2.0)
##   5. MAX_RUN_SPEED       - how far gaps are

class_name Movement
extends RefCounted

## The hero's height in game pixels, and the unit every design target is
## expressed in.
##
## This is the ART's height, and that is the point of it. The Phaser build had
## HERO_H = 124 because that was its sprite's height; the isometric bear has moved
## twice with the art, and sits at 64 now.
##
## 64 rather than the maximum: measured across the eight rotations the bear spans
## 61-66px tall, because a three-quarter view shows more vertical extent than a
## front view — that is foreshortening, not inconsistency. 64 is the centre of that
## range, and it is also the value that lands a 3.5 hero-height jump on EXACTLY 7
## diamond-heights, which is worth having when the level grid is diamond-shaped.
##
## Every absolute constant here scales with the hero, not the tile. Anything
## measured in SECONDS does not scale at all — which is why the rise, fall and
## run-up times below are unmoved by HERO_H halving from 128 to 64.
const HERO_H := 64.0

# --- the two design targets; everything vertical derives from these ---------
const JUMP_HEIGHT_HEROES := 3.5
const APEX_TIME_S := 0.40

const JUMP_HEIGHT_PX := JUMP_HEIGHT_HEROES * HERO_H  # 448

# --- horizontal -------------------------------------------------------------
# Restated in hero-relative terms rather than carried as px/s literals, so that
# each constant's MEANING survives a change to HERO_H. The values are the same
# feel as the Phaser build's; the numbers are not the same numbers.
const RUN_HEROES_PER_S := 5.0
const MAX_RUN_SPEED := RUN_HEROES_PER_S * HERO_H  # 640 px/s
const RUN_UP_SECONDS := 0.12  # top speed in 0.12s — a TIME, so it does not scale
const GROUND_ACCEL := MAX_RUN_SPEED / RUN_UP_SECONDS  # 5333.33 px/s^2
const TURN_ACCEL := 2.0 * GROUND_ACCEL  # 10666.67
# Exactly 2x, where the Phaser value was one unit under (10075 against a doubling
# of 10076). The documented intent was "2.0x GROUND_ACCEL", so honouring the
# intent is the right call on a rebuild — but the change is deliberate and worth
# seeing rather than a silent drift.
const AIR_ACCEL_RATIO := 0.58
const AIR_ACCEL := AIR_ACCEL_RATIO * GROUND_ACCEL  # 3093.33 — a jump commits you
const AIR_DRAG := 0.0  # ZERO, deliberately. Non-zero air drag eats horizontal
#                        speed at the apex and makes jumps fall short. The most
#                        common arcade-platformer mistake.
## How far a release at top speed coasts on rock, in hero-heights. Restated from
## the Phaser build's 33.06px at HERO_H 124 — carried across, not derived.
const SLIDE_HEROES := 0.2666
const GROUND_DRAG := (MAX_RUN_SPEED * MAX_RUN_SPEED) / (2.0 * SLIDE_HEROES * HERO_H)

# --- vertical, DERIVED ------------------------------------------------------
# GRAVITY_RISE = 2h/t^2  and  JUMP_VELOCITY = 2h/t.
const GRAVITY_RISE := (2.0 * JUMP_HEIGHT_PX) / (APEX_TIME_S * APEX_TIME_S)  # 5600
const JUMP_VELOCITY := (2.0 * JUMP_HEIGHT_PX) / APEX_TIME_S  # 2240

# --- vertical, hand-set -----------------------------------------------------
# These are NOT derived. They are the taste layer on top of the derived arc.
const GRAVITY_FALL_RATIO := 1.64  # asymmetric gravity IS the sense of weight;
#                                     1.6-2.0 is the sweet spot
const GRAVITY_FALL := GRAVITY_RISE * GRAVITY_FALL_RATIO  # 9184
## Terminal fall speed in hero-heights/s. Restated from the Phaser build's 2015px
## at HERO_H 124 — carried across, not derived.
const FALL_HEROES_PER_S := 16.25
const MAX_FALL_SPEED := FALL_HEROES_PER_S * HERO_H  # 2080 px/s

## The minimum hop as a fraction of full jump velocity.
##
## On release while rising faster than `JUMP_VELOCITY * this`, velocity.y is
## CLAMPED to it. Clamp, not multiply: a clamp guarantees a floor on jump height,
## which a multiplier does not (it varies with when you released).
##
## Restated from the Phaser build's 1279/2170 — carried across, not derived.
const MIN_HOP_RATIO := 0.5894
const JUMP_CUT_VELOCITY := JUMP_VELOCITY * MIN_HOP_RATIO  # 1320.26 -> min hop 1.22 hero-heights

# --- forgiveness windows ----------------------------------------------------
const COYOTE_MS := 100.0  # ~6 frames of grace after walking off a ledge. The
#                             single highest value-per-line feature in this file.
const JUMP_BUFFER_MS := 120.0  # ~7 frames of grace for pressing jump before landing

# --- derived readouts; printed on boot so the tuning readout can never drift
# --- out of date with the constants it describes ----------------------------
const APEX_PX := (JUMP_VELOCITY * JUMP_VELOCITY) / (2.0 * GRAVITY_RISE)
const APEX_HEROES := JUMP_HEIGHT_PX / HERO_H
const MIN_JUMP_PX := (JUMP_CUT_VELOCITY * JUMP_CUT_VELOCITY) / (2.0 * GRAVITY_RISE)
const MIN_JUMP_HEROES := MIN_JUMP_PX / HERO_H
const RISE_SECONDS := JUMP_VELOCITY / GRAVITY_RISE
const FALL_SECONDS := JUMP_VELOCITY / GRAVITY_FALL
# RUN_UP_SECONDS is deliberately NOT here. It used to be a derived readout
# (MAX_RUN_SPEED / GROUND_ACCEL); now that it is a design INPUT that GROUND_ACCEL
# is built from, declaring it in both places is a duplicate-constant error. Worth
# noting because the direction of that dependency flipped when the constants were
# restated in hero-relative terms.

## Gap reach at full run, flat: airborne time x run speed.
const GAP_REACH_PX := MAX_RUN_SPEED * (JUMP_VELOCITY / GRAVITY_RISE + JUMP_VELOCITY / GRAVITY_FALL)

## How far a release at top speed coasts, `v^2 / 2a`.
const ROCK_SLIDE_PX := (MAX_RUN_SPEED * MAX_RUN_SPEED) / (2.0 * GROUND_DRAG)

## The apex the RUNNING GAME actually reaches, as opposed to the closed form.
##
## The constants above are continuous-maths values, but the engine integrates
## with semi-implicit Euler on a fixed step, which only reaches ~96% of them.
## Rather than writing down a number somebody measured once, this simulates the
## integrator — so the gap is derived from the constants and cannot drift away
## from them.
##
## Do NOT "fix" JUMP_HEIGHT_PX to compensate. That would tie a readable design
## intent to the tick rate. Design ledges against the measured figure instead:
## a "3.5 hero-height" jump clears a 3-hero-height ledge with ~0.35 to spare,
## not the 0.5 the formula implies.
##
## The integrator simulated here is `v += g*dt; y += v*dt`, which is what both
## Phaser's Arcade body and a plain `velocity += gravity * delta` in
## _physics_process do. Same integrator, same number.
static func simulate_apex_px(ticks_per_second: float = 60.0) -> float:
	var dt := 1.0 / ticks_per_second
	var y := 0.0  # y is DOWN, as in both engines; a rise is a negative y
	var vy := -JUMP_VELOCITY
	var peak := 0.0
	# Bounded so a constant that never returns to the ground cannot hang the run.
	for _i in 100000:
		vy += (GRAVITY_RISE if vy < 0.0 else GRAVITY_FALL) * dt
		y += vy * dt
		peak = maxf(peak, -y)
		if vy >= 0.0 and y >= 0.0:
			break
	return peak

## The tuning readout. Printed on boot, and asserted in the test suite, for the
## same reason: the two must not be able to disagree.
static func readout_lines() -> PackedStringArray:
	var lines := PackedStringArray()
	lines.append("hero height        %.0f px" % HERO_H)
	lines.append("jump target        %.2f hero-heights (%.0f px)" % [JUMP_HEIGHT_HEROES, JUMP_HEIGHT_PX])
	lines.append("apex, closed form  %.1f px" % APEX_PX)
	lines.append(
		"apex, measured     %.1f px  (%.2f hero-heights)" % [
			simulate_apex_px(), simulate_apex_px() / HERO_H
		]
	)
	lines.append("min hop            %.1f px  (%.2f hero-heights)" % [MIN_JUMP_PX, MIN_JUMP_HEROES])
	lines.append("rise / fall        %.3f s / %.3f s" % [RISE_SECONDS, FALL_SECONDS])
	lines.append("run-up to top      %.3f s" % RUN_UP_SECONDS)
	lines.append("gap reach, flat    %.1f px" % GAP_REACH_PX)
	lines.append("rock slide         %.1f px" % ROCK_SLIDE_PX)
	lines.append("coyote / buffer    %.0f ms / %.0f ms" % [COYOTE_MS, JUMP_BUFFER_MS])
	return lines
