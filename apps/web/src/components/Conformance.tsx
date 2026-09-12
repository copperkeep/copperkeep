import { useState } from "react";
import type { LanguageRuntime } from "@copperkeep/contracts";
import { runConformance, type ConformanceResult } from "@copperkeep/runtime-conformance";

/**
 * The adapter contract suite, run against the live runtime in a real browser.
 *
 * This page is also how the deployment smoke test verifies cross-origin isolation: if
 * the ingress drops the COOP/COEP headers, the interrupt case reports "skipped" and CI
 * fails on it. That is the one thing that silently disables interrupt() in production.
 */
export function Conformance({ runtime }: { runtime: LanguageRuntime | null }) {
  const [results, setResults] = useState<ConformanceResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!runtime) return;
    setBusy(true);
    try {
      setResults(await runConformance(runtime));
    } finally {
      setBusy(false);
    }
  }

  const failed = results?.filter((r) => r.status !== "passed").length ?? 0;

  return (
    <section className="card" data-testid="conformance">
      <div className="kicker">
        <span className="label">Runtime conformance</span>
      </div>
      <h2 className="display">
        The adapter <span className="hl">contract</span>
      </h2>
      <p className="lede">
        crossOriginIsolated is{" "}
        <strong data-testid="cross-origin-isolated">{String(globalThis.crossOriginIsolated)}</strong>
        . Without it, interrupt() falls back to terminating the worker.
      </p>

      <div className="btns">
        <button className="tap tap--primary" onClick={go} disabled={busy || !runtime}>
          {busy ? "Running…" : "Run the suite"}
        </button>
      </div>

      {results && (
        <>
          <table className="data" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Case</th>
                <th>Result</th>
                <th>ms</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.name}>
                  <td>{result.name}</td>
                  <td
                    style={{
                      color:
                        result.status === "passed"
                          ? "var(--accent)"
                          : result.status === "skipped"
                            ? "var(--accent-warn)"
                            : "var(--accent-hot)",
                    }}
                  >
                    {result.status}
                    {result.detail ? ` — ${result.detail}` : ""}
                  </td>
                  <td className="mono">{result.durationMs}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note" data-testid="conformance-summary">
            {failed === 0 ? "conformance:ok" : `conformance:failed:${failed}`}
          </p>
        </>
      )}
    </section>
  );
}
