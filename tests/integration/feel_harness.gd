## Feel harness: boots the real hero in a real physics world and measures it.
##
##   godot --headless --fixed-fps 60 --path . \
##     --script res://tests/integration/feel_harness.gd
##
## Exit code 0 when every check passed, 1 otherwise. This is the acceptance test
## for the movement port: the constants are only "ported" if these numbers match
## the Phaser build's, within the same tolerance bands.
##
## `--fixed-fps 60` matters. Without it a run executes an unpredictable number of
## physics steps, because the frame counter counts process iterations rather than
## physics ticks — and the whole claim that these numbers are comparable rests on
## the physics step being fixed.

extends SceneTree

const Harness := preload("res://tests/harness.gd")
const FeelDriver := preload("res://tests/integration/feel_driver.gd")

## Generous: the segments total roughly 1100 physics frames, so anything past this
## means the driver is not running at all.
const WATCHDOG_FRAMES := 5000

## A watchdog NODE, added before the driver is instantiated.
##
## This exists because of a real hang: a parse error in a depended script made
## `FeelDriver.new()` raise an invalid call, which ABORTS `_initialize` rather than
## returning null. The driver was therefore never added, nothing ever quit, and the
## run sat until an external timeout with an empty log — indistinguishable from a
## slow test. `_process` on this script is not overridden, because returning `true`
## there to end the loop discards the exit code `quit()` was given, which is how the
## main suite once reported failures while the shell saw success.
class Watchdog extends Node:
	var budget := 5000
	var _frames := 0

	func _process(_delta: float) -> void:
		_frames += 1
		if _frames > budget:
			printerr(
				"feel harness: watchdog tripped after %d frames — the driver is not running"
				% _frames
			)
			get_tree().quit(1)

var _driver: Node

func _initialize() -> void:
	print("Polar Adventures — feel measurements")
	print("godot %s" % Engine.get_version_info()["string"])
	print("")
	print("--- segments ---")

	var watchdog := Watchdog.new()
	watchdog.budget = WATCHDOG_FRAMES
	root.add_child(watchdog)

	_driver = FeelDriver.new()
	_driver.setup(Harness.new())
	root.add_child(_driver)
