## Registers the bear's frames and composes one strip per (clip, direction).
##
##   godot --headless --path godot --script res://tools/build_bear.gd
##
## WHY REGISTRATION IS NOT OPTIONAL
##
## The model places each frame independently. Measured on the idle alone: the feet
## move 4px vertically across the four frames (a "breathing" template animates the
## whole body, not just the chest), and horizontally the body drifts 5px between
## directions and up to 8px across them. Drawn unregistered, the bear bobs as it
## stands still and shuffles sideways as it turns.
##
## The recipe is the one the Phaser build arrived at for its generated poses, and it
## is translation rather than cropping for the same reason: a fixed window leaves the
## feet floating, because the drift is different per frame.
##
##   * the LOWEST opaque row of each frame goes to a common ground row
##   * the opaque bbox's CENTRE X goes to a common centre column
##
## A frame that would not fit is a FAILURE, named, not a clipped leg in the game.
##
## No ImageMagick and no import step: frames are read with FileAccess +
## Image.load_png_from_buffer, so the import cache never enters into it.

extends SceneTree

const SRC_ROOT := "res://art/source/bear"

## Which character the frames belong to, as a one-line text file holding a directory
## name under SRC_ROOT (conventionally `<name>-<first-8-of-id>`, so it is readable as
## well as unique).
##
## The source tree is per-character — `art/source/bear/<dir>/<clip>/<direction>/<n>.png`
## — and this names which one to build. That is not fussiness: with a flat tree,
## downloading a NEW character's frames over an old one's leaves the old frames that
## the new set did not overwrite, and if the new run has fewer frames than the old,
## stale ones survive into the strip and the bear changes character part-way through
## its own cycle. A per-character directory makes that impossible rather than
## something to remember.
const CURRENT := "res://art/source/bear/CURRENT"

const OUT_ROOT := "res://art/bear"
const LAYOUT := "res://art/bear/layout.json"

## Playback per clip, carried from the Phaser build's STATES table. Note the fastest
## is `land` at 14fps — 71ms, comfortably above the ~30ms below which Godot 4.7 has a
## reported frame-skipping bug. Worth knowing the margin is only 2x.
##
## `airborne` and `drop_first` are not playback settings; they decide how the frames
## are registered and which of them are the animation at all. Both are per-clip
## because a single rule for all clips is wrong for at least one of them.
const CLIPS := {
	"idle": {"fps": 6.0, "loop": true},
	"run": {"fps": 12.0, "loop": true},
	# AIRBORNE: registered with ONE translation for the whole clip. See _compose —
	# planting each frame would clamp the leap back onto the floor on exactly the
	# frames where the bear is highest, deleting the jump, which is the whole
	# animation. A `jumping-1` template clip carries no reference frame.
	"jump": {"fps": 8.0, "loop": false, "airborne": true},
	# AIRBORNE, and `drop_first`: a v3 clip stores the input reference frame as frame
	# 0 — it is the standing pose the model was GIVEN, not part of the motion, and
	# leaving it in shows a standing frame in the middle of a fall.
	"fall": {"fps": 6.0, "loop": true, "airborne": true, "drop_first": true},
	# Grounded again: the impact crouch happens on the floor, so it plants per frame
	# like idle and run do.
	"land": {"fps": 14.0, "loop": false, "drop_first": true},
}

## Any alpha above this counts as part of the character. Deliberately near zero:
## antialiased edges are still the character, and a threshold that clips them would
## shave a pixel off the silhouette on every frame.
const ALPHA_EPS := 0.01

## The same threshold as an 8-bit alpha byte, which is the form the scanners use.
const ALPHA_BYTE := 2

## Margin around the frame, so a registered frame never touches the edge.
const MARGIN := 2

# --- palette repair ---------------------------------------------------------
#
# The model sometimes fills a limb on the far side with the OUTLINE's near-black
# instead of a fur tone, so the limb and its outline are one flat colour and it
# reads as a hole punched through the character. Measured on the south-west idle
# against south-east: 623 more near-black pixels (luma 5) and 554 fewer mid-olive
# ones (luma 145) — a near-exact trade, which is what makes it a fill error rather
# than extra shading.
#
# The repair recolours the INTERIOR of any near-black region thicker than
# BULK_RADIUS and leaves a one-pixel rim. The rim is the point: the limb comes back
# as an outlined fur-coloured leg, which is what the other directions already look
# like, rather than as a flat patch with no edge.
#
# THE GUARD is thickness, not a list of coordinates. A one-pixel outline cannot
# survive a 5x5 solid test, and neither can an eye or a nose at a few pixels
# across, so the outline and the face are untouched by construction. Coordinates
# would have to be re-found for every character and every animation, and would be
# wrong the moment either changed.

## Colours at or below this luma count as "the outline's black".
const NEAR_BLACK_LUMA := 24.0

## Radius of the solid test. 2 means a 5x5 block must be entirely near-black.
const BULK_RADIUS := 2

## The fur tone to repair to must be a tone the artist actually used, not a stray
## antialiasing pixel, so it has to account for a real share of the opaque pixels.
## A share rather than a count, so it holds for a 64px bear as well as a 180px one.
##
## CALIBRATED, and the margin is thin — worth knowing rather than discovering.
## Measured on this bear's idle strips: the small shading tone is 0.8% of opaque
## pixels and the limb tone is 2.3%, so the floor has to sit between those. 1.5%
## does. An earlier 5% silently disabled the whole repair: it demanded 1051 pixels
## and the limb tone has 491, so no target was ever found and nothing was fixed.
##
## A better rule exists and is not implemented: the tone that this DIRECTION has
## less of than its SIBLINGS is the one the limb should be. That is self-calibrating,
## but it needs a cross-direction comparison and at least two good directions.
const REPAIR_MIN_SHARE := 0.015


var _frame_w := 0
var _frame_h := 0
var _problems: PackedStringArray = []
var _src := ""

## Where the strips go. Overridable with `--out=`, because otherwise building a
## candidate character overwrites the strips the lab and the preview page read —
## which makes an A/B between two candidates impossible without shuffling files by
## hand. `--character=` picks the source directory the same way.
var _out := OUT_ROOT


## Quits the process if the build does not finish.
##
## An error inside `_initialize` ABORTS it, and if that happens before `quit()` the
## main loop runs forever with nothing left to stop it. That has now bitten twice in
## this project — here and in the feel harness — and both times it presented as a
## slow test rather than a crash, because the buffered output only flushes on exit.
## A watchdog turns "hangs until an external timeout" into a named failure.
class Watchdog extends Node:
	var budget := 900
	var _frames := 0

	func _process(_delta: float) -> void:
		_frames += 1
		if _frames > budget:
			printerr("build_bear: watchdog tripped — the build did not finish its work")
			get_tree().quit(1)


func _initialize() -> void:
	# Added FIRST, so it is already running if anything below aborts.
	var watchdog := Watchdog.new()
	root.add_child(watchdog)

	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--out="):
			_out = arg.trim_prefix("--out=")
		elif arg.begins_with("--character="):
			_src = "%s/%s" % [SRC_ROOT, arg.trim_prefix("--character=")]

	if _src == "":
		_src = _character_dir()
	if _src == "":
		return
	if not DirAccess.dir_exists_absolute(_src):
		printerr("build_bear: no such character directory: %s" % _src)
		quit(1)
		return
	print("character  %s" % _src.get_file())
	print("output     %s" % _out)
	var directions := _directions()
	if directions.is_empty():
		printerr("build_bear: no frames under %s — download some first" % _src)
		quit(1)
		return

	# --- pass 1: measure every frame, and size the frame around all of them -----
	var measured := {}  # "clip/direction" -> Array of Dictionaries
	var repaired := {}  # "clip/direction" -> pixels the palette repair changed
	var targets := {}  # "clip/direction" -> the tone it repaired to
	var max_w := 0
	var max_h := 0
	for clip in CLIPS:
		for direction in directions:
			var loaded := _load_frames(clip, direction)
			var frames: Array = loaded["frames"]
			if frames.is_empty():
				continue
			measured["%s/%s" % [clip, direction]] = frames
			repaired["%s/%s" % [clip, direction]] = int(loaded["repaired"])
			targets["%s/%s" % [clip, direction]] = loaded["target"]
			for f in frames:
				max_w = maxi(max_w, int(f["w"]))
				max_h = maxi(max_h, int(f["h"]))
			# An AIRBORNE clip is sized by its whole vertical SPAN, not by its tallest
			# frame. The bear travels up through the canvas, so the frame has to hold
			# where the feet reach at the top of the arc, not merely the tallest pose.
			# Sizing it from the tallest frame leaves the top of the leap hanging off
			# the frame — and the fit assertion reports that as "frame N does not fit",
			# which says nothing about the arc being the actual problem.
			if bool((CLIPS[clip] as Dictionary).get("airborne", false)):
				var top := 1 << 30
				var bottom := -1
				for f in frames:
					top = mini(top, int(f["y"]))
					bottom = maxi(bottom, int(f["y"]) + int(f["h"]) - 1)
				max_h = maxi(max_h, bottom - top + 1)
	if measured.is_empty():
		printerr("build_bear: found directories but no frames")
		quit(1)
		return

	# Rounded up to a multiple of 4 so atlas regions land on whole pixels even if a
	# future consumer works in 4px blocks.
	_frame_w = _round_up(max_w + MARGIN * 2, 4)
	_frame_h = _round_up(max_h + MARGIN * 2, 4)

	print("bear frames")
	print("  frame size  %dx%d  (widest frame %d, tallest %d, margin %d)" % [
		_frame_w, _frame_h, max_w, max_h, MARGIN
	])
	print("")
	print("  %-26s %-9s %-11s %-13s %-9s %s" % ["strip", "frames", "bbox", "repaired", "to", "bottom rows"])

	var strips: Array = []
	for clip in CLIPS:
		for direction in directions:
			var key := "%s/%s" % [clip, direction]
			if not measured.has(key):
				continue
			var frames: Array = measured[key]
			var strip := _compose(clip, direction, frames)
			strips.append({
				"name": "%s-%s" % [clip, direction],
				"frames": frames.size(),
				"fps": CLIPS[clip]["fps"],
				"loop": CLIPS[clip]["loop"],
			})
			var bottoms := PackedStringArray()
			for f in frames:
				# `has`, because a frame that did not fit never had `dest_y` set — and
				# assuming it does turns a named fit failure into a crash in the
				# reporting code, which is where the real message gets lost.
				bottoms.append(
					str(int(f["dest_y"]) + int(f["h"]) - 1) if f.has("dest_y") else "?"
				)
			var is_air: bool = bool((CLIPS[clip] as Dictionary).get("airborne", false))
			print("  %-26s %-9d %-11s %-13s %-9s %s" % [
				"%s-%s%s" % [clip, direction, "  AIRBORNE" if is_air else ""],
				frames.size(),
				"%dx%d" % [max_w, max_h],
				"%d px" % int(repaired.get(key, 0)),
				_colour_key(targets.get(key, Color(0, 0, 0, 0))),
				", ".join(bottoms),
			])
			_write_png(strip, "%s/%s-%s.png" % [_out, clip, direction])

	_write_layout(strips)

	print("")
	if _problems.is_empty():
		print("ok — %d strips, all frames fit" % strips.size())
		quit(0)
	else:
		# NOT labelled "clipped": this list also carries unreadable files and write
		# failures, and calling all of those "clipped" sent me looking for a sizing
		# bug that was really a missing output directory.
		for p in _problems:
			printerr("  PROBLEM: %s" % p)
		print("%d problem(s) — see above" % _problems.size())
		quit(1)


# --- reading -----------------------------------------------------------------

func _directions() -> PackedStringArray:
	var out := PackedStringArray()
	var d := DirAccess.open(_src)
	if d == null:
		return out
	for clip in d.get_directories():
		var sub := DirAccess.open("%s/%s" % [_src, clip])
		if sub == null:
			continue
		for direction in sub.get_directories():
			if not out.has(direction):
				out.append(direction)
	out.sort()
	return out


## The directory named by CURRENT, or "" after reporting what to do about it.
func _character_dir() -> String:
	if not FileAccess.file_exists(CURRENT):
		_report_available("no %s naming a character" % CURRENT)
		return ""
	var f := FileAccess.open(CURRENT, FileAccess.READ)
	if f == null:
		_report_available("could not read %s" % CURRENT)
		return ""
	var id := f.get_as_text().strip_edges()
	if id == "":
		_report_available("%s is empty" % CURRENT)
		return ""
	var path := "%s/%s" % [SRC_ROOT, id]
	if not DirAccess.dir_exists_absolute(path):
		_report_available("%s names '%s', which does not exist" % [CURRENT, id])
		return ""
	return path


func _report_available(why: String) -> void:
	printerr("build_bear: %s" % why)
	var d := DirAccess.open(SRC_ROOT)
	var found := PackedStringArray()
	if d != null:
		for sub in d.get_directories():
			found.append(sub)
	if found.is_empty():
		printerr("  there are no character directories under %s yet" % SRC_ROOT)
	else:
		printerr("  characters on disk: %s" % ", ".join(found))
		printerr(
			"  write the one you want into %s, e.g.: echo '%s' > %s"
			% [CURRENT, found[found.size() - 1], CURRENT]
		)
	quit(1)


## Frames for one clip+direction, with the palette repair already applied.
## Returns {"frames": Array, "repaired": int}.
func _load_frames(clip: String, direction: String) -> Dictionary:
	var dir_path := "%s/%s/%s" % [_src, clip, direction]
	if not DirAccess.dir_exists_absolute(dir_path):
		return {"frames": [], "repaired": 0}

	var names := PackedStringArray()
	var d := DirAccess.open(dir_path)
	if d == null:
		return {"frames": [], "repaired": 0}
	for f in d.get_files():
		if f.ends_with(".png"):
			names.append(f)
	names.sort()

	var clip_cfg: Dictionary = CLIPS.get(clip, {})
	if bool(clip_cfg.get("drop_first", false)) and names.size() > 0:
		names.remove_at(0)

	var frames: Array = []
	var repairs := 0
	var repair_target := Color(0, 0, 0, 0)
	for name in names:
		var bytes := FileAccess.get_file_as_bytes("%s/%s" % [dir_path, name])
		if bytes.is_empty():
			_problems.append("%s/%s is unreadable" % [clip, name])
			continue
		var img := Image.new()
		if img.load_png_from_buffer(bytes) != OK:
			_problems.append("%s/%s is not a readable PNG" % [clip, name])
			continue
		# Normalised to RGBA8 so every scanner below can index raw bytes safely.
		# Without this, a PNG with no alpha channel arrives as RGB8 with a 3-byte
		# stride and every byte offset computed later would be silently wrong.
		if img.get_format() != Image.FORMAT_RGBA8:
			img.convert(Image.FORMAT_RGBA8)
		var box := _alpha_bbox(img)
		if box.size == Vector2i.ZERO:
			_problems.append("%s/%s is fully transparent" % [clip, name])
			continue

		# Repair before measuring: a filled limb changes the bounding box, and the
		# bbox is what registration is derived from.
		var target := _repair_target(img)
		if target.a > 0.0:
			repair_target = target
			var result := _repair(img, target)
			img = result["image"]
			repairs += int(result["repaired"])

		frames.append({
			"image": img,
			"x": box.position.x,
			"y": box.position.y,
			"w": box.size.x,
			"h": box.size.y,
		})
	return {"frames": frames, "repaired": repairs, "target": repair_target}


# --- palette repair ---------------------------------------------------------

## For the report only. The scanning code counts under integer keys, not strings:
## an earlier version keyed every pixel by a hex string and that was most of the
## build's cost.
func _colour_key(c: Color) -> String:
	return (
		"%02X%02X%02X"
		% [int(round(c.r * 255.0)), int(round(c.g * 255.0)), int(round(c.b * 255.0))]
	)


## The fur tone to repair a black limb to: the DARKEST colour that is not
## near-black and that accounts for a real share of the picture.
##
## Derived rather than hard-coded, so it adapts to whatever palette a character
## comes back with — and so it cannot silently point at a tone that is no longer in
## the art. Counted under INTEGER keys; an earlier version keyed by a hex string and
## built one `%02X` format per pixel, which was most of the build's cost.
func _repair_target(img: Image) -> Color:
	var w := img.get_width()
	var h := img.get_height()
	var data := img.get_data()

	var counts := {}
	var opaque := 0
	for y in h:
		var row := y * w * ALPHA_STEP
		for x in w:
			var o := row + x * ALPHA_STEP
			if data[o + 3] <= ALPHA_BYTE:
				continue
			opaque += 1
			var key := (int(data[o]) << 16) | (int(data[o + 1]) << 8) | int(data[o + 2])
			counts[key] = int(counts.get(key, 0)) + 1

	if opaque == 0:
		return Color(0, 0, 0, 0)
	var floor_count := int(float(opaque) * REPAIR_MIN_SHARE)

	var best := Color(0, 0, 0, 0)
	var best_luma := 1.0e9
	for key in counts:
		if int(counts[key]) < floor_count:
			continue
		var k: int = key
		var l := (
			float((k >> 16) & 0xFF) * 299.0
			+ float((k >> 8) & 0xFF) * 587.0
			+ float(k & 0xFF) * 114.0
		) / 1000.0
		if l <= NEAR_BLACK_LUMA:
			continue
		if l < best_luma:
			best_luma = l
			best = Color(
				float((k >> 16) & 0xFF) / 255.0,
				float((k >> 8) & 0xFF) / 255.0,
				float(k & 0xFF) / 255.0,
			)

	if best.a == 0.0:
		# Says WHY nothing was chosen rather than silently repairing nothing — which
		# is the failure this whole pass already had once, at a 5% floor.
		var top := PackedStringArray()
		var keys := counts.keys()
		keys.sort_custom(func(a, b) -> bool: return int(counts[a]) > int(counts[b]))
		for i in mini(4, keys.size()):
			top.append("%s=%d" % [_key_hex(int(keys[i])), int(counts[keys[i]])])
		print("    no repair target: opaque %d, floor %d, top by count: %s" % [
			opaque, floor_count, ", ".join(top)
		])
	return best


func _key_hex(key: int) -> String:
	return "%02X%02X%02X" % [(key >> 16) & 0xFF, (key >> 8) & 0xFF, key & 0xFF]


## Recolour the interior of every too-thick near-black region. Returns the repaired
## image and how many pixels changed.
##
## The thickness test runs against a SUMMED-AREA TABLE of the near-black mask, so
## "is this 5x5 block entirely near-black" is four array reads instead of
## twenty-five. That is not premature optimisation: the naive version was 25 lookups
## for every pixel of every frame, and it took the build from seconds to over two
## minutes the moment there were four clips rather than two. The pass is now O(1)
## per pixel regardless of how thick the test is.
func _repair(img: Image, target: Color) -> Dictionary:
	var w := img.get_width()
	var h := img.get_height()

	# The mask and its summed-area table in one pass. `stride` is w+1 because the
	# table carries a zero row and column, which is what lets the block sums be
	# four reads with no edge cases.
	var stride := w + 1
	var data := img.get_data()
	var sat := PackedInt32Array()
	sat.resize(stride * (h + 1))
	for y in h:
		var row := y * w * ALPHA_STEP
		var running := 0
		for x in w:
			running += 1 if _is_near_black_at(data, row + x * ALPHA_STEP) else 0
			sat[(y + 1) * stride + (x + 1)] = sat[y * stride + (x + 1)] + running

	var out := Image.create_empty(w, h, false, img.get_format())
	out.copy_from(img)

	var r := BULK_RADIUS
	var side := 2 * r + 1
	var area := side * side
	var repaired := 0
	for y in range(r, h - r):
		var y0 := y - r
		for x in range(r, w - r):
			var x0 := x - r
			var total := (
				sat[(y0 + side) * stride + (x0 + side)]
				- sat[y0 * stride + (x0 + side)]
				- sat[(y0 + side) * stride + x0]
				+ sat[y0 * stride + x0]
			)
			if total == area:
				out.set_pixel(x, y, target)
				repaired += 1
	return {"image": out, "repaired": repaired}


# --- pixel scanning ---------------------------------------------------------
#
# Everything that walks pixels reads the image's raw RGBA8 bytes rather than
# calling `get_pixel`. `get_pixel` constructs a Color Variant per call, and that is
# the whole cost of the build once there are a hundred frames to scan: measured,
# it was the difference between a build that took seconds and one that took
# minutes. The format conversion on load is what makes the 4-byte stride safe.

const ALPHA_STEP := 4


## Recalculates the alpha bbox from the byte buffer.
func _alpha_bbox(img: Image) -> Rect2i:
	var w := img.get_width()
	var h := img.get_height()
	var data := img.get_data()
	var min_x := w
	var min_y := h
	var max_x := -1
	var max_y := -1
	for y in h:
		var row := y * w * ALPHA_STEP
		for x in w:
			if data[row + x * ALPHA_STEP + 3] > ALPHA_BYTE:
				min_x = mini(min_x, x)
				min_y = mini(min_y, y)
				max_x = maxi(max_x, x)
				max_y = maxi(max_y, y)
	if max_x < 0:
		return Rect2i()
	return Rect2i(min_x, min_y, max_x - min_x + 1, max_y - min_y + 1)


## Rec.601 luma of the pixel at byte offset `o`, on the 0-255 scale the palette
## constants are quoted in.
func _luma_at(data: PackedByteArray, o: int) -> float:
	return (
		float(data[o]) * 299.0 + float(data[o + 1]) * 587.0 + float(data[o + 2]) * 114.0
	) / 1000.0


func _is_near_black_at(data: PackedByteArray, o: int) -> bool:
	return data[o + 3] > ALPHA_BYTE and _luma_at(data, o) <= NEAR_BLACK_LUMA


# --- composing ---------------------------------------------------------------

func _compose(clip: String, direction: String, frames: Array) -> Image:
	var strip := Image.create_empty(
		_frame_w * frames.size(), _frame_h, false, Image.FORMAT_RGBA8
	)
	strip.fill(Color(0, 0, 0, 0))

	var ground_row := _frame_h - 1 - MARGIN

	# A grounded cycle plants EVERY frame on the ground row. That is what stops the
	# bear bobbing as its stride changes, and it is right for idle, run and land.
	#
	# Applied to an airborne clip it is actively wrong, and this project already paid
	# for the lesson once on the side-view poses: planting each frame clamps the jump
	# back onto the floor on exactly the frames where the bear is highest, and the
	# leap — the entire animation — disappears. An airborne clip therefore gets ONE
	# translation, taken from its lowest frame, applied to all of them, so the rise
	# above the ground row survives.
	var clip_cfg: Dictionary = CLIPS.get(clip, {})
	var airborne: bool = bool(clip_cfg.get("airborne", false))
	var shared_shift := 0
	if airborne:
		var lowest_bottom := -1
		for f in frames:
			lowest_bottom = maxi(lowest_bottom, int(f["y"]) + int(f["h"]) - 1)
		shared_shift = ground_row - lowest_bottom

	for i in frames.size():
		var f: Dictionary = frames[i]
		var w: int = f["w"]
		var h: int = f["h"]

		# Centre the bbox horizontally either way; that part is the same rule.
		var dest_x := int(round(_frame_w / 2.0 - w / 2.0))
		var dest_y: int = (
			int(f["y"]) + shared_shift if airborne else ground_row - (h - 1)
		)

		if dest_x < 0 or dest_x + w > _frame_w or dest_y < 0 or dest_y + h > _frame_h:
			_problems.append(
				"%s/%s frame %d: %dx%d at (%d,%d) does not fit %dx%d"
				% [clip, direction, i, w, h, dest_x, dest_y, _frame_w, _frame_h]
			)
			continue

		# Blit only the bbox region. Copying the full source image would carry its
		# transparent border into the neighbouring frame's cell and, because
		# blit_rect overwrites rather than composites, could erase part of it.
		strip.blit_rect(
			f["image"] as Image,
			Rect2i(f["x"], f["y"], w, h),
			Vector2i(_frame_w * i + dest_x, dest_y)
		)
		f["dest_y"] = dest_y
	return strip


# --- writing -----------------------------------------------------------------

func _write_png(img: Image, path: String) -> void:
	# `Image.save_png` does not create directories — it just fails with "File not
	# found", which reads like a permissions problem rather than a missing folder.
	# Created here rather than once up front so every writer is self-sufficient.
	var dir := path.get_base_dir()
	if not DirAccess.dir_exists_absolute(dir):
		var mk := DirAccess.make_dir_recursive_absolute(dir)
		if mk != OK and mk != ERR_ALREADY_EXISTS:
			_problems.append("could not create %s: %s" % [dir, error_string(mk)])
			return
	var err := img.save_png(path)
	if err != OK:
		_problems.append("could not write %s: %s" % [path, error_string(err)])


func _write_layout(strips: Array) -> void:
	var payload := {
		"frame_w": _frame_w,
		"frame_h": _frame_h,
		"strips": strips,
	}
	var path := "%s/layout.json" % _out
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		_problems.append("could not write %s" % path)
		return
	f.store_string(JSON.stringify(payload, "  "))
	f.close()


func _round_up(value: int, multiple: int) -> int:
	return int(ceil(float(value) / multiple)) * multiple
