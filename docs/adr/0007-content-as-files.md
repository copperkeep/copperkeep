# 0007 — Content is read-only files, never database rows

**Status:** Accepted

## Context

Most learning platforms put lessons in the database, usually behind an authoring UI. That
makes editing easy and makes everything else hard: rollback, review, diffing, and
reproducing a bug a learner hit last Tuesday.

## Decision

Curriculum is built into a static image and served by nginx. Postgres holds user data
only; content is never ingested. The API's one read-only dependency is the built index
(`manifest.json`, `skills.json`, `steps.json`), held in memory.

## Consequences

- **Rollback is atomic with the image.** `content:2026.09.1` is a complete, immutable
  description of what every learner saw.
- Curriculum changes go through review like code, and CI can run every reference
  solution against its own tests — the highest-value gate in the pipeline, because it
  catches a broken exercise before a child does.
- Content and app version independently: the manifest declares `minAppVersion`, checked
  by the API at startup (failing readiness, so a bad release never goes live) and by the
  SPA at boot.
- If content is unreachable the API keeps serving on its last-good copy. Learners keep
  their session; new lessons just do not load.
- The cost: editing a lesson requires a pull request. Acceptable for the author of this
  system; an authoring UI that commits to the curriculum repo is the first thing a
  business customer will ask for, and it commits *to the repo*, preserving all of the
  above.
