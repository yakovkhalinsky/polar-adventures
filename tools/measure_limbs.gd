## Measures how chunky a character's limbs are, from its registered strips.
##
##   godot --headless --path . --script res://tools/measure_limbs.gd \
##     -- --dir=res://assets/art/bear --clip=jump
##
## WHY THIS EXISTS. "The arms look thin" is an art judgement, and the judgement is
## right — but it is hard to act on and impossible to compare between two candidate
## characters. This turns it into two numbers and a ratio:
##
##   ARM  the thinnest vertical run in the outer fifth of the frame's opaque width.
##        In a jump the arms are extended and clear of the body, so the outer
##        columns cross an arm and nothing else, and the run there IS its thickness.
##        The MINIMUM over those columns, because the arm is slanted: a vertical cut
##        across a slanted limb overstates it, and the thinnest cut is the closest to
##        the truth.
##
##   LEG  the widest horizontal runs in the bottom fifth of the frame, which cut the
##        legs across rather than along.
##
## The RATIO is what the eye is actually reacting to. A bear whose arms are
## two-thirds of its legs reads as chunky with chunky arms; one whose arms are a
## third reads as a barrel with twigs bolted on. The second was measured at 0.6-0.7
## and looked wrong, which is why this tool exists rather than a note in a log.
##
## PRECEDENT: `scripts/review-limbs.mjs` did this job for the side-view poses —
## row runs in a leg band, plus a contact sheet so the numbers could be checked by
## eye. This is that idea pointed at arms, in the engine the project now uses, so it
## works on the strips that actually ship rather than on a separate sheet.

extends SceneTree

const ALPHA_BYTE := 2
const STEP := 4

## How far in from each side of the opaque width to look for an arm, as a fraction.
const EDGE_FRACTION := 0.2

## The band of the opaque box the legs are measured in, as fractions of its height
## from the top. LOW, near the feet, because that is where a bear's legs are actually
## separated: measured in the middle of the leg the two runs merge into one ~22px run
## and the "leg" comes out thicker than the torso. That mid-leg merge is exactly what
## scripts/review-limbs.mjs exists to catch, and it makes the middle of the leg the
## wrong place to measure a single limb.
##
## The feet splay, so this stops a little short of the very bottom.
const LEG_BAND_TOP := 0.78
const LEG_BAND_BOTTOM := 0.94


func _initialize() -> void:
	var dir := "res://assets/art/bear"
	var clip := "jump"
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--dir="):
			dir = arg.trim_prefix("--dir=")
		elif arg.begins_with("--clip="):
			clip = arg.trim_prefix("--clip=")

	var layout := _read_json("%s/layout.json" % dir)
	if layout.is_empty():
		printerr("measure_limbs: no layout.json under %s" % dir)
		quit(1)
		return
	var fw := int(layout["frame_w"])
	var fh := int(layout["frame_h"])

	print("limb thickness — %s, clip '%s', frame %dx%d" % [dir.get_file(), clip, fw, fh])
	print("")
	print("  %-12s %-7s %-9s %-9s %s" % ["facing", "frames", "arm px", "leg px", "arm/leg"])

	var arm_total := 0.0
	var leg_total := 0.0
	var samples := 0
	for direction in ["south-east", "south-west", "north-east", "north-west"]:
		var path := "%s/%s-%s.png" % [dir, clip, direction]
		var bytes := FileAccess.get_file_as_bytes(path)
		if bytes.is_empty():
			print("  %-12s (no strip)" % direction)
			continue
		var img := Image.new()
		if img.load_png_from_buffer(bytes) != OK:
			print("  %-12s (unreadable)" % direction)
			continue
		if img.get_format() != Image.FORMAT_RGBA8:
			img.convert(Image.FORMAT_RGBA8)

		var arms: Array[float] = []
		var legs: Array[float] = []
		var count := int(img.get_width()) / fw
		for i in count:
			var frame := Rect2i(i * fw, 0, fw, fh)
			var arm := _arm_thickness(img, frame)
			var leg := _leg_thickness(img, frame)
			if arm > 0.0:
				arms.append(arm)
			if leg > 0.0:
				legs.append(leg)
		if arms.is_empty() or legs.is_empty():
			print("  %-12s %-7d no limb found" % [direction, count])
			continue

		var arm_avg := _mean(arms)
		var leg_avg := _mean(legs)
		arm_total += arm_avg
		leg_total += leg_avg
		samples += 1
		print("  %-12s %-7d %-9.1f %-9.1f %.2f" % [
			direction, count, arm_avg, leg_avg, arm_avg / leg_avg
		])

	print("")
	if samples == 0:
		printerr("no limbs measured")
		quit(1)
		return
	var ratio := arm_total / leg_total
	print("  mean arm %.1f px, mean leg %.1f px, ratio %.2f" % [
		arm_total / samples, leg_total / samples, ratio
	])
	# The threshold is a judgement, but it is anchored to a measurement rather than
	# invented: the first bear measured 0.25 (3.0px arms against 12.0px legs) and read
	# as a barrel with twigs bolted on, which is what "too thin" means in practice.
	# 0.5 is the point where the arms stop reading as separate objects.
	print("  verdict: %s (first bear measured 0.25)" % (
		"chunky enough" if ratio >= 0.5 else "arms too thin relative to the legs"
	))
	quit(0)


func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	return parsed if parsed is Dictionary else {}


func _mean(values: Array) -> float:
	var total := 0.0
	for v in values:
		total += v
	return total / float(values.size())


## A limb's typical thickness: the MEDIAN of the FIRST vertical run in each outer column.
##
## Two earlier versions of this were wrong, in opposite directions, and both looked
## plausible:
##
##   MINIMUM of all runs   3.2px on the first bear. Too small: the narrowest cut in a
##                         column is usually the one nearest the FINGERTIP, where the
##                         limb ends rather than where it is thin. Growth of 1px each
##                         side moved it 3.2 -> 3.3 while the arm had genuinely grown.
##   MEDIAN of all runs    10.9px. Too big: an outer column crosses the extended arm
##                         AND whatever is below it — the leg — and the median lands on
##                         whichever has more columns, which at rest is the leg.
##
## FIRST run per column, then the median across columns. In a jump the arm is the
## topmost thing in the outer columns, so this isolates it; the median over columns
## runs down the length of the limb, so it moves when the limb does. It measures the
## arm cut at an angle, which overstates absolute thickness by 1/cos of the slant — but
## the slant is the same before and after a thickening, so the RATIO is unaffected.
func _arm_thickness(img: Image, frame: Rect2i) -> float:
	var data := img.get_data()
	var stride := img.get_width() * STEP
	var box := _opaque_bbox(img, frame)
	if box.size.x <= 2:
		return 0.0

	var margin := maxi(1, int(float(box.size.x) * EDGE_FRACTION))
	var runs: Array[float] = []
	for column in _edge_columns(box, margin):
		var run := 0
		for y in range(box.position.y, box.position.y + box.size.y):
			var o := y * stride + column * STEP
			if data[o + 3] > ALPHA_BYTE:
				run += 1
			elif run > 0:
				break
		if run > 0:
			runs.append(float(run))
	if runs.is_empty():
		return 0.0
	runs.sort()
	return runs[runs.size() / 2]


func _edge_columns(box: Rect2i, margin: int) -> Array[int]:
	var out: Array[int] = []
	for k in margin:
		out.append(box.position.x + k)
		out.append(box.position.x + box.size.x - 1 - k)
	return out


## One leg's thickness: the MEDIAN of the positive horizontal runs in the mid-leg
## band. The median rather than the widest, because a row that crosses both legs at
## once — or the feet — is one long run, and the median ignores those outliers as
## long as most rows cut a single leg.
func _leg_thickness(img: Image, frame: Rect2i) -> float:
	var data := img.get_data()
	var stride := img.get_width() * STEP
	var box := _opaque_bbox(img, frame)
	if box.size.y <= 4:
		return 0.0

	var top := box.position.y + int(float(box.size.y) * LEG_BAND_TOP)
	var bottom := box.position.y + int(float(box.size.y) * LEG_BAND_BOTTOM)
	var runs: Array[float] = []
	for y in range(top, maxi(top + 1, bottom)):
		var run := 0
		for x in range(box.position.x, box.position.x + box.size.x):
			var o := y * stride + x * STEP
			if data[o + 3] > ALPHA_BYTE:
				run += 1
			else:
				if run > 0:
					runs.append(float(run))
				run = 0
		if run > 0:
			runs.append(float(run))
	if runs.is_empty():
		return 0.0
	runs.sort()
	return runs[runs.size() / 2]


func _opaque_bbox(img: Image, frame: Rect2i) -> Rect2i:
	var data := img.get_data()
	var stride := img.get_width() * STEP
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
