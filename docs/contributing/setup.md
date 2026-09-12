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

## A note on the lockfile

`pnpm-lock.yaml` is not committed yet — it needs a machine with pnpm to generate. Run
`pnpm install` and commit the result; CI currently installs with `--no-frozen-lockfile`
and should be tightened to `--frozen-lockfile` once the lockfile lands.
