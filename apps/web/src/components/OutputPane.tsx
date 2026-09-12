import type { EvalResult, RunResult } from "@copperkeep/contracts";

/**
 * Test cases in plain language, never stack traces. The pass/fail colours here are the
 * terminal's own accents because this panel is dark in both themes.
 */
export function OutputPane({
  run,
  evaluation,
}: {
  run: RunResult | null;
  evaluation: EvalResult | null;
}) {
  if (!run && !evaluation) {
    return (
      <div className="out">
        <span className="label">Output</span>
        <p className="note" style={{ marginTop: 8 }}>
          Press Run to see what your program does.
        </p>
      </div>
    );
  }

  return (
    <>
      {run && (
        <div className="out">
          <span className="label">Output</span>
          <div style={{ marginTop: 8 }}>{run.stdout || <em>(nothing printed)</em>}</div>
          {run.stderr && <div style={{ marginTop: 8, color: "#f0466e" }}>{run.stderr}</div>}
        </div>
      )}

      {evaluation && (
        <div className="out">
          <span className="label">Checks</span>
          <div style={{ marginTop: 8 }}>
            {evaluation.cases.map((testCase) => (
              <div className="test-row" key={testCase.id}>
                <span className="name">{testCase.message || testCase.id}</span>
                <span className={testCase.passed ? "pass" : "fail"}>
                  {testCase.passed ? "passed" : "failed"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
