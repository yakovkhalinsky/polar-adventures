## Checks on the level format and the build.
##
## The validation checks are the point of this file. Hand-authored text has no compiler, so
## every malformed input is fed in deliberately and asserted to fail — and to fail by NAME,
## because a validation pass that rejects something without saying which row is barely
## better than no validation at all.

extends RefCounted

const LEVEL_PATH := "res://levels/feel-test-01.txt"

const GOOD := """[name] t
[tile] 64 32
[legend] . empty 0
[legend] # solid 32
[legend] P spawn 32
[rows]
###
#.#
#P#
"""


func run(h) -> void:
	# --- the shipped level -------------------------------------------------
	var src := LevelSource.parse(LEVEL_PATH)
	h.check("the shipped level parses", src != null, LEVEL_PATH)
	if src == null:
		return
	h.eq("its first row sets the width", src.width, 16)
	h.eq("it has 16 rows", src.rows.size(), 16)

	var built := BuiltLevel.from_source(src)
	h.eq("the spawn is where the P is", built.spawn_cell, Vector2i(9, 11))
	h.check(
		"the spawn stands on ground",
		absf(built.spawn_height - 32.0) < 0.01,
		"spawn height %.1f" % built.spawn_height,
	)
	h.check(
		"plain ground is at 32",
		absf(built.height_at(Vector2i(0, 0)) - 32.0) < 0.01,
		"%.1f" % built.height_at(Vector2i(0, 0)),
	)
	h.check(
		"the plateau is at 64",
		absf(built.height_at(Vector2i(5, 3)) - 64.0) < 0.01,
		"%.1f" % built.height_at(Vector2i(5, 3)),
	)
	h.check(
		"the pit is a hole, not ground",
		not built.is_ground(Vector2i(5, 7)),
		"height %s" % str(built.height_at(Vector2i(5, 7))),
	)
	# A block next to lower ground shows its flank; one buried in a plateau does not.
	h.check(
		"a plateau edge shows its flank toward lower ground",
		built.side_u_visible(Vector2i(7, 3)) and not built.side_u_visible(Vector2i(4, 3)),
		"edge %s, interior %s" % [
			built.side_u_visible(Vector2i(7, 3)), built.side_u_visible(Vector2i(4, 3))
		],
	)

	# --- the format rejects what it should, by name ------------------------
	# Each of these would otherwise surface far from its cause: a ragged row reads as a
	# hole hundreds of pixels away, an unknown character reads as ground that is not there.
	h.check(
		"a ragged row is rejected",
		LevelSource.from_text(GOOD.replace("#.#", "#.#.")) == null,
		"a row one character long",
	)
	h.check(
		"a character missing from the legend is rejected",
		LevelSource.from_text(GOOD.replace("#P#", "#X#")) == null,
		"an undeclared character",
	)
	h.check(
		"a level with no spawn is rejected",
		LevelSource.from_text(GOOD.replace("#P#", "#.#")) == null,
		"no spawn",
	)
	h.check(
		"a level with two spawns is rejected",
		LevelSource.from_text(GOOD.replace("#.#", "#P#")) == null,
		"two spawns",
	)
	h.check(
		"an unknown key is rejected",
		LevelSource.from_text(GOOD + "[wobble] 3\n") == null,
		"an unknown [key]",
	)
	h.check(
		"a legend line with the wrong shape is rejected",
		LevelSource.from_text(GOOD.replace("[legend] . empty 0", "[legend] . empty")) == null,
		"a legend missing its height",
	)
	# And the good one still parses, so the rejects above are not just "everything fails".
	h.check("the control level parses", LevelSource.from_text(GOOD) != null, "the unmodified text")
