# 0010 — PWA install is load-bearing, not cosmetic

**Status:** Accepted. Reverses the earlier rationale that the PWA existed for fullscreen
tablet mode.

## Context

The design leans on Cache Storage for Pyodide (~10MB gzipped) and narration audio. Both
Safari and Chromium evict script-writable storage — Safari after roughly a week of
inactivity, Chromium under disk pressure. On shared 32GB classroom tablets this is
routine, not an edge case.

The failure mode is not one slow learner. It is **25 tablets cold-fetching Pyodide
simultaneously at the start of a class**, which saturates the access point rather than
the server.

## Decision

The PWA exists to obtain persistent storage. `navigator.storage.persist()` is called
after the first successful lesson, and installed apps are granted persistence far more
readily than tabs.

## Consequences

- PWA install moves from a nice-to-have to something an instructor should be told to do
  on each device.
- Cache state belongs in the instructor view, so a cold classroom is visible before the
  period starts rather than during it.
- Runtime assets are versioned by path, so a content release never invalidates the
  Pyodide cache.
- Persistence needs a secure context, which is one of the three reasons for
  [0004](0004-tls-required.md).
- The loader stays a three-state machine — `absent → fetching → ready` — in which
  *absent* is the ordinary first-run path. An eviction is then indistinguishable from a
  new device and reuses the same progress UI: no cache-miss error branch to write, and
  none to forget to test.
