## A static lab for looking at the bear.
##
## An isometric grid, the bear standing on it, and nothing else — no physics, no
## collision, no camera follow. The point is to judge the ART in the projection it
## will actually be drawn in, which no sprite sheet can show you: a 3/4 view that
## reads well flat can read badly once it is standing on a diamond, and the only way
## to find that out is to look.
##
## Deliberately NOT the game. There is no `Hero` here, no `Movement`, and the grid is
## a drawn placeholder rather than a TileSet. A lab that shares code with the thing it
## is testing cannot tell you whether the thing being tested is wrong.
##
## CONTROLS
##   A / D       previous / next animation
##   Q / E       previous / next direction
##   W / S       previous / next frame (this also pauses)
##   Space       play / pause
##   arrows      move the camera — this is the stretch-mode A/B, since a diamond edge
##               crossing a moving camera is where resampling shows
##   F12         write a PNG of the viewport and print where it went
##
## SCRIPTED CAPTURE
##   godot --path godot res://scenes/bear_lab.tscn -- --capture=/tmp/lab.png --frames=12
##   Renders that many frames, writes the PNG, and quits — so the scene can be checked
##   without a human watching it.

extends Node2D

const IsoGrid := preload("res://scripts/scenes/iso_grid.gd")

const STRIP_DIR := "res://art/bear"
const LAYOUT_PATH := "res://art/bear/layout.json"

const CAMERA_STEP := 800.0

var _bear: AnimatedSprite2D
var _camera: Camera2D

var _frame_counts: Dictionary = {}
var _anim_names: PackedStringArray = []
var _anim_index := 0
var _paused := false

var _frame_w := 68.0
var _frame_h := 136.0

## Set from the command line for scripted capture.
var _capture_path := ""
var _capture_frames := 8
var _frames_seen := 0


func _ready() -> void:
	# FIRST, before anything that can bail out. The first version of this had the
	# cmdline parse after the missing-art early return, so a capture that ran without
	# art never armed itself and the window sat open until an external timeout — a
	# scene that renders fine and appears hung.
	_parse_cmdline()

	_camera = $Camera2D
	_bear = $Bear

	var frames := _build_frames()
	if frames != null:
		_bear.sprite_frames = frames

		# Origin at the FEET, matching the hero scene's convention. An AnimatedSprite2D
		# defaults to a CENTRED origin, so without this the bear sorts by its middle
		# instead of by where it meets the ground — and under `y_sort_enabled` that is
		# the difference between standing on a tile and being painted underneath it.
		# That is exactly what happened on the first run: the bear was invisible.
		_bear.offset = Vector2(0.0, -_frame_h / 2.0)
		_bear.position = IsoGrid.stand_point(IsoGrid.RAISED_CELL)
		_camera.position = _bear.position

		_play_current()
		_report()


func _parse_cmdline() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--capture="):
			_capture_path = arg.trim_prefix("--capture=")
		elif arg.begins_with("--frames="):
			_capture_frames = int(arg.trim_prefix("--frames="))


# --- art -------------------------------------------------------------------

func _read_layout() -> Dictionary:
	if not FileAccess.file_exists(LAYOUT_PATH):
		return {}
	var f := FileAccess.open(LAYOUT_PATH, FileAccess.READ)
	if f == null:
		return {}
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	return parsed if parsed is Dictionary else {}


## Built at runtime rather than saved as a `.tres`, and that is a deliberate shortcut
## for the lab: a SpriteFrames built in a tool script would reference textures that
## the tool had only just written, and without an `--import` pass in between, Godot
## embeds them inline — measured elsewhere at 351KB against 566 bytes for the same
## asset. Reading bytes at runtime sidesteps the ordering entirely, and it also means
## re-running `build_bear.gd` and the lab back to back just works.
func _build_frames() -> SpriteFrames:
	var layout := _read_layout()
	if layout.is_empty():
		push_warning(
			"bear lab: no %s — run `godot --headless --path godot --script res://tools/build_bear.gd` first"
			% LAYOUT_PATH
		)
		return null

	_frame_w = float(layout.get("frame_w", _frame_w))
	_frame_h = float(layout.get("frame_h", _frame_h))
	var fw := int(_frame_w)
	var fh := int(_frame_h)

	var frames := SpriteFrames.new()
	frames.remove_animation("default")

	for entry in layout.get("strips", []):
		var anim: String = entry["name"]
		var path := "%s/%s.png" % [STRIP_DIR, anim]
		var bytes := FileAccess.get_file_as_bytes(path)
		if bytes.is_empty():
			push_warning("bear lab: missing or unreadable strip %s" % path)
			continue
		var img := Image.new()
		if img.load_png_from_buffer(bytes) != OK:
			push_warning("bear lab: %s is not a readable PNG" % path)
			continue
		var tex := ImageTexture.create_from_image(img)

		# The strip must be a whole number of frames wide, or the last frame would be
		# cut and the animation would silently lose its tail.
		var count := int(img.get_width()) / fw
		if int(img.get_width()) % fw != 0 or count != int(entry["frames"]):
			push_warning(
				"bear lab: %s is %dpx wide, not %d frames of %d"
				% [anim, img.get_width(), entry["frames"], fw]
			)
		frames.add_animation(anim)
		frames.set_animation_speed(anim, float(entry["fps"]))
		frames.set_animation_loop(anim, bool(entry["loop"]))
		for i in count:
			var at := AtlasTexture.new()
			at.atlas = tex
			at.region = Rect2(i * fw, 0, fw, fh)
			frames.add_frame(anim, at)
		_anim_names.append(anim)
		_frame_counts[anim] = count

	if _anim_names.is_empty():
		push_warning("bear lab: layout listed no strips that exist on disk")
		return null
	return frames


## Printed on every run. The first version of this scene could not say why nothing
## was on screen, which is not a state a lab should ever be in.
func _report() -> void:
	var anim := _bear.animation
	var count := 0
	var size := Vector2.ZERO
	if _bear.sprite_frames != null and _bear.sprite_frames.has_animation(anim):
		count = _bear.sprite_frames.get_frame_count(anim)
		var t := _bear.sprite_frames.get_frame_texture(anim, 0)
		if t != null:
			size = t.get_size()
	print("  bear   pos %s  offset %s" % [_bear.position, _bear.offset])
	print(
		"  strip  '%s'  %d frames  frame texture %s  visible %s"
		% [anim, count, size, _bear.is_visible_in_tree()]
	)
	print("  camera %s   viewport %s" % [_camera.position, get_viewport_rect().size])


# --- controls --------------------------------------------------------------

func _play_current() -> void:
	if _anim_names.is_empty():
		return
	var anim := _anim_names[_anim_index]
	_bear.play(anim)
	_paused = false
	print(
		"  play   %-22s %d frames @ %.0f fps"
		% [anim, _bear.sprite_frames.get_frame_count(anim), _bear.sprite_frames.get_animation_speed(anim)]
	)


func _cycle_anim(step: int) -> void:
	if _anim_names.is_empty():
		return
	_anim_index = wrapi(_anim_index + step, 0, _anim_names.size())
	_play_current()


## Animation names are "clip-direction". Cycling the DIRECTION keeps the clip and steps
## the facing, which is what you want to look at — cycling the whole list would walk
## through every clip of one direction first.
func _cycle_dir(step: int) -> void:
	if _anim_names.is_empty():
		return
	var clip := _anim_names[_anim_index].split("-")[0]
	var same_clip: Array[int] = []
	for i in _anim_names.size():
		if _anim_names[i].begins_with(clip + "-"):
			same_clip.append(i)
	if same_clip.size() <= 1:
		return
	_anim_index = same_clip[wrapi(same_clip.find(_anim_index) + step, 0, same_clip.size())]
	_play_current()


func _step_frame(step: int) -> void:
	if _anim_names.is_empty():
		return
	_bear.pause()
	_paused = true
	var anim := _anim_names[_anim_index]
	var count := int(_frame_counts.get(anim, 1))
	_bear.frame = wrapi(_bear.frame + step, 0, count)
	print("  step   %s frame %d/%d" % [anim, _bear.frame + 1, count])


func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey) or not event.is_pressed() or event.is_echo():
		return
	match (event as InputEventKey).physical_keycode:
		KEY_A: _cycle_anim(-1)
		KEY_D: _cycle_anim(1)
		KEY_Q: _cycle_dir(-1)
		KEY_E: _cycle_dir(1)
		KEY_W: _step_frame(-1)
		KEY_S: _step_frame(1)
		KEY_SPACE:
			if _paused:
				_play_current()
			else:
				_bear.pause()
				_paused = true
		KEY_F12: _capture("user://bear_lab.png")


func _process(delta: float) -> void:
	var move := Vector2.ZERO
	if Input.is_key_pressed(KEY_LEFT):
		move.x -= 1.0
	if Input.is_key_pressed(KEY_RIGHT):
		move.x += 1.0
	if Input.is_key_pressed(KEY_UP):
		move.y -= 1.0
	if Input.is_key_pressed(KEY_DOWN):
		move.y += 1.0
	if move != Vector2.ZERO:
		_camera.position += move * CAMERA_STEP * delta

	if _capture_path != "":
		_frames_seen += 1
		if _frames_seen >= _capture_frames:
			# Clear the path BEFORE awaiting. `_capture` is a coroutine — it suspends on
			# `frame_post_draw` — so quitting without awaiting it would exit before the
			# image was ever read, and clearing the path first stops the next `_process`
			# tick from starting a second capture while this one waits.
			var path := _capture_path
			_capture_path = ""
			await _capture(path)
			get_tree().quit(0)


func _capture(path: String) -> void:
	# Must wait for the frame to actually be drawn; capturing immediately yields the
	# previous frame or an empty one.
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(path)
	print("  capture -> %s (%s)" % [path, error_string(err)])
