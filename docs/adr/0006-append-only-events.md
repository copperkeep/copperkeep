# 0006 — Progress is an append-only event log

**Status:** Accepted

## Context

The obvious model is a `progress` table updated in place: current score per skill,
current lesson, current state. It is smaller and simpler right up to the first time you
change a rule.

BKT parameters are guesses until there is real data. The skill ontology will split and
merge skills. Both are certainties, not risks.

## Decision

`progress_events` is append-only and never mutated. `skill_state` is a **cache** —
truncate it and rebuild from the log at any time (`POST /v1/admin/learners/:id/recompute`).

## Consequences

- Retuning BKT parameters is a replay, not a migration.
- An ontology split (`for-loop-range` → `for-loop-iteration` + `range-generator`) is a
  mapping applied at projection time. Historical events keep their original IDs forever;
  nothing is rewritten.
- Parent reports are a projection rather than a feature needing its own storage, and a
  learner's code from three weeks ago is free.
- `failure_kind` is a real column rather than a `payload` key, because every projection
  branches on it and a replay should not parse JSON in the hot path.
- The cost is storage and the discipline of never issuing an `UPDATE` against the log.
  At this scale the storage is irrelevant.
- It also means **skill and step IDs are a public contract**. They are opaque strings in
  the log; renaming one silently orphans every historical event. CI enforces that.
