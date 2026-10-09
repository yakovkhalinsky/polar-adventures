## Draws a built level isometrically, from its height field.
##
## THERE IS NO TILEMAP HERE, and that is the model rather than a shortcut. In a height
## field the level is a table of ground heights, so what is drawn is derived: every cell's
## top face, plus a skirt on whichever camera-facing sides are taller than the ground
## behind them. A tilemap would be a second description of the same level, free to
## disagree with the one the collision reads.
##
## THE TERRAIN IS SPLIT INTO DIAGONALS, and that is what makes depth work. A node's draw
## calls become ONE canvas item, so a terrain drawn by a single node is something the
## character sorts against as a whole — it would walk in front of a block it should be
## behind, or behind all of them. Cells with the same `u + v` are at the same depth and
## never overlap each other, so one node per diagonal is the coarsest split that keeps
## every cell sorted correctly, and it is 2N nodes rather than N.
##
## The colours are PLACEHOLDERS. Tile art is not generated yet, so this draws flat faces
## keyed to height. It is exact about geometry and provisional about looks, which is the
## right way round: a placeholder that is geometrically wrong teaches nothing.

class_name IsoTerrain
extends Node2D

const TOP_LOW := Color("c9d8e4")
const TOP_HIGH := Color("eef5fb")
const SIDE_U := Color("8fa4b6")
const SIDE_V := Color("6f8698")
const EDGE := Color("3d4a58")

var built: BuiltLevel


## One depth slice: the cells sharing a `u + v`, drawn as a single item.
class Slice extends Node2D:
	var terrain: IsoTerrain = null
	var cells: Array = []
	var lift := 0.0

	func _draw() -> void:
		for cell in cells:
			terrain.draw_cell(self, cell, lift)


func _ready() -> void:
	build()


func build() -> void:
	for child in get_children():
		child.queue_free()
	if built == null:
		return

	var by_diagonal := {}
	for cell in built.source.cells:
		var k: int = cell.x + cell.y
		if not by_diagonal.has(k):
			by_diagonal[k] = []
		by_diagonal[k].append(cell)

	var keys := by_diagonal.keys()
	keys.sort()
	for k in keys:
		var slice := Slice.new()
		slice.terrain = self
		slice.cells = by_diagonal[k]
		# The slice sorts by the topmost cell it holds. Cells on one diagonal share a
		# depth, so any of them would do; the topmost is the one that reads as "how far
		# toward the camera is this" without depending on a height.
		var top := INF
		for cell in slice.cells:
			top = minf(top, Iso.cell_to_screen(cell, built.height_at(cell)).y)
		slice.lift = top
		slice.position = Vector2(0.0, top)
		add_child(slice)


## Called by a slice, drawing into the slice's canvas item so depth works.
func draw_cell(slice: Slice, cell: Vector2i, lift: float) -> void:
	var h := built.height_at(cell)
	var centre := Iso.cell_to_screen(cell, h) - Vector2(0.0, lift)
	var left := centre + Vector2(-Iso.HALF_W, 0.0)
	var bottom := centre + Vector2(0.0, Iso.HALF_H)
	var right := centre + Vector2(Iso.HALF_W, 0.0)

	# The two flanks the camera can see, each drawn only as far down as the ground behind
	# it — so a cliff shows a tall face and a kerb shows a short one, from one rule.
	if built.side_v_visible(cell):
		_quad(slice, bottom, left, h - built.height_at(Vector2i(cell.x, cell.y + 1)), SIDE_V)
	if built.side_u_visible(cell):
		_quad(slice, right, bottom, h - built.height_at(Vector2i(cell.x + 1, cell.y)), SIDE_U)

	# The top face: a diamond, brighter the higher it is, so terraces read apart even
	# without art.
	var lit := TOP_LOW.lerp(TOP_HIGH, clampf(h / 96.0, 0.0, 1.0))
	var poly := PackedVector2Array()
	for v in Iso.diamond_vertices():
		poly.append(centre + v)
	slice.draw_colored_polygon(poly, lit)
	var loop := poly.duplicate()
	loop.append(poly[0])
	slice.draw_polyline(loop, EDGE, 1.0)


## A skirt hanging from the edge `a`–`b`, `drop` pixels down.
func _quad(slice: Slice, a: Vector2, b: Vector2, drop: float, colour: Color) -> void:
	if drop <= 0.0:
		return
	slice.draw_colored_polygon(
		PackedVector2Array([a, b, b + Vector2(0.0, drop), a + Vector2(0.0, drop)]), colour
	)
