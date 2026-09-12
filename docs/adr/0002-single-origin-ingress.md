# 0002 — One public origin, path-routed

**Status:** Accepted

## Context

Five services face the browser: the SPA, lesson JSON, narration audio, WASM runtimes and
the API. The obvious shape is one hostname or port each.

`interrupt()` — the escape from `while True: pass` — needs `SharedArrayBuffer`, which
needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
require-corp`. Under `require-corp`, every cross-origin subresource must send
`Cross-Origin-Resource-Policy`.

## Decision

Everything is served from a single origin, path-routed: `/` web, `/content/`, `/audio/`,
`/runtimes/`, `/v1/` api. The services stay separately imaged, versioned and rolled back;
only the public origin is shared.

The isolation headers are set by the **web service on the document it serves**, not by
ingress annotations. Traefik needs a Middleware CRD and ingress-nginx needs a snippet;
putting the headers in the image that serves the HTML works identically under Helm,
Compose and `vite dev`.

## Consequences

- Cross-origin isolation is achievable, so `interrupt()` works and an infinite loop does
  not cost a 5-12 second Pyodide restart.
- CORS disappears entirely — no preflights, no allowlists, no per-environment origin
  config — and session cookies are CSRF-safe without tokens.
- One certificate, one Ingress, one hostname for an on-premise admin to manage.
- **Publishing a second browser-facing port silently breaks this.** There is no error;
  `crossOriginIsolated` just becomes false and every infinite loop takes the
  worker-termination path. CI asserts the headers on every deployment change, and the
  `/#conformance` page reports it in the browser.
- Any external subresource in lesson content now fails silently rather than merely being
  wrong, which is why the curriculum pipeline rejects them outright.
