## Thickens thin limbs, deterministically, on the registered strips.
##
## STATUS: BUILT, TESTED, AND NOT USED. Kept because the negative result is worth more
## than the code is, and because the next person to have this idea should find out here
## rather than spend the session again.
##
## It works in the sense that it does what it says: the arms come out visibly thicker,
## at 1px each side, consistently across all 124 frames. The problem is what else it
## does. Judged at the size the game actually draws — 1x in a 960x540 viewport, not at
## 5.5x on a comparison sheet:
##
##   * the eye and the nose are thin dark features, so the first version smeared them
##     into a blob across the face. Restricting growth to light fur fixed that and the
##     face still ends up with the features merged into a bar.
##   * with the face fixed, it merged the FINGERS into the hands, because fingers are
##     thin light fur too.
##   * the outline comes out doubled and rough where the growth moved it.
##
## Every fix was an exclusion, and each exclusion revealed the next thin detail. A pixel
## artist redraws an arm; dilating one keeps finding things that are not an arm. The
## honest conclusion is that limb THICKNESS is not reachable by any lever PixelLab
## exposes (`proportions` has arms_length and shoulder_width — lengths and span, not
## thickness), and not reachable by a morphological pass either, so the arms are what
## they are until someone is willing to redraw them by hand.
##
## Kept runnable because the same transform, with a different THIN_PX and band, may be
## right for a different problem — tidying stray pixels, or closing a gap.
##
##   godot --headless --path godot --script res://tools/thicken_limbs.gd \
##     -- --dir=res://art/bear-v1-baseline --out=res://art/bear-thick --clip=jump
##
## WHY THIS EXISTS. The bear came back with arms measuring 3.0px against 12.0px legs —
## a ratio of 0.25, which reads as a barrel with twigs bolted on. Regenerating the
## character from a description that asked for "thick heavy arms as plump as its legs"
## produced arms 37% thicker in absolute terms but legs 22% thicker as well, so the
## RATIO moved 0.25 -> 0.28 and the actual complaint was untouched. PixelLab's
## `proportions` has head_size, arms_length, legs_length, shoulder_width and hip_width —
## lengths and shoulder span, nothing for limb THICKNESS. So neither prompt nor
## parameter addresses it, and this is what is left.
##
## It is also the most consistent option available. Editing the frames through an image
## model needs 14+ independent calls at nine frames each, and each call is free to
## disagree with the last — the arms would drift between batches. This is one
## deterministic transform applied identically to every frame, and its result is
## gradable by `measure_limbs.gd`, which is what found the problem.
##
## THE TRANSFORM, in order, and each step is why the previous one is not enough:
##
##   1. Split the character into FILL and OUTLINE. The outline is the darkest
##      substantial tone, the same thing the palette repair already derives.
##   2. Distance-transform the fill to get local thickness. An arm's fill is a couple
##      of pixels across; the torso's is more than ten.
##   3. Grow the fill outward, but ONLY where it is thinner than THIN_PX, and only
##      outward from fill pixels — never into the head, which is where the ears and
##      muzzle live and which nobody complained about.
##   4. Redraw a 1px outline around the new silhouette.
##
## Step 4 is not decoration: growing outward by copying the nearest colour would carry
## the OLD outline colour outward and leave a 2px rim, and leaving the old outline in
## place would draw a dark line down the middle of the limb that just got fatter.

extends SceneTree

const ALPHA_BYTE := 2
const STEP := 4

## A fill region thinner than this (in pixels, across) is a candidate limb. The arms'
## fill measures ~2px across and the torso's ~15, so this sits well between them.
##
## Thinness ALONE is not enough, and that was the first version's mistake: a shin is
## thin too, so the legs grew by 17% alongside the arms' 23% and the ratio — the thing
## being fixed — moved 0.25 to 0.26. The two exclusions below are what make it target
## the arms.
const THIN_PX := 4

## How far to grow, in pixels, each side. One is a visible change on a 3px arm; two
## starts to read as a different limb.
const DEFAULT_GROW := 1

## The head is never grown into: it holds the ears and the muzzle, neither of which
## needs thickening.
##
## A BOX, not a band. The first version skipped the top 30% of the frame outright, which
## also skipped the arms in a jump — where they are raised above the shoulders, i.e.
## exactly the frames the measurement is taken from. The box is centred on the opaque
## silhouette instead, so it covers the head and leaves the raised arms alone.
const HEAD_HEIGHT := 0.32
const HEAD_HALF_WIDTH := 0.25

## Below this fraction of the silhouette, nothing grows — the legs are the reference the
## arms are being brought up to, not a second thing to thicken.
const DEFAULT_BAND_BOTTOM := 0.68

var _thin := THIN_PX
var _grow := DEFAULT_GROW
var _band_bottom := DEFAULT_BAND_BOTTOM

## Only FUR is grown, never a dark feature. The first version grew anything thin that
## was not the outline colour — and the eye and the nose are thin, dark, and not the
## outline colour, so they were grown into a smeared blob across the face. The bear's
## darkest fur is around luma 139 and its face features are 10-15, so the gap is wide
## and this sits in the middle of it.
const FILL_MIN_LUMA := 90.0


func _initialize() -> void:
	var dir := "res://art/bear-v1-baseline"
	var out := "res://art/bear-thick"
	var clips := PackedStringArray(["jump"])
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--dir="):
			dir = arg.trim_prefix("--dir=")
		elif arg.begins_with("--out="):
			out = arg.trim_prefix("--out=")
		elif arg.begins_with("--clips="):
			clips = arg.trim_prefix("--clips=").split(",")
		elif arg.begins_with("--thin="):
			_thin = int(arg.trim_prefix("--thin="))
		elif arg.begins_with("--grow="):
			_grow = int(arg.trim_prefix("--grow="))
		elif arg.begins_with("--band-bottom="):
			_band_bottom = float(arg.trim_prefix("--band-bottom="))

	var layout := _read_json("%s/layout.json" % dir)
	if layout.is_empty():
		printerr("thicken_limbs: no layout.json under %s" % dir)
		quit(1)
		return
	var fw := int(layout["frame_w"])
	var fh := int(layout["frame_h"])

	print("thicken_limbs: thin<%dpx  grow=%dpx  head box kept  legs kept below %.0f%%" % [
		_thin, _grow, _band_bottom * 100.0
	])
	print("")
	print("  %-26s %-8s %s" % ["strip", "frames", "pixels added"])

	var written := 0
	for entry in layout.get("strips", []):
		var name: String = entry["name"]
		var clip := name.split("-")[0]
		if not clips.has(clip):
			continue
		var path := "%s/%s.png" % [dir, name]
		var bytes := FileAccess.get_file_as_bytes(path)
		if bytes.is_empty():
			continue
		var img := Image.new()
		if img.load_png_from_buffer(bytes) != OK:
			continue
		if img.get_format() != Image.FORMAT_RGBA8:
			img.convert(Image.FORMAT_RGBA8)

		var count := int(img.get_width()) / fw
		var out_img := Image.create_empty(img.get_width(), img.get_height(), false, Image.FORMAT_RGBA8)
		out_img.copy_from(img)
		var added := 0
		for i in count:
			added += _thicken_frame(out_img, Rect2i(i * fw, 0, fw, fh))
		_write_png(out_img, "%s/%s.png" % [out, name])
		print("  %-26s %-8d %d px" % [name, count, added])
		written += 1

	if written == 0:
		printerr("thicken_limbs: no strips matched")
		quit(1)
		return
	# The layout is copied verbatim: this pass changes pixels, never frame counts,
	# timings or frame size, so a layout that disagreed would be a bug elsewhere.
	var f := FileAccess.open("%s/layout.json" % out, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(layout, "  "))
		f.close()
	print("")
	print("wrote %d strips to %s" % [written, out])
	print("now grade it: measure_limbs.gd --dir=%s --clip=%s" % [out, clips[0]])
	quit(0)


## The opaque bounding box of one frame, which is what the head box and the leg limit
## are positioned against — fractions of the FRAME would move with the registration,
## and fractions of the silhouette do not.
func _opaque_bbox(data: PackedByteArray, stride: int, frame: Rect2i) -> Rect2i:
	var min_x := frame.position.x + frame.size.x
	var min_y := frame.position.y + frame.size.y
	var max_x := -1
	var max_y := -1
	for y in range(frame.position.y, frame.position.y + frame.size.y):
		for x in range(frame.position.x, frame.position.x + frame.size.x):
			if data[y * stride + x * STEP + 3] > ALPHA_BYTE:
				min_x = mini(min_x, x)
				min_y = mini(min_y, y)
				max_x = maxi(max_x, x)
				max_y = maxi(max_y, y)
	if max_x < 0:
		return Rect2i()
	return Rect2i(min_x, min_y, max_x - min_x + 1, max_y - min_y + 1)


func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	return parsed if parsed is Dictionary else {}


func _write_png(img: Image, path: String) -> void:
	var dir := path.get_base_dir()
	if not DirAccess.dir_exists_absolute(dir):
		DirAccess.make_dir_recursive_absolute(dir)
	img.save_png(path)


## Returns how many pixels were added to this frame.
func _thicken_frame(img: Image, frame: Rect2i) -> int:
	var w := img.get_width()
	var stride := w * STEP
	var data := img.get_data()

	var fw := frame.size.x
	var fh := frame.size.y
	var box := _opaque_bbox(data, stride, frame)
	if box.size.x <= 0:
		return 0
	var head_bottom := box.position.y + int(float(box.size.y) * HEAD_HEIGHT)
	var head_half := maxi(2, int(float(box.size.x) * HEAD_HALF_WIDTH))
	var head_centre := box.position.x + box.size.x / 2
	var band_bottom := box.position.y + int(float(box.size.y) * _band_bottom)

	# --- 1. the outline colour, and the fill mask ---------------------------
	var outline := _darkest_substantial(data, stride, frame)
	if outline.a <= 0.0:
		return 0
	var outline_key := _key(outline)

	var fill := PackedByteArray()
	fill.resize(fw * fh)
	for y in fh:
		for x in fw:
			var o := (frame.position.y + y) * stride + (frame.position.x + x) * STEP
			if data[o + 3] <= ALPHA_BYTE:
				continue
			var key := (int(data[o]) << 16) | (int(data[o + 1]) << 8) | int(data[o + 2])
			var luma := (
				float(data[o]) * 299.0 + float(data[o + 1]) * 587.0 + float(data[o + 2]) * 114.0
			) / 1000.0
			# Fur only: not the outline, and not a dark feature.
			fill[y * fw + x] = 0 if (key == outline_key or luma < FILL_MIN_LUMA) else 1

	# --- 2. local thickness, by distance to the nearest non-fill ------------
	# Two passes of a Chebyshev distance transform: forward then backward. That is
	# the standard approximation and is exact for the 4/8-neighbour metric, which is
	# what "how many pixels across is this" means here.
	var dist := PackedInt32Array()
	dist.resize(fw * fh)
	for i in fill.size():
		dist[i] = 0 if fill[i] == 0 else 10000
	for y in fh:
		for x in fw:
			var i := y * fw + x
			if dist[i] == 0:
				continue
			var best := dist[i]
			if x > 0:
				best = mini(best, dist[i - 1] + 1)
			if y > 0:
				best = mini(best, dist[i - fw] + 1)
			dist[i] = best
	for y in range(fh - 1, -1, -1):
		for x in range(fw - 1, -1, -1):
			var i := y * fw + x
			if dist[i] == 0:
				continue
			var best := dist[i]
			if x < fw - 1:
				best = mini(best, dist[i + 1] + 1)
			if y < fh - 1:
				best = mini(best, dist[i + fw] + 1)
			dist[i] = best

	# --- 3. grow the thin fill outward --------------------------------------
	var added := 0
	var grown := fill.duplicate()
	for step in _grow:
		var before := grown.duplicate()
		for y in range(1, fh - 1):
			var gy := frame.position.y + y
			if gy > band_bottom:
				continue
			for x in range(1, fw - 1):
				var gx := frame.position.x + x
				# The head box: the muzzle and ears live here and are not the complaint.
				if gy < head_bottom and absi(gx - head_centre) < head_half:
					continue
				var i := y * fw + x
				if before[i] == 1:
					continue
				# Grow into this pixel if it is next to fill that is still thin.
				var src := -1
				for dy in range(-1, 2):
					for dx in range(-1, 2):
						var j := (y + dy) * fw + (x + dx)
						if before[j] == 1 and dist[j] <= maxi(1, _thin / 2):
							src = j
				if src < 0:
					continue
				grown[i] = 1
				var s := ((frame.position.y + src / fw) * stride) + (frame.position.x + src % fw) * STEP
				var o := (frame.position.y + y) * stride + (frame.position.x + x) * STEP
				img.set_pixel(frame.position.x + x, frame.position.y + y, Color(
					float(data[s]) / 255.0, float(data[s + 1]) / 255.0,
					float(data[s + 2]) / 255.0, 1.0
				))
				added += 1
		# Refresh the byte view so the next growth ring sees this one.
		data = img.get_data()

	# --- 4. a fresh 1px outline around the new silhouette -------------------
	# The old outline is now INSIDE the limb, so it is overwritten with the fill it
	# borders; otherwise the thickened arm keeps a dark line down its middle.
	var outline_colour := Color(outline.r, outline.g, outline.b, 1.0)
	for y in fh:
		for x in fw:
			var i := y * fw + x
			if grown[i] == 0:
				continue
			var edge := false
			for dy in range(-1, 2):
				for dx in range(-1, 2):
					var ny := y + dy
					var nx := x + dx
					if ny < 0 or nx < 0 or ny >= fh or nx >= fw or grown[ny * fw + nx] == 0:
						edge = true
			var here := img.get_pixel(frame.position.x + x, frame.position.y + y)
			var was_outline := _key(here) == outline_key
			if edge:
				img.set_pixel(frame.position.x + x, frame.position.y + y, outline_colour)
			elif was_outline:
				# Interior old outline: replace it with the nearest fill colour found
				# along the row, so the limb reads as one mass rather than an outline
				# with a hole punched by the growth.
				img.set_pixel(
					frame.position.x + x, frame.position.y + y, _nearest_fill(img, frame, x, y, outline_key)
				)
	return added


func _nearest_fill(img: Image, frame: Rect2i, x: int, y: int, outline_key: int) -> Color:
	for radius in range(1, 6):
		for dy in range(-radius, radius + 1):
			for dx in range(-radius, radius + 1):
				var nx := x + dx
				var ny := y + dy
				if nx < 0 or ny < 0 or nx >= frame.size.x or ny >= frame.size.y:
					continue
				var c := img.get_pixel(frame.position.x + nx, frame.position.y + ny)
				if c.a <= 0.5 or _key(c) == outline_key:
					continue
				return c
	return Color(0.9, 0.87, 0.75, 1.0)


## The most common colour dark enough to be the outline. The same derivation the
## palette repair uses for its target, pointed at the other end of the ramp.
func _darkest_substantial(data: PackedByteArray, stride: int, frame: Rect2i) -> Color:
	var counts := {}
	var total := 0
	for y in range(frame.position.y, frame.position.y + frame.size.y):
		for x in range(frame.position.x, frame.position.x + frame.size.x):
			var o := y * stride + x * STEP
			if data[o + 3] <= ALPHA_BYTE:
				continue
			total += 1
			var key := (int(data[o]) << 16) | (int(data[o + 1]) << 8) | int(data[o + 2])
			counts[key] = int(counts.get(key, 0)) + 1
	if total == 0:
		return Color(0, 0, 0, 0)

	var floor_count := int(float(total) * 0.03)
	var best := Color(0, 0, 0, 0)
	var best_luma := 1.0e9
	for key in counts:
		if int(counts[key]) < floor_count:
			continue
		var k: int = key
		var l := (
			float((k >> 16) & 0xFF) * 299.0 + float((k >> 8) & 0xFF) * 587.0 + float(k & 0xFF) * 114.0
		) / 1000.0
		if l < best_luma:
			best_luma = l
			best = Color(
				float((k >> 16) & 0xFF) / 255.0, float((k >> 8) & 0xFF) / 255.0,
				float(k & 0xFF) / 255.0, 1.0
			)
	return best


func _key(c: Color) -> int:
	return (
		(int(round(c.r * 255.0)) << 16) | (int(round(c.g * 255.0)) << 8)
		| int(round(c.b * 255.0))
	)
