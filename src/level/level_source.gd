## Parses a level's text source into a plain description. THE ONLY FILE THAT KNOWS THE
## FORMAT.
##
## That restriction is the whole design, and it is carried over from the side-view build
## where the same rule paid for itself: swapping in a different level format means
## changing this file and nothing else, because everything downstream sees only the
## `LevelSource` shape. It is also why this file never touches Godot's tilemap types — the
## format is text, and nothing else needs to know that.
##
## FAILS LOUDLY, BY NAME, ON EVERY MALFORMED INPUT. Hand-authored text has no compiler,
## so this validation pass is worth more than the rest of the file. The failures it
## catches, each of which would otherwise surface far away from its cause:
##
##   * a row of the wrong length — a ragged right edge that reads as a hole
##   * a character not in the legend — silently empty ground
##   * no spawn — the character has nowhere to start
##   * two spawns — whichever one the parser found first wins, silently
##
## Every one of those is asserted by tests/unit/test_level_format.gd. A check that
## no test exercises is a claim, not a guarantee — see the note in `_build`.

class_name LevelSource
extends RefCounted

enum Kind { EMPTY, SOLID, SPAWN }

class Cell extends RefCounted:
	var kind: Kind = Kind.EMPTY
	var height := 0.0


var name := ""
var tile := Vector2i(64, 32)
var rows: PackedStringArray = []
var width := 0

## (u, v) -> Cell. Cells absent from this map are empty and are not ground.
var cells := {}


## Parses a level file. Returns null and prints why, rather than a half-built level.
static func parse(path: String) -> LevelSource:
	if not FileAccess.file_exists(path):
		printerr("level %s: no such file" % path)
		return null
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		printerr("level %s: empty" % path)
		return null
	return from_text(text, path)


static func from_text(text: String, origin: String = "<text>") -> LevelSource:
	var src := LevelSource.new()
	var legend := {}
	var in_rows := false
	var line_no := 0

	for raw in text.split("\n"):
		line_no += 1
		var line := raw.strip_edges()
		if line.is_empty() or line.begins_with(";"):
			continue
		if line.begins_with("[rows]"):
			in_rows = true
			continue
		if in_rows:
			src.rows.append(line)
			continue

		# `[key] rest`. Split on the first space so a value can contain spaces.
		var close := line.find("]")
		if not line.begins_with("[") or close < 0:
			printerr("level %s line %d: expected [key] value, got %s" % [origin, line_no, line])
			return null
		var key := line.substr(1, close - 1)
		var value := line.substr(close + 1).strip_edges()

		match key:
			"name":
				src.name = value
			"tile":
				var parts := value.split(" ")
				if parts.size() != 2:
					printerr("level %s line %d: [tile] needs two numbers" % [origin, line_no])
					return null
				src.tile = Vector2i(int(parts[0]), int(parts[1]))
			"legend":
				if not _read_legend(src, legend, value, origin, line_no):
					return null
			_:
				printerr("level %s line %d: unknown key [%s]" % [origin, line_no, key])
				return null

	if src.rows.is_empty():
		printerr("level %s: no [rows]" % origin)
		return null
	if not src._validate(legend, origin):
		return null
	src._build(legend)
	return src


## `[legend] # solid 32` — one character, a kind, and a ground height.
static func _read_legend(
	src: LevelSource, legend: Dictionary, value: String, origin: String, line_no: int
) -> bool:
	var parts := value.split(" ", false)
	if parts.size() != 3:
		printerr("level %s line %d: [legend] needs <char> <kind> <height>" % [origin, line_no])
		return false
	var ch: String = parts[0]
	if ch.length() != 1:
		printerr("level %s line %d: legend key must be one character, got '%s'" % [
			origin, line_no, ch
		])
		return false
	if legend.has(ch):
		printerr("level %s line %d: '%s' is in the legend twice" % [origin, line_no, ch])
		return false
	var kind: String = parts[1]
	match kind:
		"empty", "solid", "spawn":
			pass
		_:
			printerr("level %s line %d: unknown kind '%s'" % [origin, line_no, kind])
			return false
	legend[ch] = {"kind": kind, "height": float(parts[2])}
	return true


func _validate(legend: Dictionary, origin: String) -> bool:
	width = rows[0].length()
	for i in rows.size():
		if rows[i].length() != width:
			printerr("level %s: row %d is %d characters, row 0 is %d" % [
				origin, i, rows[i].length(), width
			])
			return false
	var spawns := 0
	for v in rows.size():
		for u in width:
			var ch := rows[v][u]
			if not legend.has(ch):
				printerr("level %s: row %d column %d has '%s', which is not in the legend" % [
					origin, v, u, ch
				])
				return false
			if legend[ch]["kind"] == "spawn":
				spawns += 1
	if spawns == 0:
		printerr("level %s: no spawn (a legend kind of 'spawn')" % origin)
		return false
	if spawns > 1:
		printerr("level %s: %d spawns; there must be exactly one" % [origin, spawns])
		return false
	return true


func _build(legend: Dictionary) -> void:
	for v in rows.size():
		for u in width:
			var entry: Dictionary = legend[rows[v][u]]
			var kind: String = entry["kind"]
			if kind == "empty":
				continue
			var cell := Cell.new()
			cell.kind = Kind.SPAWN if kind == "spawn" else Kind.SOLID
			cell.height = entry["height"]
			cells[Vector2i(u, v)] = cell

	# A "floating island" check lived here: a solid cell at height > 0 with nothing
	# beneath it. It is gone, and it should not be re-added in that form — for two
	# reasons, either of which is fatal on its own.
	#
	# It could never fire. It built `below := Vector2i(key.x, key.y)` — the cell's own
	# key — then asked `cells.has(below)`, which is trivially true for every cell in
	# the very loop it was iterating. A check that cannot fail is not a check; it is a
	# claim in the header (and it was, until this was removed).
	#
	# And the condition it described does not exist in this model. A height here is a
	# property OF a cell, not a cell's position in a stack, so no cell is ever
	# unsupported: every raised cell in the shipped level — the whole 4x4 plateau —
	# would have tripped it. The old side-view build had columns and could express
	# "nothing beneath"; this format cannot, which is why it has no `bridge` kind for
	# the header to make an exception of.
	#
	# If it is wanted back, it needs a definition of "beneath" this format can state,
	# and a test that watches it reject something.


func spawn_cell() -> Vector2i:
	for key in cells:
		if (cells[key] as Cell).kind == Kind.SPAWN:
			return key
	return Vector2i.ZERO


func bounds() -> Rect2i:
	if cells.is_empty():
		return Rect2i()
	var min_u := 1 << 30
	var min_v := 1 << 30
	var max_u := -1
	var max_v := -1
	for key in cells:
		min_u = mini(min_u, key.x)
		min_v = mini(min_v, key.y)
		max_u = maxi(max_u, key.x)
		max_v = maxi(max_v, key.y)
	return Rect2i(min_u, min_v, max_u - min_u + 1, max_v - min_v + 1)
