## Builds a SpriteFrames from the registered strips, one animation per strip.
##
## Extracted from the lab so the lab and the hero cannot disagree about what the art is.
## Two copies of this would be two chances to read a different layout, and the failure
## would be a hero whose animations silently did not play.
##
## Built at RUNTIME rather than saved as a `.tres`, deliberately. A SpriteFrames built by
## a tool script would reference textures the tool had only just written, and without an
## `--import` pass in between Godot embeds them inline — measured elsewhere in this
## project at 351KB against 566 bytes for the same asset. Reading bytes sidesteps the
## ordering entirely, and it means re-running the art build and the game back to back
## just works.

class_name BearFrames
extends RefCounted

const ALPHA_STEP := 4


## Every strip in `dir`, as animations named `<clip>-<facing>`.
##
## `warn` is a Callable taking a String, or null: the lab prints to the console because a
## human is reading it, the hero pushes a warning because nobody is.
static func build(dir: String, warn: Variant = null) -> SpriteFrames:
	var layout := _read_json("%s/layout.json" % dir)
	if layout.is_empty():
		_report(warn, "no %s/layout.json — run tools/build_bear.gd first" % dir)
		return null

	var fw := int(layout["frame_w"])
	var fh := int(layout["frame_h"])
	var frames := SpriteFrames.new()
	frames.remove_animation("default")

	for entry in layout.get("strips", []):
		var anim: String = entry["name"]
		var path := "%s/%s.png" % [dir, anim]
		var bytes := FileAccess.get_file_as_bytes(path)
		if bytes.is_empty():
			_report(warn, "missing or unreadable strip %s" % path)
			continue
		var img := Image.new()
		if img.load_png_from_buffer(bytes) != OK:
			_report(warn, "%s is not a readable PNG" % path)
			continue
		var tex := ImageTexture.create_from_image(img)

		# The strip must be a whole number of frames wide, or the last frame is cut and
		# the animation silently loses its tail.
		var count := int(img.get_width()) / fw
		if int(img.get_width()) % fw != 0 or count != int(entry["frames"]):
			_report(warn, "%s is %dpx wide, not %d frames of %d" % [
				anim, img.get_width(), entry["frames"], fw
			])
		frames.add_animation(anim)
		frames.set_animation_speed(anim, float(entry["fps"]))
		frames.set_animation_loop(anim, bool(entry["loop"]))
		for i in count:
			var at := AtlasTexture.new()
			at.atlas = tex
			at.region = Rect2(i * fw, 0, fw, fh)
			frames.add_frame(anim, at)

	if frames.get_animation_names().is_empty():
		_report(warn, "no strips under %s" % dir)
		return null
	return frames


static func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	return parsed if parsed is Dictionary else {}


static func _report(warn: Variant, message: String) -> void:
	if warn is Callable:
		(warn as Callable).call(message)
	else:
		push_warning("bear frames: %s" % message)
