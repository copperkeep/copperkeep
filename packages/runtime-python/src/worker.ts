/// <reference lib="webworker" />
/**
 * Every runtime executes inside a Web Worker. Without this an infinite loop freezes the
 * main thread and interrupt() can never fire (plan §4).
 */
import { HARNESS } from "./harness.py.js";

type Incoming =
  | { id: number; type: "init"; indexUrl: string; micropipIndexUrl?: string; interruptBuffer?: Uint8Array }
  | { id: number; type: "run"; code: string; stdin?: string }
  | { id: number; type: "evaluate"; code: string; spec: unknown }
  | { id: number; type: "reset" };

interface Pyodide {
  runPython(code: string): unknown;
  globals: { get(name: string): (...args: unknown[]) => string };
  setInterruptBuffer(buffer: Uint8Array): void;
  version: string;
}

let pyodide: Pyodide | null = null;

async function init(indexUrl: string, interruptBuffer?: Uint8Array): Promise<string> {
  const module = await import(/* @vite-ignore */ `${indexUrl}pyodide.mjs`);
  pyodide = (await module.loadPyodide({ indexURL: indexUrl })) as Pyodide;

  if (interruptBuffer) {
    // Needs SharedArrayBuffer, which needs COOP/COEP. Without it the only escape from
    // `while True: pass` is terminating the worker (§4).
    pyodide.setInterruptBuffer(interruptBuffer);
  }
  pyodide.runPython(HARNESS);
  return pyodide.version;
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case "init": {
        const version = await init(message.indexUrl, message.interruptBuffer);
        self.postMessage({ id: message.id, ok: true, result: { version } });
        break;
      }
      case "run": {
        const raw = pyodide!.globals.get("ck_run")(message.code, message.stdin ?? "");
        self.postMessage({ id: message.id, ok: true, result: JSON.parse(raw) });
        break;
      }
      case "evaluate": {
        const raw = pyodide!.globals.get("ck_eval")(message.code, JSON.stringify(message.spec));
        self.postMessage({ id: message.id, ok: true, result: JSON.parse(raw) });
        break;
      }
      case "reset": {
        // Cheaper than a fresh interpreter and enough: every exec already runs in its
        // own namespace, so this only clears imports the learner left behind.
        pyodide!.runPython("import sys; [sys.modules.pop(m, None) for m in list(sys.modules) if m.startswith('__lesson')]");
        self.postMessage({ id: message.id, ok: true, result: {} });
        break;
      }
    }
  } catch (error) {
    self.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
