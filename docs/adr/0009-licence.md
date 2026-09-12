# 0009 — AGPL-3.0, with two carve-outs and a CLA

**Status:** Accepted (2026-09-12). Supersedes the open question this record previously
held, and reverses the premise that argued for it.

## Context

The platform needed a licence before the repository gained an external contributor,
because the choice is asymmetric: AGPL can later be relaxed to something permissive if
the copyright is consolidated, while a permissive licence can never be tightened over
contributions other people already made. The reversible option was the one to take while
uncertain.

The original framing weighed Apache-2.0's adoption against AGPL's protection from
someone hosting the open core as SaaS, and concluded AGPL was nearly free because the
business was **explicitly not SaaS** — a box and a curriculum subscription.

**That premise no longer holds.** Running Copperkeep as a hosted service is now a
possibility worth preserving. This does not weaken the case for AGPL; it is the
strongest argument for it, for a different reason than the one first recorded.

AGPL constrains those who *receive* the code. It does not constrain the copyright
holder, who owes nothing to a licence they granted. So the arrangement is asymmetric in
precisely the useful direction: the project can be hosted commercially, while a fork
cannot be hosted against it without publishing its changes.

## Decision

| Scope | Licence | Reason |
|---|---|---|
| Platform (everything not listed below) | **AGPL-3.0-only** | Protects the hosted option; stays OSI-approved, so schools, foundations and contributors are not excluded |
| `packages/contracts` | **Apache-2.0** | The `LanguageRuntime` interface and content schema are what a third party implements to add a language. AGPL there would discourage exactly the ecosystem the runtime adapter design exists to enable |
| Curriculum repository | **CC BY-SA 4.0** | Lessons are not software. Share-alike still prevents repackaging the content as a closed product |
| Contributions | **CLA required** | Load-bearing, not ceremony — see below |

## Why the CLA is not optional

If a contribution is merged under AGPL with no agreement, the project becomes a licensee
of that contribution. Section 13 then binds the project itself: operating the combined
work as a network service would require publishing all of it, including whatever
commercial differentiation had been built.

One merged pull request from a stranger would permanently foreclose the hosted business.
The CLA is what keeps the copyright consolidated, and with it the ability to dual-licence
— which is also the answer to a school whose procurement rules reject AGPL on sight.

## Alternatives rejected

- **Apache-2.0 throughout.** Best adoption and zero procurement friction, but it
  permanently surrenders the hosted position, and it cannot be undone once others
  contribute.
- **SSPL.** More aggressive than AGPL and aimed at exactly this concern, but it is not
  OSI-approved and carries enough reputational baggage to cost goodwill that matters more
  than the marginal protection.
- **BSL 1.1.** Honestly targeted — it can forbid competitor hosting outright rather than
  merely requiring share-alike — but it is not open source, which forfeits schools,
  foundations and casual contributors. AGPL captures most of the protection without that
  cost.

## Consequences

- Some school and district procurement teams reject AGPL without reading it. Two
  mitigations: a customer running it unmodified incurs no obligation at all, and a
  commercial licence can be sold to anyone who still objects — which works only while the
  CLA holds.
- Copyright currently rests with an individual. If this becomes a company, assign it to
  that entity and update `CLA.md`; doing it later, across many contributors, is far
  harder.
- The carve-out means two licences in one repository. `packages/contracts/LICENSE` marks
  the boundary, and it should stay narrow: interface and schema only, never
  implementation.
- None of this has been reviewed by a lawyer. It is sound enough to develop against;
  confirm it before it appears in customer-facing terms.
