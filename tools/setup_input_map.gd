## Adds the game's input actions to project.godot and saves it.
##
##   godot --headless --path . --script res://tools/setup_input_map.gd
##
## WHY NOT `InputMap.add_action()`: that was the first version, and it failed
## silently. It called `InputMap.add_action()` then `ProjectSettings.save()`, got
## `OK` back, and persisted **nothing** — the actions worked for the rest of that
## process and were gone on the next run. Writing the settings directly is what
## round-trips, and this script now reads its own output back out of the settings
## afterwards, so success is observed rather than assumed.
##
## WHY A SCRIPT AT ALL: Godot's `InputEventKey` serialisation is version-sensitive
## (`key_label` and `location` moved between 4.x releases), so a hand-written entry
## that is wrong takes the whole project file down at parse time.
##
## PHYSICAL keycodes, not `keycode`, so WASD lands on the same physical keys
## regardless of keyboard layout — with `keycode`, an AZERTY player's forward key
## moves. (And the editor rewrites project.godot without preserving comments, so
## this reasoning lives here rather than beside the setting it explains.)
##
## Idempotent: re-running replaces the bindings rather than duplicating them.

extends SceneTree

const ACTIONS := {
	"move_left": [KEY_LEFT, KEY_A],
	"move_right": [KEY_RIGHT, KEY_D],
	"move_up": [KEY_UP, KEY_W],
	"move_down": [KEY_DOWN, KEY_S],
	# Jump no longer takes ArrowUp. The arrow keys drive movement now, and one key cannot
	# be two actions without the player jumping every time they walk up-screen.
	"jump": [KEY_SPACE, KEY_Z, KEY_X],
	"debug_toggle": [KEY_F1],
}

func _initialize() -> void:
	var all_ok := true

	# Typed loop variables throughout: iterating a Dictionary yields Variants, and
	# `:=` cannot infer through them. The first version of this file failed to
	# parse for exactly that reason.
	for action in ACTIONS.keys():
		var action_name: String = str(action)
		var keys: Array = ACTIONS[action]
		var events: Array = []
		for keycode in keys:
			var ev := InputEventKey.new()
			ev.physical_keycode = int(keycode)
			events.append(ev)
		ProjectSettings.set_setting(
			"input/" + action_name, {"deadzone": 0.2, "events": events}
		)

	var err: int = ProjectSettings.save()
	print("ProjectSettings.save() -> %s" % error_string(err))
	if err != OK:
		all_ok = false

	print("")
	print("read back from ProjectSettings:")
	for action in ACTIONS.keys():
		var action_name: String = str(action)
		var stored: Variant = ProjectSettings.get_setting("input/" + action_name)
		var count: int = 0
		if stored is Dictionary:
			count = (stored["events"] as Array).size()
		var expected: int = (ACTIONS[action] as Array).size()
		var ok: bool = count == expected
		if not ok:
			all_ok = false
		print(
			"  %-14s %d binding(s)  %s" % [action_name, count, "ok" if ok else "MISSING"]
		)

	quit(0 if all_ok else 1)
