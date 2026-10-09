## Checks on the project settings.
##
## These exist because a Godot project file is rewritten by the editor, and a
## silent change to any of these changes how the game looks or feels with
## nothing erroring. The Phaser build had the same class of hazard — `pixelArt:
## true` expanded into three settings, one of which (`roundPixels`) defaults to
## FALSE in v4, so setting `antialias: false` by hand and assuming you were done
## left the pixels unrounded.
##
## Anything not asserted here is printed by tools/probe_settings.gd.

extends RefCounted

func _want(h, key: String, expected: Variant) -> void:
	var actual: Variant = ProjectSettings.get_setting(key)
	h.eq(key, actual, expected)

func run(h) -> void:
	# --- the pixel-scale contract ------------------------------------------
	_want(h, "display/window/size/viewport_width", 960)
	_want(h, "display/window/size/viewport_height", 540)
	_want(h, "display/window/stretch/mode", "canvas_items")
	_want(h, "display/window/stretch/aspect", "keep")
	# Defaults to "fractional". Asserted because the failure is silent and
	# aesthetic: a fractional scale resamples art the project claims is never
	# resampled, and it only shows at window sizes that are not whole multiples.
	_want(h, "display/window/stretch/scale_mode", "integer")

	# --- the integrator ----------------------------------------------------
	# Same rate as the Phaser build, which is what makes the measured 415.9px
	# apex reproducible and therefore worth asserting.
	_want(h, "physics/common/physics_ticks_per_second", 60)
	# Default 0.5 smooths motion across frames. That is directly opposed to
	# measuring anything, so it is asserted rather than left to a default.
	_want(h, "physics/common/physics_jitter_fix", 0.0)
	# Default 980. Asserted zero because gravity is per-body: two of them, rise
	# and fall, and a world default would be a third nobody asked for.
	_want(h, "physics/2d/default_gravity", 0)

	# --- pixel art, not a smooth illustration ------------------------------
	# gl_compatibility is also the only renderer that can export to the web.
	_want(h, "rendering/renderer/rendering_method", "gl_compatibility")
	_want(h, "rendering/textures/canvas_textures/default_texture_filter", 0)
	_want(h, "rendering/2d/snap/snap_2d_transforms_to_pixel", true)
	# Asserted FALSE on purpose. The docs advise against this one and it is
	# unsupported alongside the transform snap above — and "both true" is the
	# tempting wrong answer, so the suite has to hold the line.
	_want(h, "rendering/2d/snap/snap_2d_vertices_to_pixel", false)
