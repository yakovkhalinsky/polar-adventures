## Height-field probe: does the (u, v, height) model carry the movement?
##
##   godot --headless --fixed-fps 60 --path godot \
##     --script res://test/integration/height_probe.gd
##
## Exit code 0 when every check passed, 1 otherwise.
##
## `--fixed-fps 60` matters for the same reason it does in the feel harness: the apex
## check is a measurement of a fixed-step integrator, and without it the run executes an
## unpredictable number of physics steps and the number means nothing.

extends SceneTree

const Harness := preload("res://test/harness.gd")
const HeightDriver := preload("res://test/integration/height_driver.gd")

class Watchdog extends Node:
	var budget := 1200
	var _frames := 0

	func _process(_delta: float) -> void:
		_frames += 1
		if _frames > budget:
			printerr("height probe: watchdog tripped — the driver is not running")
			get_tree().quit(1)


func _initialize() -> void:
	print("Polar Adventures — height-field probe")
	print("godot %s" % Engine.get_version_info()["string"])
	print("")
	print("--- phases ---")

	var watchdog := Watchdog.new()
	root.add_child(watchdog)

	var driver := HeightDriver.new()
	driver.setup(Harness.new())
	root.add_child(driver)
