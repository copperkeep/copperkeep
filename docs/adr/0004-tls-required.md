# 0004 — TLS is required, not optional

**Status:** Accepted. Reverses an earlier decision to allow plain HTTP on a family LAN.

## Context

The earlier position was that a family running this on `192.168.1.50` should not have to
deal with certificates. That was a usability judgment, and it is wrong for a technical
reason that has nothing to do with eavesdropping.

Three things this design depends on require a **secure context**:

- `SharedArrayBuffer`, and therefore `interrupt()` ([0002](0002-single-origin-ingress.md))
- Service workers, and therefore PWA install ([0010](0010-pwa-is-load-bearing.md))
- `navigator.storage.persist()`

`localhost` is a secure context. `192.168.1.50` is not.

## Decision

TLS is a Phase 1 requirement. The box has egress, so: own a domain, point an A record at
the private IP, obtain a certificate by **DNS-01 challenge**.

## Consequences

- Certificates renew over the internet; traffic never leaves the building; nothing has to
  be installed on any device. No internal CA, no per-device root certificate.
- A deployment on a bare IP over HTTP is not merely less secure — it is **functionally
  degraded**, and degraded silently. Every infinite loop kills the worker, the runtime
  re-downloads after eviction, and none of it reports an error.
- `COPPERKEEP_COOKIE_SECURE` defaults to true. Compose ships it false only because
  `localhost` is a legitimate development case, and says so in `.env.example`.
