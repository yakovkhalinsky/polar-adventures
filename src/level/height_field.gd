## A ground height per cell — the whole of the level's solidity, in one table.
##
## This replaces screen-space collision boxes, and the reason is forced rather than
## chosen. In a 2:1 diamond, moving one cell along +u moves the character right AND
## DOWN by half a tile. A flat-topped collision box puts the floor on a horizontal
## screen line, so a character walking along an axis walks down into it. The two cannot
## both be true.
##
## So the level is a height field: `(cell) -> ground height in pixels`, and collision is
## a query rather than a shape overlap. "What is under me", "can I step up to it", and
## "am I falling" are all one lookup.
##
## Heights are absolute screen pixels of elevation, and because `Iso.ELEV_STEP` is 1 they
## are also just pixels — a platform 32 above the ground is a platform of height 32.

class_name HeightField
extends RefCounted

var _heights := {}
var _missing := 0.0

## Whether a cell outside the table is ground at `_missing`, or a hole to fall down.
var _outside_is_ground := true


func _init(outside_is_ground: bool = true) -> void:
	_outside_is_ground = outside_is_ground


func set_height(cell: Vector2i, height: float) -> void:
	_heights[cell] = height


## Ground height at a cell. Cells with no entry are either ground at the default
## height or a hole, depending on how the field was made — an explicit switch rather
## than an implicit convention, because "no data" meaning "solid" in one place and
## "pit" in another is how a level ends up with an invisible hole in it.
func height_at(cell: Vector2i) -> float:
	if _heights.has(cell):
		return float(_heights[cell])
	return _missing if _outside_is_ground else -INF


func is_ground(cell: Vector2i) -> bool:
	return _heights.has(cell) or _outside_is_ground


func cells() -> Array:
	return _heights.keys()


## Fills an axis-aligned rectangle of cells at one height. The probe's level is built
## from two of these; a real level would come from the text source.
func fill_rect(from: Vector2i, to: Vector2i, height: float) -> void:
	for u in range(mini(from.x, to.x), maxi(from.x, to.x) + 1):
		for v in range(mini(from.y, to.y), maxi(from.y, to.y) + 1):
			set_height(Vector2i(u, v), height)
