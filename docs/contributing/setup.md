# Development setup

Node 22 + pnpm 9, Python 3.12+, Docker.

```sh
pnpm install
make dev          # postgres + api + the web dev server
```

The Vite dev server sets the same COOP/COEP headers the deployed web service does and
proxies every path to one origin. Developing against a second origin would make
`crossOriginIsolated` false locally and true in production — the one difference you do
not want to find in Phase 5.

## The pieces

| Path | What |
|---|---|
| `apps/web` | The SPA. Vite + React + CodeMirror 6. |
| `apps/api` | FastAPI. The only service with database credentials. |
| `apps/tutor` | Optional LLM service. Off by default. |
| `packages/contracts` | Shared TypeScript types. Change here, and `api` and `web` change in the same commit. |
| `packages/runtime-python` | The Pyodide adapter. |
| `packages/runtime-conformance` | The suite every adapter must pass. |
| `packages/ui` | `tokens.css` and `components.css`. |
| `images/` | nginx configs and Dockerfiles for the static services. |
| `deploy/` | Compose and the Helm chart. |

## Conventions that are enforced, not remembered

- **A component that names a hex is a bug.** `scripts/check-contrast.mjs` runs in CI and
  measures every token against every ground it is specified for.
- **No external URLs in the bundle.** `scripts/check-determinism.sh` fails the build on
  one. Under `require-corp` such a subresource fails silently in the browser, which is
  what makes this load-bearing rather than tidy.
- **The chart renders deterministically.** `scripts/helm-golden.sh` diffs every Postgres
  mode and tutor state against committed output. Run `make helm-golden` to accept an
  intended change.
- **Path-filtered CI.** Touching `apps/api` does not rebuild the web bundle.

## Adding a language runtime

1. Implement `LanguageRuntime` from `@copperkeep/contracts`.
2. Make it pass `@copperkeep/runtime-conformance` in a real browser — including
   `interrupt()` under `while True: pass`, every `FailureKind` classification, and
   surviving a timeout.
3. Nothing above the adapter is language-aware. If you find yourself editing `apps/web`
   to add a language, the interface is wrong and that is worth fixing first.

## Browser tests

```sh
cd e2e && pnpm exec playwright install --with-deps chromium   # once
make e2e                                    # against the local Compose stack
make e2e BASE=https://copperkeep.example.com    # against a deployed instance
```

These exist because every user-visible bug this project has shipped lived in a layer the
API-level smoke test cannot see, and each one was found by a person using the app rather
than by CI:

| What shipped | Why the tests missed it |
|---|---|
| Run and Check silently did nothing | The runtime was disposed the moment it was stored. The conformance page hid it — its first case calls `init()`, rebuilding the worker |
| `/content` 404'd through the chart's Ingress | Both smoke proxies stripped path prefixes, and k3d installed with `ingress.enabled=false`, so the real Ingress was never under test |
| An infinite loop scored as a runtime error | No automated run had ever let the wall clock expire in a browser with working `SharedArrayBuffer` |
| Most of the curriculum was unreachable | Nothing ever finished a lesson |

Each spec now names the bug it guards. When adding one, prefer asserting what a learner
sees — output text, a graded row, a way forward — over internal state.

Note the default target is `http://localhost:8443`. `localhost` is a secure context even
over plain HTTP, so `SharedArrayBuffer` is available and `interrupt()` is genuinely
exercised rather than skipped.

## Testing

```sh
make test          # API unit tests + the contrast check
make lint
make typecheck
make smoke         # Compose, end to end
```

The runtime conformance suite needs a browser: open `/#conformance` against a running
instance. CI runs it against the deployed ingress, which is also how COOP/COEP get
verified.
