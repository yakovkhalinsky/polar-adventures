## Draws an isometric grid for the lab to stand a character on.
##
## Its own node rather than the lab's `_draw()`, for a sorting reason that is easy to
## miss: with `y_sort_enabled` on the parent, a parent's own drawing and its children
## do not necessarily sort the way you expect, and a character that shares a cell with
## the floor can end up painted underneath it. As two siblings, tree order decides the
## tie — and the grid is placed first, so a character standing on a cell draws over it.
##
## There is no tile art yet. A placeholder that costs nothing beats blocking an art
## review on generating terrain first, and this one is exact: it uses the real
## projection from `Iso`, so what the eye judges is the projection that will ship.

extends Node2D

const GRID_RADIUS := 4
const RAISED_CELL := Vector2i(1, 1)
const RAISED_HEIGHT := 32.0

const FLOOR_TOP := Color("3d4753")
const FLOOR_EDGE := Color("232a33")
const RAISED_TOP := Color("55636f")
const RAISED_SIDE_L := Color("2f3841")
const RAISED_SIDE_R := Color("262d35")


func _ready() -> void:
	queue_redraw()


func _draw() -> void:
	# Painted back to front: `u + v` increases towards the camera in this projection,
	# so drawing in that order means nearer cells overdraw farther ones and the raised
	# block's skirt lands on top of the floor behind it.
	var cells: Array[Vector2i] = []
	for v in range(-GRID_RADIUS, GRID_RADIUS + 1):
		for u in range(-GRID_RADIUS, GRID_RADIUS + 1):
			cells.append(Vector2i(u, v))
	cells.sort_custom(func(a: Vector2i, b: Vector2i) -> bool: return a.x + a.y < b.x + b.y)
	for cell in cells:
		_draw_cell(cell)


func _draw_cell(cell: Vector2i) -> void:
	var centre := Iso.cell_to_screen(cell)
	var raised := cell == RAISED_CELL
	var lift := Vector2(0.0, -RAISED_HEIGHT) if raised else Vector2.ZERO

	var left := centre + Vector2(-Iso.HALF_W, 0.0)
	var bottom := centre + Vector2(0.0, Iso.HALF_H)
	var right := centre + Vector2(Iso.HALF_W, 0.0)

	if raised:
		# The two side faces a 2:1 diamond actually shows. Without them a raised cell
		# reads as a floating sheet rather than a block, and the depth cue the character
		# has to sit against disappears.
		draw_colored_polygon(
			PackedVector2Array([left + lift, bottom + lift, bottom, left]), RAISED_SIDE_L
		)
		draw_colored_polygon(
			PackedVector2Array([bottom + lift, right + lift, right, bottom]), RAISED_SIDE_R
		)

	var poly := PackedVector2Array()
	for v in Iso.diamond_vertices():
		poly.append(centre + v + lift)
	draw_colored_polygon(poly, RAISED_TOP if raised else FLOOR_TOP)

	var loop := poly.duplicate()
	loop.append(poly[0])
	draw_polyline(loop, FLOOR_EDGE, 1.0)


## Where a character standing on `cell` should put its FEET.
static func stand_point(cell: Vector2i) -> Vector2:
	var lift := Vector2(0.0, -RAISED_HEIGHT) if cell == RAISED_CELL else Vector2.ZERO
	return Iso.cell_to_screen(cell) + lift
