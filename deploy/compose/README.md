# Compose deployment

```sh
cp .env.example .env     # set POSTGRES_PASSWORD, COPPERKEEP_SESSION_SECRET, COPPERKEEP_ADMIN_TOKEN
docker compose pull
docker compose up -d
open http://localhost:8443
```

Then open `http://localhost:8443/#conformance` and run the runtime suite. If
`crossOriginIsolated` is false, something is stripping COOP/COEP and `interrupt()`
cannot work.

## What to know

- **One published port.** Everything else is path-routed behind the proxy. Publishing a
  second browser-facing port breaks cross-origin isolation and reintroduces CORS.
- **`localhost` is a secure context; a LAN IP is not.** Testing on the box itself over
  plain HTTP works. The moment a tablet on the network reaches this, you need TLS and
  `COPPERKEEP_COOKIE_SECURE=true` — see `docs/operations/install.md` for the DNS-01
  route, which gets you a real certificate without installing anything on any device.
- **Do not use Watchtower.** An auto-update landing mid-lesson is a bad experience.
  Upgrade deliberately: `docker compose pull && docker compose up -d`.
- **Back up.** Nothing here dumps the database on a schedule; the chart does. On
  Compose, run `pg_dump` from cron on the host and follow
  `docs/operations/backup-restore.md` once before you need it.
