import {
  RUNTIME_LIMITS,
  type EvalResult,
  type LanguageRuntime,
  type LoaderProgress,
  type RunResult,
  type TestSpec,
} from "@copperkeep/contracts";

export interface PythonRuntimeOptions {
  /** Served from the runtimes image, versioned by path so a content release never
   * invalidates the Pyodide cache. */
  indexUrl: string;
  onProgress?: (progress: LoaderProgress) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

class WorkerHandle {
  readonly worker: Worker;
  readonly pending = new Map<number, Pending>();
  #nextId = 1;
  ready: Promise<{ version: string }>;

  constructor(indexUrl: string, interruptBuffer: Uint8Array | null) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent) => {
      const { id, ok, result, error } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      ok ? pending.resolve(result) : pending.reject(new Error(error));
    };
    this.ready = this.send("init", { indexUrl, interruptBuffer }) as Promise<{ version: string }>;
  }

  send(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  terminate(): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error("worker terminated"));
    }
    this.pending.clear();
    this.worker.terminate();
  }
}

const truncate = (text: string) =>
  text.length > RUNTIME_LIMITS.maxOutputBytes
    ? `${text.slice(0, RUNTIME_LIMITS.maxOutputBytes)}\n… output truncated`
    : text;

export class PythonRuntime implements LanguageRuntime {
  readonly id = "python";
  readonly displayName = "Python";
  version = "unknown";

  #options: PythonRuntimeOptions;
  #handle: WorkerHandle | null = null;
  /** An 8-year-old writes accidental infinite loops constantly. Re-initialising Pyodide
   * on a budget Chromebook is 5-12 seconds, so this path is hot, not exceptional. */
  #spare: WorkerHandle | null = null;
  #interruptBuffer: Uint8Array | null = null;

  constructor(options: PythonRuntimeOptions) {
    this.#options = options;
  }

  get crossOriginIsolated(): boolean {
    return typeof globalThis.crossOriginIsolated === "boolean" && globalThis.crossOriginIsolated;
  }

  async init(): Promise<void> {
    if (this.#handle) return;

    if (this.crossOriginIsolated) {
      this.#interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
    } else {
      console.warn(
        "crossOriginIsolated is false: SharedArrayBuffer is unavailable, so interrupt() " +
          "falls back to terminating the worker. Check the ingress COOP/COEP headers.",
      );
    }

    this.#options.onProgress?.({ state: "fetching" });
    this.#handle = new WorkerHandle(this.#options.indexUrl, this.#interruptBuffer);
    const { version } = await this.#handle.ready;
    this.version = version;
    this.#options.onProgress?.({ state: "ready" });
    this.#warmSpare();
  }

  #warmSpare(): void {
    if (this.#spare) return;
    const spare = new WorkerHandle(this.#options.indexUrl, this.#interruptBuffer);
    spare.ready.then(
      () => {
        this.#spare = spare;
      },
      () => spare.terminate(),
    );
  }

  /** Promote the pre-warmed spare so the learner sees ~0s instead of a cold start. */
  #promoteSpare(): void {
    this.#handle?.terminate();
    this.#handle = this.#spare;
    this.#spare = null;
    if (!this.#handle) {
      this.#handle = new WorkerHandle(this.#options.indexUrl, this.#interruptBuffer);
    }
    this.#warmSpare();
  }

  async #call<T>(type: string, payload: Record<string, unknown>): Promise<T | "timeout"> {
    if (!this.#handle) throw new Error("runtime not initialised");
    const handle = this.#handle;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let interruptedByTimeout = false;

    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        // Already answered: there is nothing to interrupt, and a run that finished just
        // under the wire must not be reported as a timeout.
        if (handle.pending.size === 0) return;

        interruptedByTimeout = true;
        this.interrupt();
        // Give the interrupt a moment to land before the blunt instrument.
        setTimeout(() => {
          if (this.#handle === handle && handle.pending.size > 0) this.#promoteSpare();
          resolve("timeout");
        }, 300);
      }, RUNTIME_LIMITS.wallClockMs);
    });

    try {
      const result = await Promise.race([handle.send(type, payload) as Promise<T>, timeout]);
      // The wall clock is the host's to enforce, so if we stopped the program it timed
      // out — whichever promise happened to settle first. Without this the interrupt
      // lands, Python raises KeyboardInterrupt, and the worker's own reply wins the race
      // and reports a runtime error. That difference is not cosmetic: a timeout feeds
      // the mastery estimate nothing, while a runtime error feeds it at reduced weight,
      // so every accidental infinite loop would count against the learner.
      return interruptedByTimeout ? ("timeout" as unknown as T) : (result as T);
    } finally {
      clearTimeout(timer);
    }
  }

  async run(code: string, stdin?: string): Promise<RunResult> {
    const started = performance.now();
    const result = await this.#call<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>("run", { code, stdin });
    const durationMs = Math.round(performance.now() - started);

    if (result === "timeout") {
      return {
        stdout: "",
        stderr: "Your program never finished.",
        exitCode: 1,
        durationMs,
        timedOut: true,
      };
    }
    return {
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
      exitCode: result.exitCode,
      durationMs,
      timedOut: false,
    };
  }

  async evaluate(code: string, spec: TestSpec): Promise<EvalResult> {
    const started = performance.now();
    const result = await this.#call<Omit<EvalResult, "durationMs">>("evaluate", { code, spec });
    const durationMs = Math.round(performance.now() - started);

    if (result === "timeout") {
      return {
        passed: false,
        failureKind: "timeout",
        cases: spec.cases.map((c) => ({
          id: c.id,
          passed: false,
          message: "Your program never finished.",
        })),
        durationMs,
      };
    }
    return { ...result, durationMs };
  }

  interrupt(): void {
    if (this.#interruptBuffer) {
      this.#interruptBuffer[0] = 2; // SIGINT
      return;
    }
    this.#promoteSpare();
  }

  async reset(): Promise<void> {
    if (this.#interruptBuffer) this.#interruptBuffer[0] = 0;
    await this.#handle?.send("reset");
  }

  dispose(): void {
    // Pyodide's baseline heap is 100-150MB. On a 4GB Chromebook it must not sit
    // alongside the next lesson's audio buffers.
    this.#handle?.terminate();
    this.#spare?.terminate();
    this.#handle = null;
    this.#spare = null;
  }
}

export const createPythonRuntime = (options: PythonRuntimeOptions): LanguageRuntime =>
  new PythonRuntime(options);
