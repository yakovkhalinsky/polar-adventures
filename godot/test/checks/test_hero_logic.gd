## Checks on the movement LOGIC, as pure functions.
##
## Split out from the feel harness on purpose. The harness measures numbers a real physics
## world produced; this file asserts rules that need no world at all.
##
## The distinction is not academic. The "is_turning is decided before grounded" rule was
## first tested by measuring a frame of a real mid-air jump, and it failed — not because
## the rule was broken, but because the frame sampled was one too late and the turn had
## already completed. A pure test cannot have that failure mode.
##
## These moved to `HeightMover` with the height-field rewrite, and that is where they
## belong: the rule is the model's, not the character's, and the probe grades the same
## model the game runs.

extends RefCounted

func run(h) -> void:
	# --- which acceleration applies ----------------------------------------
	h.close(
		"grounded, not turning -> GROUND_ACCEL",
		HeightMover.accel_for(true, false),
		Movement.GROUND_ACCEL,
		0.001,
	)
	h.close(
		"airborne, not turning -> AIR_ACCEL",
		HeightMover.accel_for(false, false),
		Movement.AIR_ACCEL,
		0.001,
	)
	h.close(
		"grounded, turning -> TURN_ACCEL",
		HeightMover.accel_for(true, true),
		Movement.TURN_ACCEL,
		0.001,
	)
	# The quirk, and the reason this file exists: a mid-air turn uses TURN_ACCEL, NOT
	# AIR_ACCEL. The two are far enough apart that this cannot pass by accident.
	h.close(
		"airborne AND turning -> TURN_ACCEL, not AIR_ACCEL",
		HeightMover.accel_for(false, true),
		Movement.TURN_ACCEL,
		0.001,
	)
	h.check(
		"the two constants are far enough apart to tell apart",
		Movement.TURN_ACCEL / Movement.AIR_ACCEL > 3.0,
		"%.2fx apart" % (Movement.TURN_ACCEL / Movement.AIR_ACCEL),
	)

	# --- when a turn counts as a turn -------------------------------------
	# On a lattice the direction of travel is a vector, so "opposes" is a negative dot
	# product. Every one of the four axes has to work, not just the two the side-view
	# build had.
	h.eq(
		"standing still is not a turn",
		HeightMover.turning(Vector2(1, 0), Vector2.ZERO),
		false,
	)
	h.eq(
		"moving with the input is not a turn",
		HeightMover.turning(Vector2(1, 0), Vector2(1, 0)),
		false,
	)
	h.eq(
		"moving against the input IS a turn",
		HeightMover.turning(Vector2(-1, 0), Vector2(1, 0)),
		true,
	)
	h.eq(
		"and on the other lattice axis too",
		HeightMover.turning(Vector2(0, -1), Vector2(0, 1)),
		true,
	)
	# Perpendicular is NOT a turn: crossing an axis is steering, not reversing, and
	# treating it as a turn would make every direction change snappy.
	h.eq(
		"crossing to the other axis is not a turn",
		HeightMover.turning(Vector2(0, 1), Vector2(1, 0)),
		false,
	)
	h.eq(
		"a tiny residual velocity is not a turn",
		HeightMover.turning(Vector2(-1, 0), Vector2(0.0001, 0)),
		false,
	)
