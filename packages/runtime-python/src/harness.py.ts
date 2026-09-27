/**
 * The Python side of the adapter, injected into the interpreter once at init.
 *
 * Test evaluation lives here rather than in JS so that a test case is an ordinary
 * Python expression evaluated in the learner's own namespace — which is what makes
 * `tests.yaml` readable to a curriculum author who is not a programmer.
 */
export const HARNESS = String.raw`
import io, json, sys, traceback

def _classify(exc):
    if isinstance(exc, (SyntaxError, IndentationError)):
        return "parse"
    # An interrupt means the program did not finish on its own. Calling that a runtime
    # error would feed it into the mastery estimate, which is exactly what a timeout is
    # defined not to do.
    if isinstance(exc, KeyboardInterrupt):
        return "timeout"
    return "runtime"

def _friendly(exc):
    """Plain language, never a raw traceback at grade3. The prose tier is applied by
    the caller; this only removes the frames a beginner cannot act on."""
    name = type(exc).__name__
    detail = str(exc)
    if isinstance(exc, SyntaxError):
        line = exc.lineno or 1
        return "There is a typo on line %d that Python could not read." % line
    if isinstance(exc, NameError):
        return "%s" % detail
    if isinstance(exc, ZeroDivisionError):
        return "Something was divided by zero."
    if isinstance(exc, KeyboardInterrupt):
        return "Your program never finished."
    return "%s: %s" % (name, detail) if detail else name

def _exec(code, stdin_text):
    """Runs the learner's code in a fresh namespace and captures stdout."""
    namespace = {"__name__": "__main__"}
    out, err = io.StringIO(), io.StringIO()
    old = (sys.stdout, sys.stderr, sys.stdin)
    sys.stdout, sys.stderr, sys.stdin = out, err, io.StringIO(stdin_text or "")
    try:
        exec(compile(code, "<lesson>", "exec"), namespace)
        failure = None
    except BaseException as exc:  # KeyboardInterrupt included: an interrupt is a result
        failure = {"kind": _classify(exc), "message": _friendly(exc),
                   "trace": traceback.format_exc()}
    finally:
        sys.stdout, sys.stderr, sys.stdin = old
    return namespace, out.getvalue(), err.getvalue(), failure

def ck_run(code, stdin_text):
    _, stdout, stderr, failure = _exec(code, stdin_text)
    if failure:
        stderr = (stderr + "\n" + failure["message"]).strip()
    return json.dumps({
        "stdout": stdout,
        "stderr": stderr,
        "exitCode": 1 if failure else 0,
        "failureKind": failure["kind"] if failure else None,
    })

def _all_failed(spec_cases, failure):
    """A program that never ran cleanly cannot tell us anything about the skill, so the
    cases are not even attempted."""
    return json.dumps({
        "passed": False,
        "failureKind": failure["kind"],
        "cases": [{"id": c.get("id", "?"), "passed": False,
                   "message": failure["message"]} for c in spec_cases],
    })

def ck_eval(code, spec_json):
    spec = json.loads(spec_json)
    spec_cases = spec.get("cases", [])

    # A case that brings its own stdin gets a run of its own. The shared, input-less run
    # exists only for the cases without stdin — a program that calls input() must never
    # be judged by a run that had nothing to give it, or every such exercise fails with
    # EOFError before a single case is looked at.
    shared = None
    if not spec_cases or any(not c.get("stdin") for c in spec_cases):
        shared = _exec(code, "")
        if shared[3]:
            return _all_failed(spec_cases, shared[3])

    cases = []
    run_failure = None
    for case in spec_cases:
        expected = actual = None
        if case.get("stdin"):
            namespace, stdout, _stderr, failure = _exec(code, case["stdin"])
            if failure:
                # A syntax error fails identically on every input, and after a timeout
                # the remaining runs are not worth the wall clock.
                if failure["kind"] in ("parse", "timeout"):
                    return _all_failed(spec_cases, failure)
                run_failure = run_failure or failure
                cases.append({"id": case["id"], "passed": False,
                              "message": failure["message"]})
                continue
        else:
            namespace, stdout = shared[0], shared[1]
        try:
            if "assert" in case and case["assert"]:
                passed = bool(eval(case["assert"], dict(namespace)))
                expected = "true"
                actual = "true" if passed else "false"
            else:
                expected = case.get("expectedStdout", "")
                actual = stdout
                passed = stdout.strip() == expected.strip()
        except BaseException as exc:
            cases.append({"id": case["id"], "passed": False, "message": _friendly(exc)})
            continue

        cases.append({"id": case["id"], "passed": passed, "expected": expected,
                      "actual": actual, "message": case.get("message", "")})

    passed = all(c["passed"] for c in cases) and len(cases) > 0
    if passed:
        kind = None
    elif run_failure:
        # It crashed on at least one input: not a clean run, so not the full signal.
        kind = run_failure["kind"]
    else:
        # Ran clean and failed the tests: the real signal (§6.2).
        kind = "semantic"
    return json.dumps({"passed": passed, "failureKind": kind, "cases": cases})
`;
