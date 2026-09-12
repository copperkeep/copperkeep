# 0001 — All code execution is client-side

**Status:** Accepted

## Context

A platform that runs learner code needs somewhere to run it. The conventional answer is
a server-side sandbox: a runner pool, a job queue, container isolation, and a per-user
compute cost that grows with every learner.

## Decision

All execution happens in the browser, in WebAssembly, inside a Web Worker. There is no
executor service, no sandbox hardening, and no job queue.

## Consequences

- **Zero marginal compute cost.** Thirty concurrent learners cost the server nothing;
  the only load spike is the first pull of the Pyodide bundle, and that saturates the
  access point rather than the box.
- **No sandbox to harden.** The most dangerous component in a typical design does not
  exist here.
- **Test results arrive untrusted.** The server has no execution of its own and cannot
  verify that code passed. See [0005](0005-server-authoritative-bkt.md) and
  [0006](0006-append-only-events.md): the mastery model is closed, the forged pass is
  only mitigated. Every submission is stored, so batch re-verification is possible later
  without an architectural change.
- **The runtime adapter interface becomes load-bearing.** Adding a language is a new
  adapter that passes the conformance suite, not a re-architecture — and if a compiled
  language cannot run in-browser, a server runner becomes a swappable implementation
  behind the same interface.
- **Device memory is now a real constraint.** Pyodide's baseline heap is 100-150MB. On a
  4GB Chromebook the runtime must be freed on lesson exit.
