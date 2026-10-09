## The game. Loads a level, builds it, draws it, spawns the hero, follows with a camera.
##
## This is the seam the whole port was aiming at: the level's text becomes a height field,
## the height field becomes collision AND geometry from one description, and the character
## moves on it with the movement model that the probe graded.
##
## THE CAMERA ROUNDS ITS OWN POSITION rather than rounding each object. Snap every object
## independently and two items at 100.4 and 101.6 become 100 and 102 — a two-pixel gap
## where 1.2 belonged — so things visibly shuffle against each other as the view moves.
## Round the camera instead and the whole world moves rigidly: relative spacing is exact,
## and the scroll quantises cleanly. This is what the side-view build's `roundPixels` was
## doing, which rounded the camera scroll rather than the objects.

extends Node2D

const LEVEL_PATH := "res://levels/feel-test-01.txt"

## Godot's own smoothing is `pos.lerp(target, 1 - exp(-speed * delta))`. 7.67 is the
## equivalent of the 0.12-per-frame lerp the side-view build used at 60Hz, and it is set
## from that derivation rather than by eye.
const CAMERA_SPEED := 7.67

var built: BuiltLevel
var hero: Hero

var _camera: Camera2D
var _camera_position := Vector2.ZERO

## Scripted capture, the same shape the lab uses, so the scene can be checked without a
## human watching it. While capturing, the hero is driven rather than left standing, so
## the frame shows the character mid-stride on the terrain rather than at rest.
var _capture_path := ""
var _capture_frames := 12
var _frames_seen := 0


func _ready() -> void:
	var source := LevelSource.parse(LEVEL_PATH)
	if source == null:
		push_error("level_scene: could not load %s" % LEVEL_PATH)
		return
	built = BuiltLevel.from_source(source)

	var terrain := IsoTerrain.new()
	terrain.built = built
	add_child(terrain)

	hero = preload("res://scenes/hero.tscn").instantiate()
	hero.field = built.field
	hero.cell_pos = Vector2(built.spawn_cell)
	hero.elevation = built.spawn_height
	add_child(hero)
	hero.place()

	_camera = Camera2D.new()
	# Limits come from the BUILT level, never from literals: a literal drifts the moment
	# the level does, and the failure is a camera that shows the void.
	#
	# The AABB is taken over the level's four CORNERS, not as a span between two of them.
	# A diamond's screen extent is not the difference of its corners — that mistake put the
	# limits at [0,0]..[960,540] for a level spanning x −480..480, so Godot clamped the
	# camera into a box the level was not in and the hero rendered off the left edge.
	var corners := [
		Iso.cell_to_screen(built.bounds.position),
		Iso.cell_to_screen(built.bounds.position + Vector2i(built.bounds.size.x - 1, 0)),
		Iso.cell_to_screen(built.bounds.position + Vector2i(0, built.bounds.size.y - 1)),
		Iso.cell_to_screen(built.bounds.position + built.bounds.size - Vector2i.ONE),
	]
	var min_p: Vector2 = corners[0]
	var max_p: Vector2 = corners[0]
	for corner in corners:
		min_p = min_p.min(corner)
		max_p = max_p.max(corner)
	# The outermost diamonds need their own half-tile, and a tall block needs its skirt
	# plus a screen of sky above it or the camera cannot follow onto a plateau.
	min_p -= Vector2(Iso.HALF_W, Iso.HALF_H + 320.0)
	max_p += Vector2(Iso.HALF_W, Iso.HALF_H + 160.0)
	_camera.limit_left = int(min_p.x)
	_camera.limit_top = int(min_p.y)
	_camera.limit_right = int(max_p.x)
	_camera.limit_bottom = int(max_p.y)
	add_child(_camera)
	_camera_position = hero.global_position
	_camera.global_position = _camera_position.round()
	_camera.make_current()

	print("level_scene: %s — %d cells, spawn %s at %.0f, bounds %s" % [
		source.name, source.cells.size(), str(built.spawn_cell),
		built.spawn_height, str(built.bounds)
	])
	print("  hero at %s, camera limits %s..%s" % [
		str(hero.global_position), str(min_p), str(max_p)
	])

	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--capture="):
			_capture_path = arg.trim_prefix("--capture=")
		elif arg.begins_with("--frames="):
			_capture_frames = int(arg.trim_prefix("--frames="))


func _process(_delta: float) -> void:
	if _capture_path == "":
		return
	# Walk the hero toward the plateau's wall, so the capture shows it moving on the
	# terrain rather than standing at the spawn.
	if hero != null:
		hero.input_override = {
			"dir": Vector2(-1, 0),
			"jump_down": false,
			"jump_pressed": false,
		}
	_frames_seen += 1
	if _frames_seen == 1:
		print("  capturing %d frames to %s" % [_capture_frames, _capture_path])
	if _frames_seen >= _capture_frames:
		var path := _capture_path
		_capture_path = ""
		await _capture(path)
		get_tree().quit(0)


func _capture(path: String) -> void:
	# `process_frame` rather than `frame_post_draw`. The latter is emitted by the
	# RENDERING server, so it does not fire when the window is not being composited — an
	# occluded or off-screen window leaves the await never resuming and the process
	# running forever with an empty log, which is exactly what the first run of this did.
	await get_tree().process_frame
	await get_tree().process_frame
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(path)
	print("  capture -> %s (%s)" % [path, error_string(err)])


func _physics_process(delta: float) -> void:
	if hero == null or _camera == null:
		return
	# Frame the character's middle rather than its feet, so the view is not all ground.
	var target := hero.global_position + Vector2(0.0, -Movement.HERO_H * 0.4)
	_camera_position = _camera_position.lerp(target, 1.0 - exp(-CAMERA_SPEED * delta))
	_camera.global_position = _camera_position.round()
