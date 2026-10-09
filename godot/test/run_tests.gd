## Headless entry point.
##
##   godot --headless --path godot --script res://test/run_tests.gd
##
## Exit code 0 when every check passed, 1 otherwise, so CI can gate on it.
##
## THREE THINGS ABOUT THIS COMMAND LINE, all measured rather than assumed:
##
## 1. `--fixed-fps 60` is not optional when anything samples frames. `--quit-after
##    N` counts idle/process iterations, NOT physics ticks — without `--fixed-fps`
##    a run can execute a third as many physics steps as it looks like it did, and
##    a suite that silently measures 11 frames instead of 30 produces
##    plausible-looking wrong numbers. With `--fixed-fps 60` and `--quit-after
##    200`, exactly 200 physics ticks run and the state is bit-identical across
##    runs.
##
## 2. `--script` is editor-build only (availability class X: "only available in
##    editor builds, and export templates compiled with disable_path_overrides=
##    false"). This harness therefore runs from the editor binary and will NOT run
##    from a release export template. CI has to be arranged around that, not
##    assume it away.
##
## 3. Do not reach for `--write-movie` to capture evidence headlessly. It crashes
##    in 4.7.2 — signal 11, exit 134, zero-byte output — reproduced twice.
##
## Deliberately not GUT. The Phaser build's suites were hand-rolled and their
## report shape is the asset: the measured value on every line, pass or fail, no
## fail-fast, a count summary, a non-zero exit. A framework would impose its own
## output format and lose that.

extends SceneTree

const Harness := preload("res://test/harness.gd")
const TestHarness := preload("res://test/checks/test_harness.gd")
const TestHeroLogic := preload("res://test/checks/test_hero_logic.gd")
const TestInput := preload("res://test/checks/test_input.gd")
const TestIsoGeometry := preload("res://test/checks/test_iso_geometry.gd")
const TestLevelFormat := preload("res://test/checks/test_level_format.gd")
const TestMovement := preload("res://test/checks/test_movement.gd")
const TestSettings := preload("res://test/checks/test_settings.gd")

var _exit_code := 1


## Quits the process if the suite does not finish.
##
## An error inside `_initialize` ABORTS it, and if that happens before `quit()` the main
## loop runs forever with nothing left to stop it. That has now happened three times in
## this project — the feel harness, the art build, and here — and every time it presented
## as a slow or hung test rather than as the compile failure it was, because the buffered
## output only flushes on exit. A dependency failing to compile is the usual cause.
class Watchdog extends Node:
	var budget := 900
	var _frames := 0

	func _process(_delta: float) -> void:
		_frames += 1
		if _frames > budget:
			printerr("run_tests: watchdog tripped — the suite did not finish its work")
			get_tree().quit(1)


func _initialize() -> void:
	# Added FIRST, so it is already running if anything below aborts.
	root.add_child(Watchdog.new())

	print("Polar Adventures — headless checks")
	print("godot %s" % Engine.get_version_info()["string"])

	# The tuning readout, printed the way the Phaser build printed it on boot.
	# It exists so the constants and the code cannot drift apart; the suite then
	# asserts the same numbers it just printed.
	print("")
	print("--- tuning ---")
	for line in Movement.readout_lines():
		print("  %s" % line)

	var h = Harness.new()
	TestHarness.new().run(h)
	TestMovement.new().run(h)
	TestHeroLogic.new().run(h)
	TestIsoGeometry.new().run(h)
	TestLevelFormat.new().run(h)
	TestInput.new().run(h)
	TestSettings.new().run(h)
	_exit_code = h.report("checks")
	quit(_exit_code)

## NOT overridden deliberately. An earlier version also returned `true` here as a
## belt-and-braces way to end the loop — and it made every run exit 0, because
## ending the loop that way discards the code `quit()` was given. Caught by the
## suite reporting "1 of 32 checks FAILED" while the shell saw exit 0, which is
## exactly the failure a CI gate cannot afford: green pipeline, red game.
##
## If a future Godot stops honouring `quit()` from `_initialize`, the fix is to
## move this work into `_process` and return true AFTER calling quit() — not to
## return true alongside it.
