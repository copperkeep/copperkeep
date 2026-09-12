# Install

Two shapes, same images, same configuration names.

| Scenario | Shape |
|---|---|
| Family or single classroom | Docker Compose on one box |
| Tutoring center wanting resilience | k3s or Talos, the Helm chart |

## Before you start: TLS

This is not a polish item. Three things need a **secure context**, and a private IP over
HTTP is not one:

- `SharedArrayBuffer`, and so the escape from an infinite loop
- Service workers, and so PWA install
- `navigator.storage.persist()`

Without them the system still appears to work and is quietly degraded. The route that
costs nothing at a customer site:

1. Own a domain.
2. Point an A record at the private IP (`learn.example.com → 192.168.1.50`). This is a
   public DNS record for a private address, which is fine.
3. Issue the certificate by **DNS-01 challenge** — cert-manager with your DNS provider,
   or `certbot --preferred-challenges dns`.

Certificates renew over the internet; traffic never leaves the building; nothing is
installed on any device. No internal CA, no root certificate on twenty tablets.

## Helm

```sh
helm install copperkeep oci://ghcr.io/copperkeep/charts/copperkeep \
  --version 0.1.0 \
  --namespace copperkeep --create-namespace \
  --set ingress.host=learn.example.com \
  --set ingress.tls.secretName=copperkeep-tls
```

Read the first-run notes the chart prints. They tell you how to get the generated admin
password, and the three things to verify.

### Postgres modes

```sh
--set postgres.mode=embedded    # default: StatefulSet + PVC + nightly pg_dump
--set postgres.mode=operator    # CloudNativePG; set postgres.externalUrlSecret
--set postgres.mode=external    # managed instance; set postgres.externalUrl
```

`embedded` is correct for a family or one classroom. An operator to manage one database
on one node is upside down, and `embedded` exists so the restore path is something you
understand.

`operator` and `external` render no Postgres templates at all.

### The optional tutor

Off by default and **not deployed** when disabled.

```sh
--set tutor.enabled=true \
--set tutor.baseUrl=http://ollama.ai.svc:11434/v1 \
--set tutor.model=qwen2.5-coder:7b
```

Two things to know before you do:

- The N100 that comfortably serves this application **cannot run a useful model.** Local
  inference means a GPU in the box or a separate inference host on the LAN.
- The service measures its endpoint's p95 at startup and refuses to enable guidance if it
  exceeds the timeout budget, logging why. That is by design, not a fault.

A cloud endpoint sends learner code to a third party and ends the "student data never
leaves your building" claim. It is an explicit admin choice, and for a school it is a
contractual question rather than a checkbox.

## Compose

See `deploy/compose/README.md`.

## Verify before handing it to a learner

1. Open `https://learn.example.com/#conformance` and run the suite. Every case should
   pass. If `crossOriginIsolated` is false, something in front of the web service is
   stripping COOP/COEP — `--set ingress.crossOriginIsolationHeaders=true` if your
   controller is ingress-nginx, otherwise fix the proxy.
2. Sign in as the bootstrap adult and create a learner.
3. Follow [backup-restore.md](backup-restore.md) once, on this machine, before you need
   it.
