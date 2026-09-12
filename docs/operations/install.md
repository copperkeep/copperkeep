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

## If TLS is terminated in front of the cluster

A reverse proxy, a load balancer or Cloudflare doing the certificate is fine — the
secure context is judged on what the *browser* sees, not on where TLS ends.

```sh
helm install copperkeep oci://ghcr.io/copperkeep/charts/copperkeep \
  --set ingress.host=learn.example.com \
  --set ingress.className=traefik \
  --set ingress.tls.enabled=false \
  --set api.cookieSecure=true
```

`api.cookieSecure` is the part people miss. It defaults to `ingress.tls.enabled`, which
is right when TLS ends at the ingress and exactly wrong when it ends in front of it:
without setting it, every session cookie silently loses its Secure flag while the
browser is still on HTTPS.

Two things to check afterwards, because both fail quietly:

- **The isolation headers reach the browser.** They are set by the web service on the
  document, and nginx-family proxies pass them through, but verify rather than assume:

  ```sh
  curl -sI https://learn.example.com | grep -i cross-origin
  ```

  You want `same-origin` and `require-corp`. Then open `/#conformance` and confirm it
  reports `crossOriginIsolated: true`.

- **All five paths reach the right service.** If you replace the chart's Ingress with a
  hand-written IngressRoute, it has to route `/v1`, `/content`, `/audio`, `/runtimes`
  and `/` — miss one and the origin is split, which kills isolation and reintroduces
  CORS. The chart's own Ingress already does this and works with k3s Traefik via
  `ingress.className=traefik`, which is fewer moving parts.

And note that Let's Encrypt cannot reach a private IP, so the certificate needs a
**DNS-01** challenge wherever you terminate.

## Helm

```sh
helm install copperkeep oci://ghcr.io/copperkeep/charts/copperkeep \
  --version 0.1.5 \
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
