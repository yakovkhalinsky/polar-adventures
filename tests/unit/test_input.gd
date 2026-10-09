## Checks on the input map.
##
## These exist because the input map failed silently once already: a setup script
## called `InputMap.add_action()` and `ProjectSettings.save()`, got `OK` back, and
## persisted nothing. The actions worked for the rest of that process and were gone
## on the next run — so a hero reading them would simply not respond, with no error
## anywhere until somebody played the game.
##
## The bindings are asserted, not just the action names: an action that exists with
## no events is just as dead, and presents identically — "the key does nothing".

extends RefCounted

const EXPECTED := {
	"move_left": [KEY_LEFT, KEY_A],
	"move_right": [KEY_RIGHT, KEY_D],
	"move_up": [KEY_UP, KEY_W],
	"move_down": [KEY_DOWN, KEY_S],
	"jump": [KEY_SPACE, KEY_Z, KEY_X],
	"debug_toggle": [KEY_F1],
}

func run(h) -> void:
	for action in EXPECTED:
		var events := InputMap.action_get_events(action)
		h.check(
			"the '%s' action exists" % action,
			InputMap.has_action(action),
			"%d binding(s)" % events.size(),
		)

		# Compared as a set: the order bindings happen to be stored in is not
		# part of the contract.
		var bound: Array = []
		for ev in events:
			if ev is InputEventKey:
				bound.append(ev.physical_keycode)
		bound.sort()
		var want: Array = EXPECTED[action].duplicate()
		want.sort()
		h.check(
			"'%s' is bound to the expected keys" % action,
			bound == want,
			"%s" % str(bound),
		)
