# Copperkeep

Self-hosted, browser-based platform for teaching programming. All code execution
happens client-side in WebAssembly; the server holds user data only.

Full design: [`docs/architecture/plan.md`](docs/architecture/plan.md).

## What ships

| Image | Built from | Contents |
|---|---|---|
| `ghcr.io/copperkeep/web` | `apps/web` | nginx + the SPA bundle |
| `ghcr.io/copperkeep/api` | `apps/api` | FastAPI — the only service with database credentials |
| `ghcr.io/copperkeep/runtimes` | `images/runtimes` | nginx + Pyodide + vendored wheels |
| `ghcr.io/copperkeep/tutor` | `apps/tutor` | optional LLM guidance service, off by default |
| `ghcr.io/copperkeep/content` | [`copperkeep/curriculum`](https://github.com/copperkeep/curriculum) | nginx + built lesson JSON |
| `ghcr.io/copperkeep/audio` | [`copperkeep/curriculum`](https://github.com/copperkeep/curriculum) | nginx + narration `.ogg` |

All images are multi-arch (`linux/amd64`, `linux/arm64`).

## Deploy

### Helm (k3s, Talos, any cluster)

```sh
helm install copperkeep oci://ghcr.io/copperkeep/charts/copperkeep \
  --version 0.1.1 \
  --namespace copperkeep --create-namespace \
  --set ingress.host=learn.example.com
```

The chart's values are the application's configuration surface — see
[`deploy/helm/copperkeep/values.yaml`](deploy/helm/copperkeep/values.yaml) and
[`docs/operations/install.md`](docs/operations/install.md).

### Docker Compose (one box)

```sh
cd deploy/compose
cp .env.example .env      # set COPPERKEEP_SESSION_SECRET and POSTGRES_PASSWORD
docker compose pull
docker compose up -d
```

Both paths render the same `/config.json` contract and use the same environment
variable names. CI stands up both and runs one smoke test against each.

## Single origin, always

Everything is served from one origin, path-routed:

```
/            web        SPA
/content/    content    lesson JSON
/audio/      audio      narration
/runtimes/   runtimes   Pyodide + wheels
/v1/         api        the only dynamic surface
```

This is not cosmetic. `interrupt()` needs `SharedArrayBuffer`, which needs
`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`.
Publishing a second port to the browser breaks it. See
[`docs/adr/0002-single-origin-ingress.md`](docs/adr/0002-single-origin-ingress.md).

TLS is required, not optional — `SharedArrayBuffer`, service workers and
`navigator.storage.persist()` all need a secure context, and a private IP over HTTP
is not one.

## Develop

Requires Node 22 + pnpm 9, Python 3.12+, and Docker.

```sh
make dev             # postgres + api + web dev server
make typecheck test  # everything
make images          # build all images locally
make helm-lint helm-template
```

Layout follows `docs/architecture/plan.md` §10.2. The curriculum lives in its own repo
because it has its own cadence, its own CI, and eventually non-engineer authors;
everything else stays together so a contract change is one atomic commit.

## Licence

**AGPL-3.0-only**, with two deliberate exceptions:

- [`packages/contracts`](packages/contracts) is **Apache-2.0** — it is the interface and
  schema a third party implements to add a language, and copyleft there would discourage
  that.
- The [curriculum](https://github.com/copperkeep/curriculum) is **CC BY-SA 4.0**. Lessons
  are not software.

Contributions require agreeing to [`CLA.md`](CLA.md). That keeps the copyright
consolidated, which is what allows dual-licensing for organisations whose procurement
rules reject AGPL. The reasoning, including a reversal, is in
[`docs/adr/0009-licence.md`](docs/adr/0009-licence.md).

Copyright (C) 2026 Jeffrey Chin.
