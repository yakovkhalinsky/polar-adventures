## The reporting harness.
##
## Deliberately not a test framework. The Phaser build's suites were hand-rolled
## too, and the report shape is the point of them: dump the measured value on
## EVERY line, pass or fail, so a regression is self-diagnosing rather than a
## bare "expected true, got false". There is no fail-fast — one run reports
## every regression.

extends RefCounted

var _results: Array[Dictionary] = []

## A named boolean with a detail string. Prefer one of the helpers below when
## the check is numeric — the detail is where the value goes.
func check(check_name: String, ok: bool, detail: String = "") -> void:
	_results.append({"name": check_name, "ok": ok, "detail": detail})

## Equality with the measured value always shown.
func eq(check_name: String, actual: Variant, expected: Variant) -> void:
	check(check_name, actual == expected, "%s (expected %s)" % [str(actual), str(expected)])

## Numeric equality within a tolerance, with both numbers shown.
func close(check_name: String, actual: float, expected: float, tol: float) -> void:
	check(
		check_name,
		absf(actual - expected) <= tol,
		"%.4f (expected %.4f +/- %.4f)" % [actual, expected, tol]
	)

func total() -> int:
	return _results.size()

func failed() -> int:
	var n := 0
	for r in _results:
		if not r["ok"]:
			n += 1
	return n

## Print the artefact dump, then the checks, then the summary. Returns the
## process exit code: 0 when everything passed, 1 otherwise.
##
## `quiet` suppresses the printing while still returning the code, so the
## harness's own behaviour can be checked without its output being mistaken for
## the real suite's.
func report(title: String, quiet: bool = false) -> int:
	if quiet:
		return 0 if failed() == 0 else 1
	print("")
	print("--- %s ---" % title)
	for r in _results:
		print(
			"  %s  %-56s %s" % ["PASS" if r["ok"] else "FAIL", r["name"], r["detail"]]
		)
	print("")
	if failed() == 0:
		print("all %d checks passed" % total())
		return 0
	print("%d of %d checks FAILED" % [failed(), total()])
	return 1
