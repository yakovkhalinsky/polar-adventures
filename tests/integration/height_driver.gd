## Drives the height-field mover through the measurements that decide whether the model
## is viable at all, and reports them.
##
## The four-way movement decision makes this the architecture gate rather than a detail:
## if the height field cannot carry the movement, the whole four-way direction is in
## question, and better to find that out here than after the character is rewritten.
##
## THE CHECKS, and why each one is here:
##
##   walk +u moves RIGHT AND DOWN on screen
##       The defining property of the model, and the reason it exists. In a 2:1 diamond
##       one lattice step is right and down; a screen-space model cannot have a walkable
##       floor for the same reason.
##
##   the jump apex still measures the ported number in screen pixels
##       The integrator is unchanged — same asymmetric gravity, same fixed step, same
##       stateless clamp — so the apex must still come out at the value
##       `Movement.simulate_apex_px` predicts. If it does not, the constants no longer
##       survive the projection and the port is not a port.
##
##   a low step is walked up, and its height is exact
##       Not approximately: the character rises by exactly the step's height, because
##       the height field stores pixels.
##
##   a step too high is a WALL, and the move is refused
##       The height field has no walls in it. Without this rule "the ground is above me"
##       and "the ground is a cliff above me" are the same test, and the character walks
##       up anything.
##
##   walking off a terrace falls to the ground below
##       Gravity is on the height axis, so leaving a raised cell means falling — which is
##       the behaviour a platformer needs and a purely topological model would not give.

extends Node

const Harness := preload("res://tests/harness.gd")

var mover: HeightMover
var _h: RefCounted
var _phases: Array = []
var _index := 0
var _frame := 0
var _acc := {}
var _measured := {}
var _done := false


func setup(harness: RefCounted) -> void:
	_h = harness


func _ready() -> void:
	_build()
	_phases = _build_phases()


func _build() -> void:
	# Outside the table is a HOLE, not ground: the probe's level is finite and falling
	# off it should be a fall.
	var field := HeightField.new(false)
	field.fill_rect(Vector2i(0, 0), Vector2i(11, 11), 0.0)
	field.fill_rect(Vector2i(6, 0), Vector2i(11, 11), 32.0)  # a terrace, too high to climb
	field.fill_rect(Vector2i(0, 6), Vector2i(3, 8), 8.0)  # a step, low enough to walk up

	mover = HeightMover.new()
	mover.field = field
	mover.cell_pos = Vector2(2.0, 2.0)
	mover.elevation = 0.0
	add_child(mover)


func _build_phases() -> Array:
	return [
		{"name": "settle", "frames": 40, "place": Vector2(2, 2), "height": 0.0},
		# Thirty frames at up to ~8.9 cells/s is about two cells, so it never reaches the
		# terrace at u=6 and the measurement is pure walking.
		{"name": "walk_u", "frames": 30, "place": Vector2(2, 2), "height": 0.0, "dir": Vector2(1, 0)},
		{"name": "jump", "frames": 110, "place": Vector2(2, 2), "height": 0.0, "jump": true},
		{"name": "settle2", "frames": 50, "place": Vector2(2, 2), "height": 0.0},
		# +v heads for the 8-high step at v=6.
		{"name": "step_up", "frames": 34, "place": Vector2(1, 4), "height": 0.0, "dir": Vector2(0, 1)},
		# +u heads for the 32-high terrace at u=6. A cliff is not a step.
		{"name": "wall", "frames": 70, "place": Vector2(4, 2), "height": 0.0, "dir": Vector2(1, 0)},
		# -u walks off the terrace's low edge at u=6.
		{"name": "fall", "frames": 40, "place": Vector2(6, 2), "height": 32.0, "dir": Vector2(-1, 0)},
	]


func _physics_process(_delta: float) -> void:
	if _done:
		return
	if _index >= _phases.size():
		_finish()
		return

	var phase: Dictionary = _phases[_index]
	var name: String = phase["name"]

	if _frame == 0:
		mover.cell_pos = phase["place"]
		mover.elevation = float(phase["height"])
		mover.vel_uv = Vector2.ZERO
		mover.vel_height = 0.0
		mover.place()
		_acc = {
			"start_u": mover.cell_pos.x,
			"start_elev": mover.elevation,
			"start_screen": mover.position,
			"min_elev": mover.elevation,
			"max_elev": mover.elevation,
			"min_screen_y": mover.position.y,
			"blocked": 0,
			"last_elev": mover.elevation,
			"last_u": mover.cell_pos.x,
			"grounded_end": mover.grounded,
		}

	# --- run the tick --------------------------------------------------------
	var dir: Vector2 = phase.get("dir", Vector2.ZERO)
	var jumping: bool = phase.get("jump", false)
	var jump_pressed := jumping and _frame == 1
	mover.tick(1000.0 / 60.0, dir, jumping, jump_pressed)

	# --- measure the state the tick produced ---------------------------------
	_acc["min_elev"] = minf(_acc["min_elev"], mover.elevation)
	_acc["max_elev"] = maxf(_acc["max_elev"], mover.elevation)
	_acc["min_screen_y"] = minf(_acc["min_screen_y"], mover.position.y)
	_acc["last_elev"] = mover.elevation
	_acc["last_u"] = mover.cell_pos.x
	_acc["last_screen"] = mover.position
	_acc["grounded_end"] = mover.grounded
	if mover.was_blocked():
		_acc["blocked"] = int(_acc["blocked"]) + 1

	_frame += 1
	if _frame >= int(phase["frames"]):
		_measured[name] = _acc
		print("  phase %-10s %3d frames  elev %7.2f -> %7.2f   u %5.2f -> %5.2f   blocked %d" % [
			name, _frame, _acc["start_elev"], _acc["last_elev"], _acc["start_u"], _acc["last_u"], _acc["blocked"]
		])
		_index += 1
		_frame = 0


func _finish() -> void:
	_done = true

	var settle: Dictionary = _measured["settle"]
	var walk: Dictionary = _measured["walk_u"]
	var jump: Dictionary = _measured["jump"]
	var step: Dictionary = _measured["step_up"]
	var wall: Dictionary = _measured["wall"]
	var fall: Dictionary = _measured["fall"]

	var walk_dx: float = walk["last_screen"].x - walk["start_screen"].x
	var walk_dy: float = walk["last_screen"].y - walk["start_screen"].y
	# MAX, not min: in this model "up" is positive, which is the opposite of the y-down
	# screen the constants were written for. The first run of this measured the minimum
	# and reported an apex of 0.0 for a jump that had happened.
	var apex: float = jump["max_elev"] - jump["start_elev"]
	var expected_apex := Movement.simulate_apex_px(60.0)
	var step_rise: float = step["max_elev"] - step["start_elev"]
	var wall_moved: float = absf(wall["last_u"] - wall["start_u"])
	var fell: float = fall["start_elev"] - fall["last_elev"]

	print("")
	print("--- measured ---")
	print("  walking +u moved screen (%.1f, %.1f) px" % [walk_dx, walk_dy])
	print("  jump apex %.1f px (the predicted %.1f)" % [apex, expected_apex])
	print("  low step raised it %.1f px (the step is 8)" % step_rise)
	print("  cliff: moved %.2f cells in %d blocked ticks" % [wall_moved, wall["blocked"]])
	print("  fall from the terrace: descended %.1f px, ended at %.1f" % [fell, fall["last_elev"]])

	_h.check(
		"the mover settles grounded at height 0",
		settle["grounded_end"] and absf(settle["last_elev"]) < 0.01,
		"elevation %.3f, grounded %s" % [settle["last_elev"], settle["grounded_end"]],
	)
	# The defining property of the model.
	_h.check(
		"walking along +u moves it right AND down on screen",
		walk_dx > 20.0 and walk_dy > 5.0,
		"screen delta (%.1f, %.1f) px" % [walk_dx, walk_dy],
	)
	# The integrator surviving the projection, which is the whole reason the constants
	# port at all.
	_h.check(
		"the jump apex is the ported number in screen pixels",
		absf(apex - expected_apex) <= 2.0,
		"apex %.1f px against a predicted %.1f" % [apex, expected_apex],
	)
	_h.check(
		"a low step is walked up, by exactly its height",
		absf(step_rise - 8.0) < 0.01,
		"rose %.2f px (grounded %s)" % [step_rise, step["grounded_end"]],
	)
	# The lookahead is half a cell, so the mover stops half a cell short of the wall
	# rather than at it — "moved less than two cells" is the assertion, not "did not
	# move", because stopping exactly at the wall would mean walking into it first.
	_h.check(
		"a cliff is a wall, not a step",
		wall_moved < 2.0 and int(wall["blocked"]) > 0,
		"moved %.2f cells, %d blocked ticks" % [wall_moved, wall["blocked"]],
	)
	_h.check(
		"walking off a terrace falls to the ground below",
		fell > 30.0 and absf(fall["last_elev"]) < 0.01,
		"descended %.1f px and landed at %.2f" % [fell, fall["last_elev"]],
	)

	get_tree().quit(_h.report("height field"))
