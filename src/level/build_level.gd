## What a level MEANS, built from a parsed `LevelSource`.
##
## THE SECOND SEAM. `LevelSource` knows the text format and nothing else; the renderer and
## the hero consume this and never parse anything. Swapping the format is a change to one
## file, and the game never learns that levels used to be text.

class_name BuiltLevel
extends RefCounted

var source: LevelSource
var field: HeightField
var spawn_cell := Vector2i.ZERO
var spawn_height := 0.0
var bounds := Rect2i()
var tile := Vector2i(64, 32)


static func from_source(src: LevelSource) -> BuiltLevel:
	var built := BuiltLevel.new()
	built.source = src
	built.tile = src.tile

	# Cells the level does not describe are HOLES, not ground: a level is a finite thing
	# and walking off it should be a fall. The opposite default would surround every level
	# with invisible floor.
	var field := HeightField.new(false)
	for key in src.cells:
		field.set_height(key, (src.cells[key] as LevelSource.Cell).height)
	built.field = field

	built.spawn_cell = src.spawn_cell()
	built.spawn_height = field.height_at(built.spawn_cell)
	built.bounds = src.bounds()
	return built


func height_at(cell: Vector2i) -> float:
	return field.height_at(cell)


func is_ground(cell: Vector2i) -> bool:
	return field.is_ground(cell)


## Whether the block's flank shows on the camera-facing side along +u.
##
## A cell's TOP face is always drawn. Its side faces show where the neighbour that way is
## lower or missing, which is the isometric equivalent of the side-view pass's "does this
## cell have sky over it". That pass had to be re-expressed because "above" is a screen
## direction with no grid neighbour; here the two directions ARE neighbours, so the rule
## is a comparison rather than a bitmask. The autotiling this replaces is simpler than the
## thing it replaces.
func side_u_visible(cell: Vector2i) -> bool:
	return field.height_at(Vector2i(cell.x + 1, cell.y)) < height_at(cell)


## The flank along +v, the other camera-facing side.
func side_v_visible(cell: Vector2i) -> bool:
	return field.height_at(Vector2i(cell.x, cell.y + 1)) < height_at(cell)


## Where the character's feet go: the centre of the spawn cell's top face.
func spawn_screen() -> Vector2:
	return Iso.cell_to_screen(spawn_cell, spawn_height)
