# Decision records

A table of decisions has the right shape but loses the reasoning behind each row, and
loses it exactly when you need it: on reversal.

Three decisions in this design were already reversed during review — Redis, TLS, and
the PWA's purpose. An ADR records a reversal as a **new record superseding the old
one**, leaving both readable. A table row edited in place loses the fact that anyone
ever thought otherwise, and why.

Write one whenever a choice would be expensive to revisit or surprising to a newcomer.
Not every commit; roughly the granularity of the decisions table in
`../architecture/plan.md` §18.

| # | Decision | Status |
|---|---|---|
| [0001](0001-client-side-execution.md) | All code execution is client-side | Accepted |
| [0002](0002-single-origin-ingress.md) | One public origin, path-routed | Accepted |
| [0003](0003-no-redis.md) | No Redis; Postgres holds sessions, counters and the hint cache | Accepted |
| [0004](0004-tls-required.md) | TLS is required, not optional | Accepted, reverses an earlier allowance |
| [0005](0005-server-authoritative-bkt.md) | BKT runs server-side only | Accepted |
| [0006](0006-append-only-events.md) | Progress is an append-only event log | Accepted |
| [0007](0007-content-as-files.md) | Content is read-only files, never database rows | Accepted |
| [0008](0008-chart-in-repo.md) | One chart, in this repo, versioned with the app | Accepted |
| [0009](0009-licence.md) | Open-source licence | **Open** |
| [0010](0010-pwa-is-load-bearing.md) | PWA install is load-bearing, not cosmetic | Accepted, reverses an earlier rationale |
