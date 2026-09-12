/**
 * The adapter contract suite.
 *
 * "Adding Go is just a new adapter" is only true if there is a suite every adapter must
 * pass. This is it — and it is the real definition of LanguageRuntime; the TypeScript
 * interface only documents intent (plan §4).
 *
 * It runs against a live runtime in a real browser, because that is the only place a
 * Web Worker, SharedArrayBuffer and WASM all exist. The deployment smoke test runs it
 * against the deployed ingress, which is also how COOP/COEP get verified.
 */
import type { LanguageRuntime, TestSpec } from "@copperkeep/contracts";

export interface ConformanceCase {
  name: string;
  /** Skipped, with a reason, when the environment cannot support it. */
  requiresCrossOriginIsolation?: boolean;
  run(runtime: LanguageRuntime): Promise<void>;
}

export interface ConformanceResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  detail?: string;
  durationMs: number;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SPEC = (assertion: string): TestSpec => ({
  cases: [{ id: "case-1", assert: assertion, message: "check the value" }],
});

export const CONFORMANCE_CASES: ConformanceCase[] = [
  {
    name: "init is idempotent",
    async run(runtime) {
      await runtime.init();
      await runtime.init();
      assert(runtime.version !== "unknown", "version should be populated after init");
    },
  },
  {
    name: "run captures stdout",
    async run(runtime) {
      const result = await runtime.run("print('hello')");
      assert(result.stdout.trim() === "hello", `expected hello, got ${result.stdout}`);
      assert(result.exitCode === 0, "clean program should exit 0");
      assert(!result.timedOut, "should not report a timeout");
    },
  },
  {
    name: "run reads stdin",
    async run(runtime) {
      const result = await runtime.run("print(input().upper())", "hi");
      assert(result.stdout.trim() === "HI", `expected HI, got ${result.stdout}`);
    },
  },
  {
    name: "evaluate passes a correct solution",
    async run(runtime) {
      const result = await runtime.evaluate("total = 2 + 2", SPEC("total == 4"));
      assert(result.passed, "correct solution should pass");
      assert(result.cases[0]?.passed === true, "the case should be marked passed");
      assert(result.failureKind === undefined || result.failureKind === null, "no failure kind");
    },
  },
  {
    name: "a syntax error classifies as parse",
    async run(runtime) {
      const result = await runtime.evaluate("for i in range(3)", SPEC("True"));
      assert(!result.passed, "should not pass");
      assert(result.failureKind === "parse", `expected parse, got ${result.failureKind}`);
    },
  },
  {
    name: "an exception classifies as runtime",
    async run(runtime) {
      const result = await runtime.evaluate("1 / 0", SPEC("True"));
      assert(result.failureKind === "runtime", `expected runtime, got ${result.failureKind}`);
    },
  },
  {
    name: "a wrong answer that ran clean classifies as semantic",
    async run(runtime) {
      const result = await runtime.evaluate("total = 5", SPEC("total == 4"));
      assert(result.failureKind === "semantic", `expected semantic, got ${result.failureKind}`);
    },
  },
  {
    name: "an infinite loop classifies as timeout and the runtime survives",
    async run(runtime) {
      const result = await runtime.evaluate("while True: pass", SPEC("True"));
      assert(result.failureKind === "timeout", `expected timeout, got ${result.failureKind}`);

      // The point of the whole worker strategy: the next run still works.
      const after = await runtime.run("print('alive')");
      assert(after.stdout.trim() === "alive", "runtime should be usable after a timeout");
    },
  },
  {
    name: "interrupt stops a running program without terminating the worker",
    requiresCrossOriginIsolation: true,
    async run(runtime) {
      const running = runtime.run("while True: pass");
      setTimeout(() => runtime.interrupt(), 200);
      const result = await running;
      assert(result.exitCode !== 0 || result.timedOut, "interrupted run should not report success");

      const after = await runtime.run("print('alive')");
      assert(after.stdout.trim() === "alive", "the worker should have survived the interrupt");
    },
  },
  {
    name: "reset clears state between runs",
    async run(runtime) {
      await runtime.run("x = 41");
      await runtime.reset();
      const result = await runtime.evaluate("y = 1", SPEC("'x' not in dir()"));
      assert(result.passed, "state should not leak across runs");
    },
  },
  {
    name: "output is truncated rather than unbounded",
    async run(runtime) {
      const result = await runtime.run("print('x' * 200000)");
      assert(result.stdout.length <= 64 * 1024 + 64, "stdout should be capped at 64KB");
    },
  },
];

export async function runConformance(runtime: LanguageRuntime): Promise<ConformanceResult[]> {
  const isolated = globalThis.crossOriginIsolated === true;
  const results: ConformanceResult[] = [];

  for (const testCase of CONFORMANCE_CASES) {
    const started = performance.now();
    if (testCase.requiresCrossOriginIsolation && !isolated) {
      results.push({
        name: testCase.name,
        status: "skipped",
        detail: "crossOriginIsolated is false — check the ingress COOP/COEP headers",
        durationMs: 0,
      });
      continue;
    }
    try {
      await testCase.run(runtime);
      results.push({
        name: testCase.name,
        status: "passed",
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      results.push({
        name: testCase.name,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - started),
      });
    }
  }
  return results;
}
