# 0005 — BKT runs server-side only

**Status:** Accepted

## Context

Mastery is estimated with Bayesian Knowledge Tracing. Roughly thirty lines of arithmetic.
It could run in the browser for an instant skill map, in the API for authority, or in
both with the client optimistic.

## Decision

The API is the sole evaluator. It applies the posterior, writes `skill_state`, and
decides what unlocks. The client renders what it is told and never computes mastery.

## Consequences

- **No two implementations to keep in step.** A TypeScript copy and a Python copy would
  have to agree to the decimal or the skill map visibly corrects itself, and keeping them
  aligned needs a shared test-vector suite maintained forever.
- **Nothing is lost.** The round trip is 5-20ms on a LAN, and the feedback that must feel
  instant — the test result — is already local. A skill map that updates a beat later is
  imperceptible.
- A learner cannot edit their own skill graph. That closes tampering with the mastery
  model; it does not close a forged test result, which no server-side check can settle
  without server-side execution.
- If this ever runs over a WAN, optimistic UI becomes the right call. It is not today.
- Parameters (`pInit`, `pLearn`, `pSlip` per skill; `pGuess` derived from the item) are
  content, not code, so retuning them is a curriculum release plus a replay — see
  [0006](0006-append-only-events.md).
