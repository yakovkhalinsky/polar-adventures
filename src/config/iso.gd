## The projection seam: the only file in this project that knows the geometry of
## the isometric view.
##
## Everything else — collision, the ground probe, depth sorting, the camera —
## works in screen pixels and asks this file to convert. That is deliberate, and
## it is the isometric analogue of the existing surface seam: in the Phaser build
## a third *surface* touched one file and no player code, and here a change of
## projection (2:1 to 4:3, diamond to something else) touches this one file.
##
## COORDINATES. Cell space is (u, v), a plain square lattice — no diamonds in it.
## Screen space is pixels, y DOWN, as in every 2D engine here. The projection is
## what makes a square lattice *look* like a diamond field:
##
##     screen.x = (u - v) * HALF_W
##     screen.y = (u + v) * HALF_H  -  elevation * ELEV_STEP
##
## A cell's box, [u +/- 0.5] x [v +/- 0.5], maps to a diamond of half-width
## HALF_W and half-height HALF_H — so TILE_W x TILE_H is 64 x 32, a true 2:1
## isometric diamond, and the four box corners land exactly on its four vertices.
##
## cell_to_screen returns the CENTRE of that diamond, and screen_to_cell ROUNDS
## rather than floors. That pairing is what makes the round trip exact for a
## cell's own centre, which is the property the test suite asserts.
##
## WHAT THE ROUNDING REGION ACTUALLY IS — measured, not assumed. The set of
## screen points that resolve to a cell is exactly that cell's visual diamond. An
## earlier draft of this file claimed the upper half of a diamond resolves to the
## cell behind it; the suite disproved that on its first run, and the corrected
## claim is the stronger one: a point anywhere inside the diamond resolves to its
## own cell, and only past a vertex does it flip to a neighbour. So a ground probe
## taken inside the tile's top face needs no correction at all.
##
## The real hazard is different, and it is circularity: screen_to_cell needs the
## elevation, and the elevation needs the cell. That — not any skew in the
## rounding — is why the ground probe has to resolve through the level's own
## elevation table rather than through a projection call.

class_name Iso
extends RefCounted

const TILE_W := 64
const TILE_H := 32  # 2:1. The standard isometric diamond, and the ratio that
#                      makes the two "behind" neighbours equal in screen size.
const HALF_W := TILE_W / 2.0  # 32.0
const HALF_H := TILE_H / 2.0  # 16.0

## Vertical screen pixels per unit of elevation.
##
## ONE, so that elevation IS height in pixels. It was 32 — elevation as a step count —
## which meant every consumer had to remember to multiply, and made "the jump is 224px"
## and "the jump is 7 steps" two numbers free to drift apart. At 1, the height field's
## numbers and the movement constants' numbers are the same numbers.
const ELEV_STEP := 1.0

## The screen position of a CONTINUOUS lattice position and height — the form a moving
## character needs, and the form the height-field model is built on.
##
## A character's logical position is (u, v, height): two lattice coordinates, which are
## square, plus a height in pixels. Screen position is then DERIVED here rather than
## integrated, and it has to be, because of what the projection does to motion: moving
## one cell along +u moves the character right AND DOWN on screen. A model that
## integrates screen Y therefore cannot also have a walkable floor — walking along an
## axis would push the character into the ground it is standing on.
static func lattice_to_screen(u: float, v: float, height: float = 0.0) -> Vector2:
	return Vector2((u - v) * HALF_W, (u + v) * HALF_H - height * ELEV_STEP)


## The screen position of a cell's centre, at a given height.
static func cell_to_screen(cell: Vector2i, height: float = 0.0) -> Vector2:
	return lattice_to_screen(float(cell.x), float(cell.y), height)

## The cell containing a screen point, at a given elevation.
##
## Exact inverse of cell_to_screen for a cell's own centre.
static func screen_to_cell(point: Vector2, elevation: int = 0) -> Vector2i:
	var y := point.y + elevation * ELEV_STEP
	var u := (point.x / HALF_W + y / HALF_H) / 2.0
	var v := (y / HALF_H - point.x / HALF_W) / 2.0
	return Vector2i(roundi(u), roundi(v))

## The four vertices of a cell's diamond, clockwise from the top. Returned
## relative to the cell's centre, so callers can offset by cell_to_screen.
static func diamond_vertices() -> PackedVector2Array:
	return PackedVector2Array([
		Vector2(0.0, -HALF_H),  # top
		Vector2(HALF_W, 0.0),  # right
		Vector2(0.0, HALF_H),  # bottom
		Vector2(-HALF_W, 0.0),  # left
	])

## The two neighbours further from the camera. These are the cells that can
## occlude a cell, and therefore the two the autotile coverage mask has to ask
## about — "the cell directly above" from the Phaser build has no grid meaning
## here, because up the screen is not a lattice direction.
static func behind_neighbours(cell: Vector2i) -> Array[Vector2i]:
	return [Vector2i(cell.x - 1, cell.y), Vector2i(cell.x, cell.y - 1)]

## The y-sort origin for a TileMapLayer drawing these tiles.
##
## `TileMapLayer.y_sort_origin` is in PIXELS, and the sort key is
## `map_to_local(coords).y + TileData.y_sort_origin + layer.y_sort_origin`.
## `map_to_local()` returns the tile's CENTRE, not the point where it meets the
## ground, so a layer must add half a tile height for tiles to sort by their
## bottom vertex — which is what makes a character walking behind a raised block
## actually draw behind it.
##
## Derived rather than copied. Godot's own isometric demo uses 128x64 tiles with
## 32, which is the same half-height rule; that agreement is the evidence for it.
## (An earlier note had 33 here, which was half of the *Phaser* build's 66px
## tile. The tiles changed; the constant had to be re-derived, not carried.)
const TILE_SORT_ORIGIN := TILE_H / 2  # 16

## Elevation must be expressed as SIBLING TileMapLayers, never as `z_index`.
##
## Nodes sort relative to each other only while they share a `z_index`, so giving
## one a different `z_index` opts it out of y-sorting entirely. That is precisely
## the failure where a hero walks in front of a wall it should be behind — and it
## looks like a depth bug while being a sorting-opt-out bug, which is why it is
## written down here.
