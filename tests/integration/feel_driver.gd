## Drives the hero through a fixed script of segments and measures what happens.
##
## The SAME numbers the side-view build asserted, and that is the point: the height-field
## model is a port of the movement, not a rewrite of it, so the acceptance criterion is
## that these measurements do not move. Apex, top speed and slide distance are all in
## screen pixels, so they are directly comparable to the values the Phaser build measured.
##
## Input is fed through `hero.input_override`, not synthesised InputEvents, so every
## measurement is independent of the input system and of Godot's event dispatch order.
##
## The hero is added BEFORE this driver, so in each physics frame it has already moved by
## the time we measure. Input set here therefore lands on the next frame — a constant
## one-frame lag, which does not matter for an apex or a top speed, and is stated so
## nobody later reads a frame number as exact.

extends Node

const HERO_SCENE := preload("res://scenes/hero.tscn")

var hero: Hero
var _h: RefCounted
var _segments: Array = []
var _index := 0
var _frame := 0
var _acc: Dictionary = {}
var _measured: Dictionary = {}
var _done := false


func setup(harness: RefCounted) -> void:
	_h = harness


func _ready() -> void:
	_build_world()
	_segments = _build_segments()


func _build_world() -> void:
	# Flat ground, big enough that a full run never reaches its edge. An edge would be a
	# hole in the height field, and the hero would fall off the world mid-measurement.
	var field := HeightField.new(false)
	field.fill_rect(Vector2i(-8, -8), Vector2i(40, 40), 0.0)

	hero = HERO_SCENE.instantiate()
	hero.field = field
	hero.cell_pos = Vector2(0.0, 0.0)
	hero.elevation = 0.0
	add_child(hero)
	hero.place()


func _build_segments() -> Array:
	# Durations in 60Hz frames, carried over from the side-view harness so the numbers
	# stay comparable.
	return [
		{"name": "settle", "frames": 150, "settle_window": 60},
		{"name": "full_jump", "frames": 90, "jump_down": true, "jump_pressed": true},
		{"name": "settle2", "frames": 120, "settle_window": 60},
		{"name": "tap_jump", "frames": 90, "jump_down_frames": 1, "jump_pressed": true},
		{"name": "settle3", "frames": 120, "settle_window": 60},
		# One lattice axis, which is the only kind of direction this model moves along.
		{"name": "run", "frames": 120, "dir": Vector2(1, 0)},
		{"name": "release", "until_still": true, "frames": 400},
	]


func _physics_process(_delta: float) -> void:
	if _done:
		return
	if _index >= _segments.size():
		_finish()
		return

	var seg: Dictionary = _segments[_index]
	var name: String = seg["name"]
	var step := HeightMover.screen_per_cell()

	if _frame == 0:
		_acc = {
			"start_elev": hero.elevation,
			"min_elev": hero.elevation,
			"max_elev": hero.elevation,
			"start_screen": hero.position,
			"max_speed": 0.0,
			"last_speed": 0.0,
			"settle_started": false,
			"settle_min_y": 0.0,
			"settle_max_y": 0.0,
			"settle_frames": int(seg.get("settle_window", 0)),
		}

	# --- measure the state the hero produced for THIS frame -------------------
	_acc["min_elev"] = minf(_acc["min_elev"], hero.elevation)
	_acc["max_elev"] = maxf(_acc["max_elev"], hero.elevation)
	var speed := hero.vel_uv.length() * step
	_acc["max_speed"] = maxf(_acc["max_speed"], speed)
	_acc["last_speed"] = speed
	_acc["last_screen"] = hero.position

	# The settle window is the LAST N frames of the segment, initialised lazily on its
	# first frame — seeding it at frame 0 pinned the minimum to the spawn height and
	# reported a "standing wobble" that never happened.
	var settle_window: int = seg.get("settle_window", 0)
	if settle_window > 0 and _frame >= int(seg["frames"]) - settle_window:
		if not _acc["settle_started"]:
			_acc["settle_started"] = true
			_acc["settle_min_y"] = hero.elevation
			_acc["settle_max_y"] = hero.elevation
		_acc["settle_min_y"] = minf(_acc["settle_min_y"], hero.elevation)
		_acc["settle_max_y"] = maxf(_acc["settle_max_y"], hero.elevation)

	# --- set the NEXT frame's input ------------------------------------------
	_frame += 1
	var dir: Vector2 = seg.get("dir", Vector2.ZERO)
	var jump_down: bool
	if seg.has("jump_down_frames"):
		jump_down = _frame <= int(seg["jump_down_frames"])
	else:
		jump_down = bool(seg.get("jump_down", false))
	hero.input_override = {
		"dir": dir,
		"jump_down": jump_down,
		"jump_pressed": _frame == 1 and bool(seg.get("jump_pressed", false)),
	}

	var finished := _frame >= int(seg["frames"])
	if seg.get("until_still", false) and _frame > 2 and speed < 0.5:
		finished = true

	if finished:
		_acc["end_screen"] = hero.position
		_measured[name] = _acc
		print("  segment %-10s %3d frames   elev %7.2f..%7.2f   max speed %6.1f" % [
			name, _frame, _acc["min_elev"], _acc["max_elev"], _acc["max_speed"]
		])
		_index += 1
		_frame = 0


func _finish() -> void:
	_done = true

	var full: Dictionary = _measured["full_jump"]
	var tap: Dictionary = _measured["tap_jump"]
	var run: Dictionary = _measured["run"]
	var release: Dictionary = _measured["release"]
	var settle: Dictionary = _measured["settle"]

	# Up is positive in this model, so the apex is a maximum — the opposite of the
	# y-down screen the constants were first written for.
	var full_apex: float = full["max_elev"] - full["start_elev"]
	var tap_apex: float = tap["max_elev"] - tap["start_elev"]
	var settle_range: float = settle["settle_max_y"] - settle["settle_min_y"]
	var slide: float = (release["end_screen"] as Vector2).distance_to(release["start_screen"])

	print("")
	print("--- measured ---")
	print("  full jump apex      %.1f px  (%.2f hero-heights)" % [
		full_apex, full_apex / Movement.HERO_H
	])
	print("  tap jump apex       %.1f px  (%.2f hero-heights)" % [
		tap_apex, tap_apex / Movement.HERO_H
	])
	print("  standing y range    %.3f px" % settle_range)
	print("  max speed           %.1f px/s" % run["max_speed"])
	print("  slide after release %.1f px, final speed %.3f" % [slide, release["last_speed"]])

	var apex_target := Movement.APEX_PX
	var apex_tolerance := 0.055 * apex_target

	_h.check(
		"held jump apex is ~%.0fpx (%.1f hero-heights)"
		% [apex_target, Movement.JUMP_HEIGHT_HEROES],
		absf(full_apex - apex_target) <= apex_tolerance,
		"apex %.1f px (%.2f hero-heights)" % [full_apex, full_apex / Movement.HERO_H],
	)
	_h.check(
		"tap jump clears the closed-form floor (%.0fpx)" % Movement.MIN_JUMP_PX,
		tap_apex >= Movement.MIN_JUMP_PX,
		"apex %.1f px (%.2f hero-heights)" % [tap_apex, tap_apex / Movement.HERO_H],
	)
	_h.check(
		"tap is strictly shorter than held, by at least 9% of the jump",
		tap_apex < full_apex - 0.09 * apex_target,
		"tap %.1f vs held %.1f px" % [tap_apex, full_apex],
	)
	_h.check(
		"standing still: height is stable",
		settle_range < 1.0,
		"height range %.3f px over the last %d frames" % [
			settle_range, settle["settle_frames"]
		],
	)
	_h.check(
		"run reaches max speed %.0fpx/s" % Movement.MAX_RUN_SPEED,
		absf(run["max_speed"] - Movement.MAX_RUN_SPEED) <= 2.0,
		"max speed %.1f px/s" % run["max_speed"],
	)
	# A relationship, not an exact distance, so the drag constant can be retuned by feel
	# without the suite fighting back.
	_h.check(
		"ground friction stops crisply (under one hero-height)",
		slide < Movement.HERO_H and release["last_speed"] < 0.5,
		"slid %.1f px, final speed %.3f" % [slide, release["last_speed"]],
	)

	get_tree().quit(_h.report("feel"))
