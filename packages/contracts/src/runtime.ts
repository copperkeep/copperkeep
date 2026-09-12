/**
 * The contract that makes multi-language possible. Every runtime implements it;
 * nothing above it is language-aware (plan §4).
 *
 * The TypeScript here documents intent. The real definition of this interface is
 * @copperkeep/runtime-conformance — the suite every adapter must pass.
 */

export type FailureKind =
  /** syntax error — NOT a mastery opportunity */
  | "parse"
  /** exception at run time — reduced weight */
  | "runtime"
  /** ran clean, failed tests — the real signal */
  | "semantic"
  | "timeout";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export interface TestCase {
  id: string;
  /** Expression evaluated after the learner's code; truthy means passed. */
  assert?: string;
  /** Or: run with this stdin and compare stdout. */
  stdin?: string;
  expectedStdout?: string;
  /** Learner-facing, reading-tier aware. Never a stack trace at grade3. */
  message: string;
}

export interface TestSpec {
  cases: TestCase[];
  timeoutMs?: number;
}

export interface EvalCaseResult {
  id: string;
  passed: boolean;
  expected?: string;
  actual?: string;
  message: string;
}

export interface EvalResult {
  passed: boolean;
  /** Required when passed is false. */
  failureKind?: FailureKind;
  cases: EvalCaseResult[];
  durationMs: number;
}

export interface LanguageRuntime {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;

  /** Load WASM, warm up. Safe to call twice. */
  init(): Promise<void>;
  run(code: string, stdin?: string): Promise<RunResult>;
  evaluate(code: string, spec: TestSpec): Promise<EvalResult>;
  /** Infinite-loop escape. Must be available at all times. */
  interrupt(): void;
  /** Clear interpreter state between runs. */
  reset(): Promise<void>;
  dispose(): void;
}

/** absent is the ordinary first-run path, not an error branch. */
export type LoaderState = "absent" | "fetching" | "ready";

export interface LoaderProgress {
  state: LoaderState;
  receivedBytes?: number;
  totalBytes?: number;
}

/** Hard caps enforced by the host, not the runtime. */
export const RUNTIME_LIMITS = {
  wallClockMs: 5_000,
  maxOutputBytes: 64 * 1024,
} as const;
