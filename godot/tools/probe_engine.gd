## Phase 0c/0b probe: ask the engine, instead of guessing from the docs.
##
##   godot --headless --path godot --script res://tools/probe_engine.gd
##
## The Godot tutorial pages do NOT state the exact TileSet tile-shape enum, the
## terrain-set mode enum, or `local_to_map`/`map_to_local`'s signatures — and
## they give no guidance at all on which terrain mode suits isometric. Rather
## than assume, this reads them out of ClassDB.
##
## It also dumps every project setting whose name looks like it might be
## version-sensitive, so a setting this project relies on but which does not
## exist in 4.7 shows up as MISSING rather than as a silently-ignored line in
## project.godot.
##
## Read-only. Nothing here modifies the project.

extends SceneTree

const M := preload("res://scripts/config/movement.gd")

## Project settings worth confirming exist, because the plan depends on them and
## their names are not stable across 4.x.
const WATCHED_SETTINGS := [
	"display/window/size/viewport_width",
	"display/window/size/viewport_height",
	"display/window/stretch/mode",
	"display/window/stretch/aspect",
	"display/window/stretch/scale_mode",
	"display/window/stretch/scale",
	"physics/common/physics_ticks_per_second",
	"rendering/renderer/rendering_method",
	"rendering/textures/canvas_textures/default_texture_filter",
	"rendering/2d/snap/snap_2d_transforms_to_pixel",
	"rendering/2d/snap/snap_2d_vertices_to_pixel",
]

## Classes and the enum members we need to name exactly.
const WATCHED_ENUMS := {
	"TileSet": ["TileShape", "TileLayout", "TileOffsetAxis", "TerrainMode"],
	"TileMapLayer": [],
	"TileData": [],
}

func _initialize() -> void:
	print("=== engine ===")
	var v: Dictionary = Engine.get_version_info()
	print("  version   %s" % v["string"])
	print("  major.minor %d.%d" % [v["major"], v["minor"]])

	_print_tuning()

	print("")
	print("=== tile enum constants (the docs do not name these) ===")
	for cls in WATCHED_ENUMS:
		if not ClassDB.class_exists(cls):
			print("  %-14s MISSING CLASS" % cls)
			continue
		for enum_name in WATCHED_ENUMS[cls]:
			var consts := ClassDB.class_get_enum_constants(cls, enum_name)
			if consts.is_empty():
				print("  %s.%s: NOT FOUND" % [cls, enum_name])
			else:
				var parts := PackedStringArray()
				for c in consts:
					parts.append("%s=%d" % [c, ClassDB.class_get_integer_constant(cls, c)])
				print("  %s.%s" % [cls, enum_name])
				print("      %s" % ", ".join(parts))

	print("")
	print("=== TileMapLayer coordinate conversion ===")
	for method in [
		"local_to_map",
		"map_to_local",
		"get_cell_source_id",
		"get_cell_atlas_coords",
		"get_used_cells",
	]:
		if not ClassDB.class_has_method("TileMapLayer", method):
			print("  %-24s NOT FOUND" % method)
			continue
		print(
			"  %-24s %d args" % [
				method, ClassDB.class_get_method_argument_count("TileMapLayer", method)
			]
		)

	print("")
	print("=== watched project settings ===")
	var all := ProjectSettings.get_property_list()
	var known := {}
	for p in all:
		known[p["name"]] = p
	for key in WATCHED_SETTINGS:
		if known.has(key):
			print("  %-56s %s" % [key, str(ProjectSettings.get_setting(key))])
		else:
			print("  %-56s MISSING IN THIS VERSION" % key)

	print("")
	print("=== stretch-related settings that DO exist ===")
	for key in known:
		if String(key).begins_with("display/window/stretch"):
			print(
				"  %-56s %s   hint: %s" % [
					key, str(ProjectSettings.get_setting(key)), known[key].get("hint_string", "")
				]
			)

	quit(0)

func _print_tuning() -> void:
	print("")
	print("=== tuning readout (ported from the Phaser build's boot print) ===")
	for line in M.readout_lines():
		print("  %s" % line)

func _process(_delta: float) -> bool:
	return true
