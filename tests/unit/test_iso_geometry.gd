## Checks on the isometric projection.
##
## The round trip is the load-bearing one: if cell_to_screen and screen_to_cell
## are not exact inverses over the whole grid, every collision box, every depth
## key and every ground probe is quietly off by a cell somewhere, and it shows up
## as a hero standing in the wrong place rather than as an error.

extends RefCounted

const ISO := preload("res://src/config/iso.gd")

func run(h) -> void:
	# --- the diamond's proportions ----------------------------------------
	h.close("TILE_W is 64", ISO.TILE_W, 64.0, 0.0)
	h.close("TILE_H is 32 (a true 2:1 diamond)", ISO.TILE_H, 32.0, 0.0)
	h.close(
		"the diamond is exactly 2:1",
		ISO.TILE_W / ISO.TILE_H,
		2.0,
		0.0001,
	)

	# --- the round trip, over the whole grid and several elevations -------
	var checked := 0
	var worst := 0
	for u in range(-8, 9):
		for v in range(-8, 9):
			for elev in range(0, 4):
				var cell := Vector2i(u, v)
				var back := ISO.screen_to_cell(ISO.cell_to_screen(cell, elev), elev)
				checked += 1
				if back != cell:
					worst += 1
	h.eq("screen_to_cell inverts cell_to_screen for every cell", worst, 0)
	h.check(
		"the sweep actually covered ground",
		checked == 17 * 17 * 4,
		"%d cells x elevations" % checked,
	)

	# --- elevation lifts without changing which cell ----------------------
	# The property that makes elevation safe to fold into the projection: a
	# raised cell is the same cell, drawn higher.
	var raised_ok := true
	for u in range(-4, 5):
		for v in range(-4, 5):
			var flat := ISO.cell_to_screen(Vector2i(u, v), 0)
			var up := ISO.cell_to_screen(Vector2i(u, v), 2)
			if not is_equal_approx(flat.x, up.x):
				raised_ok = false
			if not is_equal_approx(flat.y - up.y, 2 * ISO.ELEV_STEP):
				raised_ok = false
	h.check(
		"elevation moves a cell up the screen and never sideways",
		raised_ok,
		"2 steps = %.0f px up" % (2 * ISO.ELEV_STEP),
	)

	# --- neighbours are exactly one diamond apart ------------------------
	# This is what makes authored collision boxes tile without seams: adjacent
	# cells differ by a constant of the diamond, not by an accumulating error.
	var half := ISO.cell_to_screen(Vector2i(1, 0)) - ISO.cell_to_screen(Vector2i(0, 0))
	h.check(
		"+u is one half-width right and one half-height down",
		is_equal_approx(half.x, ISO.HALF_W) and is_equal_approx(half.y, ISO.HALF_H),
		"(%.1f, %.1f)" % [half.x, half.y],
	)
	var half_v := ISO.cell_to_screen(Vector2i(0, 1)) - ISO.cell_to_screen(Vector2i(0, 0))
	h.check(
		"+v is one half-width LEFT and one half-height down",
		is_equal_approx(half_v.x, -ISO.HALF_W) and is_equal_approx(half_v.y, ISO.HALF_H),
		"(%.1f, %.1f)" % [half_v.x, half_v.y],
	)

	# --- the vertices are where the projection says they are --------------
	var verts := ISO.diamond_vertices()
	h.eq("a diamond has four vertices", verts.size(), 4)
	h.check(
		"the top vertex is half a tile height up",
		verts[0] == Vector2(0.0, -ISO.HALF_H),
		str(verts[0]),
	)
	h.check(
		"the right vertex is half a tile width right",
		verts[1] == Vector2(ISO.HALF_W, 0.0),
		str(verts[1]),
	)

	# --- the two "behind" neighbours ---------------------------------------
	# "Behind" is the direction away from the camera, and it is the pair the
	# autotile coverage mask asks about. It is NOT "up the screen".
	var behind := ISO.behind_neighbours(Vector2i(5, 5))
	h.eq("behind returns two neighbours", behind.size(), 2)
	h.check(
		"both behind-neighbours are further from the camera",
		ISO.cell_to_screen(behind[0]).y < ISO.cell_to_screen(Vector2i(5, 5)).y
			and ISO.cell_to_screen(behind[1]).y < ISO.cell_to_screen(Vector2i(5, 5)).y,
		"both sort above the cell",
	)

	# --- the rounding region IS the diamond -------------------------------
	# Inverting needs no correction inside the tile's top face: any point within
	# the diamond resolves to its own cell. This replaces a check that asserted
	# the OPPOSITE — that the upper half resolves to the cell behind — which the
	# first run of this suite disproved. The property is stronger than the worry
	# was, and worth pinning precisely for that reason.
	var centre0 := ISO.cell_to_screen(Vector2i(0, 0))
	var interior_ok := true
	for probe in [
		Vector2(0.0, -ISO.HALF_H + 1.0),  # just inside the top vertex
		Vector2(ISO.HALF_W - 1.0, 0.0),  # just inside the right vertex
		Vector2(0.0, ISO.HALF_H - 1.0),  # just inside the bottom vertex
		Vector2(-ISO.HALF_W + 1.0, 0.0),  # just inside the left vertex
		Vector2(0.0, 0.0),  # the centre
	]:
		if ISO.screen_to_cell(centre0 + probe) != Vector2i(0, 0):
			interior_ok = false
	h.check(
		"every point inside a diamond resolves to that cell",
		interior_ok,
		"5 probes, including all four vertices",
	)

	# --- past a vertex, it flips -----------------------------------------
	# Screen directions, not lattice directions. Moving straight right in screen
	# space is +u and -v together, so it lands on (1,-1) whose centre is one tile
	# width to the right — which is the useful way to state it.
	h.eq(
		"past the right vertex is the cell drawn to the right",
		ISO.screen_to_cell(centre0 + Vector2(ISO.HALF_W + 2.0, 0.0)),
		Vector2i(1, -1),
	)
	h.eq(
		"past the left vertex is the cell drawn to the left",
		ISO.screen_to_cell(centre0 + Vector2(-ISO.HALF_W - 2.0, 0.0)),
		Vector2i(-1, 1),
	)
	h.eq(
		"past the bottom vertex is the cell drawn in front",
		ISO.screen_to_cell(centre0 + Vector2(0.0, ISO.HALF_H + 2.0)),
		Vector2i(1, 1),
	)

	# --- the tilemap y-sort origin -----------------------------------------
	# map_to_local() returns a tile's CENTRE, so a layer only sorts by the point
	# where a tile meets the ground if it adds half a tile height. This is
	# derived rather than documented, and the corroboration is that Godot's own
	# isometric demo uses 128x64 tiles with 32 — the same half-height rule.
	h.eq("the tile sort origin is half a tile height", ISO.TILE_SORT_ORIGIN, 16)
	h.close(
		"the sort origin lands on the tile's bottom vertex",
		float(ISO.TILE_SORT_ORIGIN),
		ISO.TILE_H / 2.0,
		0.0,
	)

	# --- the real hazard: inverting needs the elevation ------------------
	# A circularity, not a rounding quirk. The same screen point is a different
	# cell at a different elevation, which is exactly why the ground probe must
	# resolve through the level's elevation table.
	#
	# The delta has to be CELL-SIZED to show it. This used a delta of 1, which worked
	# while ELEV_STEP was 32 — one unit of elevation was then a whole cell's rise. At
	# ELEV_STEP 1 a unit is one pixel and moves nothing, so the check failed for a
	# reason that had nothing to do with the property it guards.
	var delta := int(ISO.HALF_H * 2.0)
	var raised := ISO.cell_to_screen(Vector2i(5, 5), delta)
	h.check(
		"the same screen point is a different cell at a different elevation",
		ISO.screen_to_cell(raised, 0) != ISO.screen_to_cell(raised, delta),
		"elev 0 -> %s, elev %d -> %s" % [
			str(ISO.screen_to_cell(raised, 0)), delta, str(ISO.screen_to_cell(raised, delta))
		],
	)
