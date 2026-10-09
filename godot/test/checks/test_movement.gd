## Checks on the movement model.
##
## These assert the DERIVED relationships, not tuned values, so retuning the two
## design targets at the top of movement.gd updates the expectations rather than
## breaking them. That is the whole point of the model: the constants are not
## independently editable.
##
## They were re-baselined once, when HERO_H moved from 124 to 128 to match the
## isometric bear. Note that the TIMES did not move (rise 0.40s, fall 0.244s,
## run-up 0.12s) while every distance and speed grew by 128/124 — which is the
## signature of a scale change done right, and worth reading as such.

extends RefCounted

func run(h) -> void:
	# --- the design unit is the ART's height ------------------------------
	# If this and the sprite's height ever disagree, "3.5 hero-heights" stops
	# meaning 3.5 of the character's own heights.
	h.eq("HERO_H is the art's height (64)", Movement.HERO_H, 64.0)

	# --- the two design targets generate the constants --------------------
	h.close("JUMP_HEIGHT_PX = 3.5 x HERO_H", Movement.JUMP_HEIGHT_PX, 224.0, 0.001)
	h.close("GRAVITY_RISE = 2h/t^2 (derived)", Movement.GRAVITY_RISE, 2800.0, 0.5)
	h.close("JUMP_VELOCITY = 2h/t (derived)", Movement.JUMP_VELOCITY, 1120.0, 0.5)
	h.close("GRAVITY_FALL = RISE x 1.64", Movement.GRAVITY_FALL, 4592.0, 0.5)

	# --- the hero-relative restatements, each asserting its own MEANING ----
	# These are the reason a HERO_H change is safe: every one of them is checked
	# against what it means rather than against a px/s literal, so the numbers can
	# move with the character while the feel stays put.
	h.close(
		"max run is 5 hero-heights/s",
		Movement.MAX_RUN_SPEED / Movement.HERO_H,
		5.0,
		0.0001,
	)
	h.close("top speed takes 0.12s", Movement.RUN_UP_SECONDS, 0.12, 0.0001)
	# Exactly 2x now. The Phaser value was one unit under a doubling (10075 against
	# 10076) despite a comment claiming 2.0x; the rebuild honours the documented
	# intent, so the old "one unit under" check is gone by design, not by accident.
	h.close(
		"turn accel is exactly 2x ground",
		Movement.TURN_ACCEL / Movement.GROUND_ACCEL,
		2.0,
		0.0001,
	)
	h.close(
		"air accel is 58% of ground",
		Movement.AIR_ACCEL / Movement.GROUND_ACCEL,
		0.58,
		0.0001,
	)
	h.eq("air drag is zero (jump momentum survives)", Movement.AIR_DRAG, 0.0)
	h.close(
		"a tap clamps to 0.5894 of full jump velocity",
		Movement.JUMP_CUT_VELOCITY / Movement.JUMP_VELOCITY,
		0.5894,
		0.0001,
	)
	h.close(
		"terminal fall is 16.25 hero-heights/s",
		Movement.MAX_FALL_SPEED / Movement.HERO_H,
		16.25,
		0.0001,
	)
	h.close(
		"a release at top speed coasts ~0.267 hero-heights",
		Movement.ROCK_SLIDE_PX / Movement.HERO_H,
		0.2666,
		0.001,
	)

	# --- derived readouts --------------------------------------------------
	h.close("APEX_PX is the closed-form 224", Movement.APEX_PX, 224.0, 0.001)
	h.close("APEX_HEROES is 3.5", Movement.APEX_HEROES, 3.5, 0.0001)
	h.close("MIN_JUMP_PX is 77.82", Movement.MIN_JUMP_PX, 77.816, 0.01)
	h.close("MIN_JUMP_HEROES is 1.22", Movement.MIN_JUMP_HEROES, 1.2159, 0.001)
	h.close("RISE_SECONDS is the 0.40s target", Movement.RISE_SECONDS, 0.40, 0.0001)
	h.close("FALL_SECONDS is 0.2439", Movement.FALL_SECONDS, 0.24390, 0.0001)
	h.close("RUN_UP_SECONDS is 0.12", Movement.RUN_UP_SECONDS, 0.12, 0.0001)
	h.close("GAP_REACH_PX is 206.05", Movement.GAP_REACH_PX, 206.049, 0.05)
	h.close("ROCK_SLIDE_PX is 17.06", Movement.ROCK_SLIDE_PX, 17.062, 0.01)
	# A whole number of diamond-heights, which is only true at this HERO_H — the
	# reason 64 was chosen over the 66 the art actually reaches.
	h.close(
		"the jump is exactly 7 diamond-heights",
		Movement.JUMP_HEIGHT_PX / Iso.TILE_H,
		7.0,
		0.0001,
	)

	# A tap must be meaningfully shorter than a hold, or variable jump height is
	# not doing anything. NOTE the *measured* tap apex sits well above
	# MIN_JUMP_PX: the clamp fires on the frame after release, so the hero keeps
	# one frame of unclamped rise. This check is on the closed form; the measured
	# floor belongs to the feel harness.
	h.check(
		"min hop is under 60% of full jump",
		Movement.MIN_JUMP_PX < 0.6 * Movement.APEX_PX,
		"%.1f / %.1f px" % [Movement.MIN_JUMP_PX, Movement.APEX_PX],
	)

	# --- the continuous-vs-discrete gap ------------------------------------
	# The engine only reaches ~96% of the closed-form apex. This is asserted rather
	# than assumed, and the number is simulated from the constants, so it cannot
	# drift away from them.
	var measured := Movement.simulate_apex_px(60.0)
	h.close("measured apex at 60Hz is 214.7px", measured, 214.667, 0.5)
	h.close(
		"the discrete gap is 95.8% of closed form",
		measured / Movement.APEX_PX,
		0.95833,
		0.001,
	)
	h.check(
		"the measured apex is BELOW the design target (never fudge the constant)",
		measured < Movement.APEX_PX,
		"%.1f < %.1f px" % [measured, Movement.APEX_PX],
	)
