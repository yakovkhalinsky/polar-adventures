## Capability probe: what Godot 4.7.2 actually offers, so the review is grounded.
##
##   godot --headless --path godot --script res://tools/probe_capabilities.gd
##
## Several design decisions in this port were made from second-hand reports about
## engine limitations — ghost collisions, broken isometric autotiling, no physics
## interpolation, an input edge-detection hazard. Reports age. This asks the
## engine what it has, so we author around the limitations that exist rather than
## the ones that were true two versions ago.
##
## Read-only.

extends SceneTree

## Classes whose relevant properties are worth dumping, with the substrings that
## pick them out. Unfiltered dumps are hundreds of lines and hide the answer.
const WATCHED := {
	"TileMapLayer": ["y_sort", "quadrant", "collision", "physics", "tile_set", "rendering"],
	"TileSet": ["shape", "layout", "offset", "tile_size", "terrain", "physics"],
	"CharacterBody2D": ["floor", "slide", "motion", "up_direction", "wall", "platform", "safe", "velocity"],
	"Camera2D": ["smooth", "limit", "process", "position", "ignore", "drag"],
	"CollisionShape2D": ["one_way", "disabled"],
	"CollisionObject2D": ["collision_layer", "collision_mask"],
	"CanvasItem": ["y_sort"],
}

func _initialize() -> void:
	print("godot %s" % Engine.get_version_info()["string"])

	_print_project_settings()
	_print_class_properties()
	_print_tiledata_methods()
	_print_enums()

	quit(0)

func _print_project_settings() -> void:
	print("")
	print("=== project settings: physics, interpolation, snapping ===")
	var all := ProjectSettings.get_property_list()
	var seen := {}
	for p in all:
		var key: String = p["name"]
		var interesting := (
			key.begins_with("physics/")
			or key.contains("interpolation")
			or key.contains("snap")
			or key.contains("vsync")
		)
		if not interesting or seen.has(key):
			continue
		seen[key] = true
		print("  %-58s %s" % [key, str(ProjectSettings.get_setting(key))])

func _print_class_properties() -> void:
	for cls in WATCHED:
		if not ClassDB.class_exists(cls):
			print("")
			print("=== %s: MISSING CLASS ===" % cls)
			continue
		print("")
		print("=== %s ===" % cls)
		for p in ClassDB.class_get_property_list(cls):
			var name: String = p["name"]
			var matched := false
			for needle in WATCHED[cls]:
				if name.contains(needle):
					matched = true
					break
			if not matched:
				continue
			# Defaults come from the class default instance where it exists.
			print("  %-34s %s" % [name, p.get("hint_string", "")])

func _print_tiledata_methods() -> void:
	print("")
	print("=== TileData: collision, terrain, one-way ===")
	if not ClassDB.class_exists("TileData"):
		print("  MISSING CLASS")
		return
	for m in ClassDB.class_get_method_list("TileData"):
		var name: String = m["name"]
		if (
			name.contains("collision")
			or name.contains("terrain")
			or name.contains("one_way")
			or name.contains("custom_data")
		):
			var args := PackedStringArray()
			for a in m["args"]:
				args.append(str(a["name"]))
			print("  %-40s (%s)" % [name, ", ".join(args)])

func _print_enums() -> void:
	print("")
	print("=== TileMapLayer / TileSet enums ===")
	for pair in [
		["TileMapLayer", "VisibilityMode"],
		["TileSet", "TileShape"],
		["TileSet", "TerrainMode"],
		["CharacterBody2D", "MotionMode"],
		["CharacterBody2D", "PlatformOnLeave"],
		["Camera2D", "Camera2DProcessCallback"],
		["CollisionObject2D", "DebugShape"],
	]:
		var consts := ClassDB.class_get_enum_constants(pair[0], pair[1])
		if consts.is_empty():
			print("  %s.%s: NOT FOUND" % [pair[0], pair[1]])
			continue
		var parts := PackedStringArray()
		for c in consts:
			parts.append("%s=%d" % [c, ClassDB.class_get_integer_constant(pair[0], c)])
		print("  %s.%s: %s" % [pair[0], pair[1], ", ".join(parts)])
