## Checks on the harness itself.
##
## A suite that cannot report failure is worse than no suite, and this one already
## shipped that bug once: the runner returned `true` from `_process()` alongside
## `quit()`, which discarded the exit code, so a run with a failing check exited
## 0. The symptom was a suite printing "1 of 32 checks FAILED" while the shell saw
## success — a green pipeline over a red game.
##
## That specific bug lived in the runner and cannot be seen from in here. But the
## rule it broke can be pinned down: report() must return non-zero when a check
## failed. The runner's own process exit code is verified from the shell instead,
## by running the suite and reading $?.

extends RefCounted

const Harness := preload("res://tests/harness.gd")

func run(h) -> void:
	# --- a passing check is not counted as a failure ------------------------
	var passing = Harness.new()
	passing.check("a passing check", true, "")
	h.eq("a passing check increments the total", passing.total(), 1)
	h.eq("a passing check leaves zero failures", passing.failed(), 0)
	h.eq("report() is 0 when everything passed", passing.report("", true), 0)

	# --- a failing check IS counted, and report() says so -------------------
	var failing = Harness.new()
	failing.check("a failing check", false, "")
	h.eq("a failing check is counted", failing.failed(), 1)
	h.eq("report() is 1 when a check failed", failing.report("", true), 1)

	# --- the tolerance logic every numeric check depends on -----------------
	# close() is what ~20 of the movement checks are built on, so its boundary
	# behaviour is worth asserting rather than assuming.
	var inside = Harness.new()
	inside.close("just inside tolerance", 1.0005, 1.0, 0.001)
	h.eq("close() passes inside the tolerance", inside.failed(), 0)

	var outside = Harness.new()
	outside.close("just outside tolerance", 1.002, 1.0, 0.001)
	h.eq("close() fails outside the tolerance", outside.failed(), 1)

	var exactly = Harness.new()
	exactly.close("exactly the tolerance", 1.001, 1.0, 0.001)
	h.eq("close() passes exactly AT the tolerance (inclusive)", exactly.failed(), 0)

	# --- a mixed run counts only the failures ------------------------------
	var mixed = Harness.new()
	mixed.check("one", true, "")
	mixed.check("two", false, "")
	mixed.check("three", false, "")
	mixed.check("four", true, "")
	h.eq("a mixed run counts exactly its failures", mixed.failed(), 2)
	h.eq("a mixed run counts all its checks", mixed.total(), 4)
