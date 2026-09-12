# Copperkeep — Architecture & Design Plan

**Version:** 0.6
**Date:** 2026-09-11
**Status:** Design settled; Phase 0 spike is the next action
**Repo:** `github.com/copperkeep/copperkeep` · curriculum in `github.com/copperkeep/curriculum` (§10)

---

## 1. Summary

Copperkeep is a self-hosted, browser-based platform for teaching programming,
starting with Python
(Sections A, B, C) and designed to add more languages (Go next) without re-architecture.

Three things define this system and drive every decision below:

1. **All code execution happens client-side in WebAssembly.** There is no server-side
   sandbox, no runner pool, no job queue.
2. **It runs on-premise on a private network.** The infrastructure may pull images over
   the internet, but the application is never externally accessible and student data
   never leaves the building.
3. **Progression is gated on demonstrated mastery, not lesson completion.** A learner
   advances when a skill model says they hold the prerequisite skills.

Secondary goals: usable by an 8-year-old without adult supervision, collects zero PII,
and is structured so it can later be open-sourced, sold as an on-premise appliance to
tutoring centers and schools, or both.

---

## 2. Design principles

| Principle | Consequence |
|---|---|
| Execution is client-side | No executor service, no sandbox hardening, no per-user compute cost |
| Content is read-only files, never database rows | Curriculum rollback is atomic with the image |
| User data is the only state | One stateful component: Postgres |
| Identity is local and minimal | No email, no IdP, no PII |
| Mastery gates branch, never lock | A stuck learner always has a door, just not the forward one |
| Reading level is a schema field | Same skills, same tests, different words |
| AI assists, never authors | Generated hints are validated against authored content, never a substitute for it |
| Defer every optional subsystem | Ship the seam, not the implementation |

---

## 3. Architecture

### 3.1 Topology

```
                  ┌───────────────┐   ┌──────────────────┐
  Browser ───────►│   ingress     ├──►│  web (nginx)     │  /          SPA
  (ONE origin)    │  (one origin, │   ├──────────────────┤
                  │   path-routed)│──►│  content (nginx) │  /content/  JSON
                  │               │   ├──────────────────┤
                  │  COOP/COEP +  │──►│  audio (nginx)   │  /audio/    .ogg
                  │  CORP headers │   ├──────────────────┤
                  │               │──►│  runtimes (nginx)│  /runtimes/ WASM
                  │               │   ├──────────────────┤   ┌────────────┐
                  │               │──►│  api (FastAPI)   ├──►│ PostgreSQL │
                  └───────────────┘   └──────────────────┘   └────────────┘
```

Five images. Four of them are nginx serving static files. One is an application.
Only the API talks to Postgres.

**Everything is served from a single origin**, path-routed at the ingress. The
services stay separately imaged, versioned and rolled back — only the public origin is
shared. This is not cosmetic:

- **Cross-origin isolation becomes achievable.** `interrupt()` needs
  `SharedArrayBuffer` (§4), which needs `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`. Under `require-corp` every
  cross-origin subresource must send `Cross-Origin-Resource-Policy`. One origin makes
  that a non-issue; separate origins or ports make it a permanent tax.
- **CORS disappears entirely** — no preflights, no allowlists, no per-environment
  origin config.
- **One certificate, one Ingress, one hostname** for an on-premise admin to manage.

In Compose the same shape holds with a small reverse proxy in front. Do not publish
four ports.

The optional `tutor` service (§19) is not in the diagram because it is never
reachable from the browser: the API calls it over the cluster network, and it is
absent from the deployment when disabled.

### 3.2 Services

**`web`** — nginx + static SPA bundle (Vite build, no SSR).
Fetches `/config.json` at boot for all backend URLs. Stateless, any replica count.

**`content`** — nginx serving pre-built JSON. Course trees, lesson prose (all reading
tiers), exercise definitions, test specs, hints, skill tags. No application logic, no
database connection. Versioned and rolled back independently of everything else.

**`audio`** — nginx serving pre-generated `.ogg` narration. Split from `content`
because audio will be 50–200MB against ~2MB of JSON; a prose typo fix should not
re-pull the entire narration corpus.

**`runtimes`** — nginx serving WASM language runtimes. Pyodide today (~10MB gz),
additional runtimes added as separate directories. Long cache headers; downloaded once
per device, then served from Cache Storage.

**`api`** — FastAPI, distroless image, ~80MB. Owns: authentication and sessions,
progress event ingestion, **the BKT evaluator and all gating decisions** (§6.1),
parent report projection, admin and roster management. The only service with
database credentials.

The API has one read-only dependency on `content`: at startup (and on config
reload) it fetches `manifest.json` and `skills.yaml` and holds them in memory. It
needs them to validate events (§7.4) and compute prerequisites. If `content` is
unreachable it keeps serving on the last-good copy — this is the mechanism behind
coupling rule 7 (§9.1). It never reads lesson prose or tests.

**`tutor`** *(optional, off by default)* — stateless FastAPI service holding the
OpenAI-compatible LLM connection and prompt templates. Not deployed at all when
disabled. No database access. See §19.

**`postgres`** — the sole stateful component. Three deployment modes (§9.3).

### 3.3 API surface

The complete browser-facing contract, all under `/v1/`. Everything else is static.

| Route | Purpose | Notes |
|---|---|---|
| `POST /v1/auth/login` | PIN / picture / password / QR token | Throttled per account (§7.4) |
| `POST /v1/auth/logout` | Revoke session | |
| `GET  /v1/me` | Identity, role, reading tier, owned learners | |
| `POST /v1/events` | **Batched** progress events | Validated, quota-limited, returns updated `skill_state` deltas |
| `POST /v1/submissions` | Code + client eval result | Stored verbatim; referenced by `step_completed` |
| `GET  /v1/skills` | Learner's `skill_state` and unlock set | The only source of truth for the skill map |
| `GET  /v1/reviews/due` | Spaced-review queue | |
| `POST /v1/hint` | Request AI guidance | Only when §19 enabled; returns validated hint or `204` |
| `GET  /v1/reports/:learner` | Parent / instructor projection | Guardianship-checked |
| `/v1/admin/*` | Orgs, cohorts, join codes, learner reset, unlock | Adult role only |
| `GET  /healthz`, `/metrics` | Liveness, Prometheus | |

Sessions are `httpOnly`, `Secure`, `SameSite=Strict` cookies. The single origin (§3.1)
makes this CSRF-safe without tokens. `POST /v1/events` accepts a batch so that a burst
of client telemetry is one request, not twenty.

The `/v1/` prefix costs nothing today. It exists so that an SIS or LTI integration a
school asks for later can land as `/v2/` without touching the SPA, and so the API can
keep serving a pinned older SPA during a rolling upgrade. `/healthz` and `/metrics`
stay unversioned by convention.

### 3.4 What was deliberately excluded

- **SSR framework** — no SEO need, all users authenticated, all work client-side.
- **Redis/Valkey** — no job queue (no executor), sessions fit in Postgres, and the
  throttling in §7.4 fits in a table at this scale. *Note: an earlier draft justified
  this with "rate limiting is moot on a LAN." That was wrong — the LAN is where the
  attacker sits. Throttling is mandatory; it just does not need Redis.*
- **Identity provider (Keycloak/Authentik/Zitadel)** — no email, no OAuth, no
  federation, no reset flows. Local auth behind a swappable interface instead.
- **Service mesh** — a handful of services on one node; mTLS between them is theater.
- **Argo CD as default** — a GitOps control plane for one app at a customer site is
  upside down. Renovate + `helm upgrade` in CI is sufficient.
- **Observability stack as default** — Prometheus + Grafana + Loki would outweigh the
  application. Expose `/metrics` and structured logs; ship no stack.

---

## 4. Language runtime adapter

The contract that makes multi-language possible. Every runtime implements it; nothing
above it is language-aware.

```ts
interface LanguageRuntime {
  id: string;                  // "python", "go"
  displayName: string;
  version: string;

  init(): Promise<void>;                       // load WASM, warm up
  run(code: string, stdin?: string): Promise<RunResult>;
  evaluate(code: string, spec: TestSpec): Promise<EvalResult>;
  interrupt(): void;                           // infinite-loop escape
  reset(): Promise<void>;                      // clear interpreter state
  dispose(): void;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

type FailureKind =
  | "parse"      // syntax error — NOT a mastery opportunity (§6.2)
  | "runtime"    // exception at run time — reduced weight
  | "semantic"   // ran clean, failed tests — the real signal
  | "timeout";

interface EvalResult {
  passed: boolean;
  failureKind?: FailureKind;   // required when passed is false
  cases: Array<{
    id: string;
    passed: boolean;
    expected?: string;
    actual?: string;
    message: string;        // learner-facing, reading-tier aware
  }>;
}
```

**Implementation requirements:**

- Every runtime executes inside a **Web Worker**. Without this an infinite loop freezes
  the main thread and `interrupt()` can never fire.
- **`interrupt()` requires cross-origin isolation.** Pyodide's `setInterruptBuffer`
  needs `SharedArrayBuffer`, which needs COOP `same-origin` + COEP `require-corp`.
  This is the reason for the single-origin ingress in §3.1. Verify it in Phase 1 —
  `crossOriginIsolated === true` in the console — not in Phase 5.
- **Keep a pre-warmed spare worker.** When isolation is unavailable or an interrupt
  fails, the fallback is `worker.terminate()`, and re-initialising Pyodide on a budget
  Chromebook is 5–12 seconds. Promote the spare immediately and rebuild it in the
  background, so the learner sees ~0s instead. An 8-year-old writes accidental
  infinite loops constantly; this path is hot, not exceptional.
- Runtimes are **lazy-loaded** on first use, with an explicit "Downloading Python…"
  first-run state and a progress bar. Cached in Cache Storage thereafter (§12.4).
- **Cache Storage is a pure optimization, never a dependency.** The loader is one state
  machine — `absent → fetching → ready` — in which *absent* is the ordinary first-run
  path. Eviction (routine on WebKit, and on any device under flash pressure) is then
  indistinguishable from a new device and reuses the same progress UI. There is no
  cache-miss error branch to write, and none to forget to test.
- **Budget for memory, not just download.** Pyodide's baseline heap is roughly
  100–150MB and grows as stdlib modules load. On a 4GB Chromebook running CodeMirror,
  audio, and Pyodide together, the browser will evict workers under pressure. Free the
  runtime on lesson exit, avoid holding audio buffers alongside an active interpreter,
  and measure on the worst device you expect to support.
- Hard caps enforced by the host, not the runtime: 5s wall clock, output truncated at
  64KB, interrupt available at all times.

**Python:** Pyodide. Mature, MPL-2.0, pure-Python wheels via micropip.

micropip resolves against PyPI by default, which is an external fetch and therefore
blocked by design (§11.2). Every wheel Section C needs is **vendored into the
`runtimes` image** under `/runtimes/wheels/`, and micropip's index URL is pointed
there via `/config.json`. The allowed package list is part of the curriculum
manifest, so CI can fail on a lesson that imports something not shipped.

**Go (future):** `yaegi` compiled `GOOS=js GOARCH=wasm` is the most promising path —
it is a pure-Go interpreter, so it can run client-side. TinyGo compiles ahead of time
and needs a server; full `go build` in-browser is not realistic today.

Concurrency is *not* the blocker: Go's wasm target already schedules goroutines
cooperatively on a single thread, so goroutines and channels behave correctly. What is
lost is parallelism, which Go never guaranteed. The real gaps are the missing
toolchain — no modules, no `go build`, no `go test` — plus yaegi's stdlib and generics
coverage. For Go specifically the tooling is a substantial part of learning the
language, which is what makes this a genuine spike rather than a formality.

**Contract test suite.** "Adding Go is just a new adapter" is only true if there
is a suite every adapter must pass — `init`, `run`, `evaluate`, `interrupt` under
`while True: pass`, timeout, `reset` between runs, stdout capture, and every
`FailureKind` classification with a fixture that provokes it. Write it against
Pyodide in Phase 1. It is the real definition of this interface; the TypeScript
above documents intent.

> **Action item:** spike yaegi-in-WASM before committing publicly to "all languages,
> in-browser." If it does not hold up, the fallback is browser-only for interpreted
> languages and a server runner for compiled ones — which this interface makes a
> swappable implementation, not a redesign.

---

## 5. Content model

### 5.1 Hierarchy

```
Course (Python A)
└── Module (Loops)
    └── Lesson (Repeating with for)
        └── Step (one screen, one interaction)
```

### 5.2 Step types

| Type | Interaction | Primary use |
|---|---|---|
| `narrative` | Read / listen | Introduce a concept |
| `predict` | Choose the output of shown code | Kills tweak-until-green |
| `parsons` | Drag code lines into order (with distractors) | No-typing on-ramp; hard to brute force |
| `fill-blank` | Complete a partial program | Bridge from parsons to free code |
| `free-code` | Write from scratch, graded by tests | Real practice |
| `explain-back` | "Which line makes this repeat?" against own code | Understanding signal |
| `project` | Multi-file, open-ended, rubric or test graded | End of module |

`transfer` is **not** a step type. It is a per-step flag — `transferFor:
[for-loop-range]` — marking a step as a visibly different problem shape for a
skill already taught. Any type can carry it; `free-code` and `fill-blank` usually
do. §6.3 explains why it is the strongest single signal.

**Blockly is not in scope.** The platform is text-only. Parsons problems provide the
no-typing, no-syntax-error scaffolding while keeping real Python on screen from the
first lesson.

### 5.3 Repository layout

```
curriculum/
├── manifest.yaml                    # version, minAppVersion, course list
├── skills.yaml                      # skill registry — the ID contract
└── courses/
    └── python-a/
        ├── course.yaml
        └── modules/
            └── 03-loops/
                ├── module.yaml
                └── lessons/
                    └── 02-for-range/
                        ├── lesson.yaml
                        └── steps/
                            └── 04-count-to-ten/
                                ├── meta.yaml
                                ├── prose.grade3.mdx
                                ├── prose.grade7.mdx
                                ├── prose.adult.mdx
                                ├── starter.py
                                ├── solution.py
                                └── tests.yaml
```

### 5.4 Step metadata

```yaml
# meta.yaml
id: py.loops.for-range.count-ten      # STABLE — never rename, never reuse
type: free-code
skills:
  - id: for-loop-range
    weight: primary
  - id: print-output
    weight: supporting
prerequisites: [variables-assign, int-literals]
estimatedMinutes: 4
aiGuidance: allow                     # allow | suppress — see §19.2
transferFor: []                       # skills this step is a transfer item for
hints:
  - afterSemanticFailures: 2          # parse/runtime errors do not count (§6.2)
    tier: grade3
    text: "Remember, range(10) counts 0 to 9."
  - afterSemanticFailures: 4
    tier: grade3
    text: "Try starting your line with: for i in range"
audio:
  grade3: audio/py/loops/for-range/count-ten.grade3.ogg
```

### 5.5 Stable ID contract

Because content versions move independently of user data, **skill IDs and step IDs are
a public contract**. Progress events store them as opaque strings. Renaming
`for-loop-range` to `loops-range` silently orphans every historical event — mastery
estimates reset and parent reports go blank.

**Enforced in CI:**
- IDs are never renamed and never reused.
- Removal requires a deprecation alias in `skills.yaml`.
- The build fails if an ID present in the previous release disappears without one.

**Splits and merges need more than an alias.** Real curriculum work does not only
rename skills — it splits them (`for-loop-range` becomes `for-loop-iteration` plus
`range-generator`) and occasionally merges them. A 1:1 alias cannot express that. The
ontology therefore carries its own version and an explicit transition list:

```yaml
# skills.yaml
ontologyVersion: 4
transitions:
  - from: for-loop-range
    to: [for-loop-iteration, range-generator]
    kind: split
    policy: carry-forward-reduced     # inherit P(known), require 1 fresh opportunity each
  - from: [str-concat, str-format]
    to: string-building
    kind: merge
    policy: min                       # conservative: take the lower estimate
```

Because `skill_state` is a recomputable cache (§8), applying a transition is a replay
of `progress_events` through the mapping function, not a destructive migration.
Historical events keep their original IDs forever; the mapping is applied at
projection time. CI fails if a released ID appears in neither `skills.yaml` nor a
transition.

### 5.6 Reading tiers

Prose variants per step are keyed by tier: `grade3`, `grade7`, `adult`. Same skills,
same tests, same code — different words. Tier is a learner profile setting,
adjustable at any time.

The schema supports any number of tiers; **ship two** — `grade3` and `adult` — as
Phase 2 already assumes. A third tier triples authoring effort for a benefit that
cannot be measured until real learners are using the first two. Add `grade7` when
evidence says the gap between the two is too wide. A missing tier falls back to the
next simpler one, never to `adult`.

**CI gates on the grade3 variants:**
- Dale-Chall or Flesch-Kincaid score against a target grade level
- Vocabulary allowlist check (flag words outside a ~2,000-word list)
- Sentence length ceiling

This makes "a third grader can understand it" a mechanical guarantee rather than
something you have to remember to do.

### 5.7 Audio narration

Generated at **build time** with Piper (local neural TTS, small ONNX models), one
`.ogg` per prose variant, regenerated only for changed prose. Deterministic, reviewable
in a PR, works identically on every device, zero runtime dependency.

The Web Speech API was rejected: Chrome frequently routes synthesis through Google's
servers, which fails or degrades on an isolated network.

---

## 6. Mastery engine

### 6.1 Model

Mastery is tracked **per skill, not per lesson**. A lesson unlocks when the learner
holds its prerequisite skills, not when they finished the previous lesson.

**Bayesian Knowledge Tracing** produces the estimate. Four parameters per skill:

| Parameter | Meaning | Typical start |
|---|---|---|
| `pInit` | Already knew it | 0.15 |
| `pLearn` | Learned it this opportunity | 0.20 |
| `pGuess` | Got it right without knowing | *per item type — see below* |
| `pSlip` | Knew it but erred | 0.10 |

**`pGuess` is a property of the item, not the skill.** A 4-option `predict` step has a
25% floor by construction, so a global 0.20 is below what random clicking achieves and
lets a learner brute-force downstream skills. Derive it:

| Step type | `pGuess` |
|---|---|
| `predict`, multiple choice | `max(0.25, 1/N)` — N = option count |
| `parsons` | ~0.10 with distractors, higher without |
| `fill-blank` | 0.10 |
| `free-code` (transfer-flagged or not) | 0.05 |

The "2+ distinct step types" rule below mitigates this but does not fix it.

After each attempt, update `P(known)` via the standard BKT posterior. **Mastery
threshold: `P(known) ≥ 0.90` across at least 3 opportunities spanning 2+ distinct step
types.** Roughly 30 lines of math, fully interpretable, and recomputable from the event
log if parameters change.

**BKT runs server-side only.** The API is the sole evaluator: it applies the posterior,
writes `skill_state`, and decides what unlocks. The client renders what it is told and
never computes mastery.

There is no optimistic client-side copy. Two implementations — TypeScript in the browser,
Python in the API — would have to agree to the decimal or the skill map visibly corrects
itself, and keeping them in step needs a shared test-vector suite maintained forever.
There is also nothing to gain: the round trip is 5–20ms on a LAN, and the feedback that
must feel instant is the test result, which is already local. A skill map that updates a
beat later is imperceptible.

If this ever runs over a WAN, optimistic UI becomes the right call. It is not today.

`pInit`, `pLearn` and `pSlip` are per-skill and tunable in `skills.yaml`; `pGuess`
is derived from the step. Start with the defaults above and calibrate once there is
real data.

### 6.2 Failure classification — what counts as an attempt

**Not every failed submission is a mastery signal.** Beginners iterate through typos,
missing colons, and indentation errors at a rate experienced developers do not. If
every red result feeds BKT and increments the failure ladder, two missing colons
trigger re-teaching and four indentation slips demote a child to prerequisites. The
engine would punish exactly the exploratory trial-and-error it should encourage.

The runtime classifies every failure (`FailureKind`, §4) and the mastery engine treats
each differently:

| Kind | BKT | Failure ladder | Response |
|---|---|---|---|
| `parse` | **no update** | **no increment** | Inline syntax help; unlimited retries |
| `runtime` | reduced weight | no increment | Error explained at reading tier |
| `timeout` | no update | no increment | "Your program never finished" + interrupt |
| `semantic` | full update | increments | The authored hint ladder (§6.5) |

Only `semantic` failures — code that ran cleanly and produced the wrong answer — are
opportunities in the BKT sense.

Syntax errors are still **logged**. Persistent indentation trouble is worth surfacing
in a parent report and worth a targeted mini-lesson. It is simply not evidence about
whether the learner understands loops, and it must never move the concept gate.

### 6.3 Detecting real understanding

Passing tests proves nothing on its own — a child will permute characters until green.
Three independent signals:

**Item-type variation.** A skill is not mastered from one step type alone. `transfer`
items (same skill, visibly different problem shape) are the strongest single signal.
`predict` and `parsons`-with-distractors resist brute force. `explain-back` catches
pattern-matching.

**Behavioral telemetry**, logged as events and fed into confidence:
- Submissions per minute (high = guessing)
- Edit distance between consecutive attempts (tiny random deltas = guessing)
- Time to first edit after failure (instant = not reading feedback)
- Hint escalation rate
- Run-before-submit ratio (never running = guessing)

**Spaced review.** Skills decay. Resurface each mastered skill at **3, 7, and 21 days**.
Failing a review un-masters the skill and schedules re-teaching. This is the honest
version of "shows understanding" — it survives a week.

### 6.4 Gating: branch, never lock

A hard gate an 8-year-old cannot pass produces tears and quitting, not learning.

| Consecutive failures on a skill | Response |
|---|---|
| 2 | Re-teach with different wording; offer tier-down prose |
| 4 | Drop back to the prerequisite skill |
| 6 | Surface a worked example, flag in the parent report, unlock a side path |

Forward progress on the *primary* sequence stays blocked. Lateral movement is always
available. The learner is never staring at a locked screen with nothing to do.

**These counts are of `semantic` failures only.** A learner can fight a syntax error twenty times without moving the ladder.

### 6.5 Hint ladder

Nudge → targeted hint → worked analogous example → solution with explanation and a
required follow-up transfer item. Hint usage is logged and lowers the confidence
contribution of that attempt, but never blocks mastery outright.

**Two ladders, two scopes — do not conflate them.** This hint ladder is *per step*,
keyed on semantic failures of the step in front of the learner, and lives in that
step's `meta.yaml`. The gating ladder in §6.4 is *per skill*, keyed on consecutive
semantic failures across every step that exercises the skill, and lives in the
mastery engine. A learner can exhaust this ladder on one step without moving the
skill gate, and can trip the skill gate across three steps without exhausting any
one step's hints. The worked example at gate level 6 is the engine choosing a
different step; the worked example here is content within the same step.

When AI guidance is enabled (§19) it fires only after this ladder is exhausted —
never in place of it.

---

## 7. Accounts & identity

**Threat model, stated once.** Four adversaries shape everything in this section,
§8 and §19:

- **The curious student** — DevTools open, no malice, discovers what the API accepts.
- **The malicious student** — same tools, wants a classmate's account or a forged pass.
- **The compromised shared tablet** — a device several learners use, one of whom
  installed something.
- **The vendor** — you. Must be *unable* to see student data, not merely promise not
  to. On-premise deployment and zero PII are how that promise becomes structural.

Nothing here defends against a hostile network operator; the box is on their LAN by
design.

### 7.1 No email, anywhere

Email's real jobs are recovery and delivery. Both are solved otherwise:

- **Recovery** → an adult resets it. No email flow exists.
- **Parent reports** → rendered in the parent's own view, not mailed.

Email remains an *optional* field on adult accounts for people who want digest
delivery. It is never a login identifier and never required.

### 7.2 Account tiers

**Adult** (parent / instructor / admin): username + password, plus printed recovery
codes generated at setup. Optional passkey.

**Learner**: created by an adult or joined via a code. Display name only — no email,
no legal name, no birthdate. The owning adult holds an unconditional reset capability.

### 7.3 Learner sign-in

A password is the wrong credential for an 8-year-old. Supported methods, in order of
recommended fit:

1. **4-digit PIN** — simplest thing that works on a trusted device.
2. **Picture password** — pick 3 icons in sequence; no keyboard, fast on tablet.
3. **QR login card** — printed card, scan to sign in. The right answer for a tutoring
   center with 20 kids and shared laptops.
4. **Passkey** — device-bound; good for adults, annoying for kids when a device dies.

**Device-bound sessions matter more than the credential.** On a family tablet, sign in
once and stay signed in. The login screen should be rare.

These credentials have tiny keyspaces — 10,000 for a PIN, fewer for a 3-icon picture
password — which makes §7.4 mandatory rather than optional.

### 7.4 Abuse controls

Being on a private LAN does not reduce this threat; it is where the attacker sits. A
student with DevTools and a five-line `fetch()` loop is the realistic adversary.

**Credential throttling** — per-account, not per-IP (every device shares the NAT, and
learners share devices):
- Exponential backoff after 3 failures, hard lock after 10
- Unlock only by the owning adult — never by timer, never self-service
- **Adult accounts** back off exponentially but never hard-lock, because there may
  be no one above them. Recovery codes (§7.2) bypass the backoff; that is what they
  are for.
- Failed attempts logged and surfaced in the instructor view; a learner enumerating
  classmates should be visible, not silent

**Write quotas** — the API runs on entry-level hardware against one Postgres:
- Per-session ceilings on `progress_events` and `submissions` writes per minute
- Payload size caps on submitted code
- A bounded connection pool with a short statement timeout, so one loop cannot starve
  the class

**Server-side event validation.** Execution is client-side, so mastery claims arrive
untrusted and a learner can simply POST completion of Python C. The API rejects an
event unless: the step exists in the loaded content version, its prerequisites are
held, a matching submission accompanies any `step_completed`, and elapsed time is
physically plausible. Reject-and-log rather than silently accept.

**Be precise about what this closes.** It closes tampering with the *mastery model* —
BKT arithmetic, gating and unlocks are server-authoritative (§6.1), so a learner cannot
edit their own skill graph. It does **not** close a forged test result: the server has
no execution of its own and cannot independently verify that code passed. The checks
above raise the cost and leave an audit trail; §8 covers the rest.

None of this needs Redis. Counters and an `auth_attempts` table in Postgres are
sufficient at this scale.

### 7.5 Tenancy

Every table carries `org_id`. Usernames are unique on `(org_id, username)`, **not
globally** — `jada` must be valid in your family and in a future customer's org
simultaneously. Costs nothing now; a brutal migration later.

### 7.6 Privacy posture

Collecting zero PII — no email, no legal name, no DOB — puts the system largely outside
COPPA's collection triggers rather than requiring compliance with them. Combined with
on-premise deployment, the product claim is: *student data never leaves your building,
there is no vendor to trust, and there is nothing to breach.*

> Confirm with counsel before putting this in marketing copy. Architecturally you are
> already in the right place.

---

## 8. Data model

Postgres holds **only user data**. Content is never ingested.

```sql
-- Tenancy
orgs(id, name, created_at)

-- Identity
users(id, org_id, username, display_name, role,          -- adult | learner
      password_hash, pin_hash, picture_seq_hash,
      reading_tier, email_optional, created_at)
  UNIQUE (org_id, username)

recovery_codes(id, org_id, user_id, code_hash, used_at)
device_credentials(id, org_id, user_id,
                   kind,                    -- qr_token | passkey
                   secret_hash_or_pubkey, label, created_at, revoked_at)
guardianship(org_id, adult_user_id, learner_user_id, relationship)
sessions(id, org_id, user_id, device_label, issued_at, expires_at, revoked_at)

-- Append-only event log — never mutated
progress_events(
  id, org_id, user_id,
  event_type,           -- step_started | attempt | hint_shown | step_completed
                        -- | review_due | review_passed | review_failed
  course_id, step_id,   -- opaque strings from content
  skill_ids text[],
  correct boolean,
  failure_kind,         -- null | parse | runtime | semantic | timeout  (§6.2)
  hint_source,          -- null | authored | ai   (see §19.6)
  payload jsonb,        -- telemetry: durations, edit distance, submission count
  content_version,
  occurred_at
)

submissions(id, org_id, user_id, step_id, code text,
            eval_result jsonb, content_version, occurred_at)

-- Populated only when AI guidance is enabled (§19.8)
ai_hint_cache(content_version, step_id, code_hash, hint jsonb,
              rejected_count int, created_at)
  PRIMARY KEY (content_version, step_id, code_hash)   -- tests change per release

-- Derived state — recomputable from progress_events
skill_state(org_id, user_id, skill_id,
            p_known numeric, opportunities int,
            mastered_at, last_seen_at, next_review_at, decayed boolean)
  PRIMARY KEY (org_id, user_id, skill_id)

-- Abuse controls (§7.4)
auth_attempts(org_id, user_id, window_start, failures int, locked_until)
  PRIMARY KEY (org_id, user_id)

-- Rosters
cohorts(id, org_id, name, join_code, created_by)
cohort_members(org_id, cohort_id, user_id)
```

**Why append-only:** progress can be recomputed after a rule or parameter change,
history can be replayed, a learner's code from three weeks ago is free, and parent
reports are a projection rather than a feature that needs its own storage.

`skill_state` is a cache. Truncate it and rebuild from `progress_events` at any time.

**On trust — two layers, only one of them closed:**

| Layer | Authority | Status |
|---|---|---|
| BKT arithmetic, gating, unlocks | Server (§6.1) | **Closed.** The client cannot alter its own skill state. |
| Whether the submitted code actually passed | Client | **Mitigated, not closed.** No server-side execution exists to verify it. |

For the second layer: prerequisites must be held, a submission must accompany any
`step_completed`, timing must be physically plausible, and every submission is stored,
so batch re-verification is possible later without architectural change. A determined
student can still forge a pass. Irrelevant for your own children; it matters the moment
a certificate or a cohort ranking depends on it, and that is the point at which a
verification runner — not a live executor — becomes worth building.

**`failure_kind` is a real column**, not a `payload` key, because the projection
branches on it for every event and a replay should not parse JSON in the hot path.

**Concurrency.** With BKT server-side and the API horizontally scalable, two
replicas can receive events for the same learner. `skill_state` rows are updated
under `SELECT … FOR UPDATE`, and a learner's events are applied in `occurred_at`
order within the batch. Out-of-order arrival across batches is tolerated because
the state is recomputable; it is not tolerated silently — it is logged.

**The spaced-review scheduler** is a Kubernetes `CronJob` (a Compose sidecar with
`cron`) that calls `POST /v1/admin/reviews/schedule` on the API. It is not an in-process
timer, which would fire once per replica.

---

## 9. Deployment

### 9.1 Coupling rules

These are the rules that keep the deployment decoupled. Worth writing into the chart
and enforcing in review.

1. **Only the API touches Postgres.** Content never does. Two services on one database
   is how you get a distributed monolith.
2. **The SPA fetches `/config.json` at boot**, served from a ConfigMap. Never bake API
   or content URLs into the bundle, or you need a rebuild per environment.
3. **Content, audio, and runtime URLs are configuration, not imports.** This is what
   lets curriculum and Pyodide version independently of the web build.
4. **Migrations run as a Helm `pre-upgrade` Job**, never on API startup. Otherwise
   deploy order and replica count start mattering.
5. **One public origin, path-routed at the ingress** (§3.1). Services stay separately
   imaged and versioned; only the origin is shared. Never publish a second port to the
   browser — it breaks cross-origin isolation and reintroduces CORS.
6. **Every service DNS name is a chart value.**
7. **The API degrades rather than crashes if content is unreachable.** Learners keep
   their session; new lessons just do not load.
8. **Skill and step IDs are stable across content versions.** The one contract that
   genuinely cannot be broken.

### 9.2 Resource profile

| Component | Request | Notes |
|---|---|---|
| api | 128Mi / 100m | Only thing that scales with load |
| web | 32Mi / 10m | nginx |
| content | 32Mi / 10m | nginx |
| audio | 32Mi / 10m | nginx |
| runtimes | 32Mi / 10m | nginx |
| postgres | 256Mi / 250m | Only stateful component |

Under 700Mi total. An N100 mini PC or a Pi 5 with an SSD handles 30 concurrent
learners without noticing — all execution is on the learners' devices. The only load
spike is first-pull of the Pyodide bundle. The *server* shrugs it off on gigabit; the
*access point* does not when a whole class cold-starts at once — see §12.4.

`tutor` is absent from the table because it is absent by default. When enabled, it
is sized by the model, not by this application.

**Build every image multi-arch** (`amd64` + `arm64`). A Pi 5 is a plausible target;
an `amd64`-only image discovered at a customer site is a bad day.

### 9.3 Deployment modes

| Scenario | Shape |
|---|---|
| Family / single classroom | Docker Compose on one box, ~40 lines |
| Tutoring center wanting resilience | k3s or Talos, same images, Helm chart |

**Postgres:** `postgres.mode: embedded | operator | external`

- `embedded` — StatefulSet + PVC + `pg_dump` CronJob. Correct for a family or single
  classroom. The CloudNativePG operator plus CRDs to manage one database on one node is
  not worth the weight, and you will actually understand the restore path.
- `operator` — CloudNativePG. Earns its cost for a multi-tenant customer.
- `external` — Aurora PostgreSQL or any managed instance.

The API takes nothing but a connection string. Mode is a chart concern only.

### 9.4 Optional subsystems (off by default)

- **ServiceMonitor / Grafana dashboards** — behind a chart flag, for sites that already
  run a stack. Expose `/metrics` and structured JSON logs unconditionally.
- **Ingress** — k3s ships Traefik; one Ingress is the whole networking story.
- **Argo CD** — use it in your own environment if it is already there. Do not ship it.
- **`tutor` service** — AI guidance and reporting (§19). Off by default, and not
  deployed at all when disabled rather than deployed and idle.

### 9.5 TLS — required, not optional

An earlier discussion allowed plain HTTP for a family LAN. That no longer holds.
Three things in this design require a **secure context**, and a private IP over
HTTP is not one:

- `SharedArrayBuffer`, and therefore `interrupt()` (§4). Without it every infinite
  loop takes the worker-termination path.
- Service workers, and therefore PWA install (§12.4).
- `navigator.storage.persist()` (§12.4).

`localhost` is a secure context; `192.168.1.50` is not. HTTPS is a Phase 1
requirement, not a Phase 5 polish item.

The box has egress, so: own a domain, point an A record at the private IP, obtain a
certificate via **DNS-01 challenge**. Certificates renew over the internet, traffic
never leaves the building, nothing to install on devices. No internal CA, no per-device
root certificate.

### 9.6 Backups

On-premise means nobody else is doing this. Nightly `pg_dump` to a second disk or NAS,
retention policy, and **a restore you have actually tested**. Content needs no backup —
it is in the image.

### 9.7 The Helm chart

**Source lives in `deploy/helm/` in the main repo** (§10.2), not in a chart repository
of its own. The chart's values *are* the application's configuration surface: a new
setting on the API is a template change in the same commit. Split them and the chart
drifts from the images it deploys, which is the single most common way a Helm chart
becomes untrustworthy.

```
deploy/helm/copperkeep/
├── Chart.yaml            version == appVersion == the app's semver
├── values.yaml           documented defaults, everything off that can be
├── values.schema.json    validated at install time
├── templates/
│   ├── web|content|audio|runtimes|api    Deployment + Service each
│   ├── tutor-*.yaml                      guarded by .Values.tutor.enabled
│   ├── postgres-*.yaml                   embedded mode only
│   ├── ingress.yaml                      one origin, COOP/COEP/CORP headers (§3.1)
│   ├── migrate-job.yaml                  helm.sh/hook: pre-upgrade (§9.1 rule 4)
│   ├── review-cronjob.yaml               spaced-review scheduler (§8)
│   └── config-json-configmap.yaml        the SPA's /config.json (§9.1 rule 2)
└── tests/                                golden `helm template` output
```

**One chart, not a chart per service.** The services are five faces of one product,
released together on one version. A chart per service would mean five version bumps
for one release and a customer wiring them together by hand.

**Version the chart with the app.** `version` and `appVersion` both track the app's
semver. Independent chart versioning is for charts that package *someone else's*
software; here they ship as one thing.

**No subchart for Postgres.** `embedded` mode is a StatefulSet, a PVC, a Service and a
`pg_dump` CronJob — well under a hundred lines you can read in one sitting. Depending
on a third-party Postgres chart drags in a large configuration surface, ties your
release cadence to theirs, and exposes you to upstream licensing and image-hosting
changes. It also contradicts the reason `embedded` exists at all (§9.3): so that the
restore path is something you understand. `operator` and `external` modes render no
Postgres templates whatsoever.

**`values.schema.json` is not optional.** The person installing this at a tutoring
center is an admin, not a Helm author. A typo should produce *"tutor.timeoutSeconds
must be an integer"*, not a template rendering error forty lines deep.

**The real risk is Compose/Helm drift**, not writing the chart. Two deployment
descriptions of one system diverge quietly. Two defences: both render the same
`/config.json` contract and the same environment variable names — neither invents its
own — and CI stands up *both* and runs the same smoke test against them (§11.5).

---

## 10. Repository & documentation

### 10.1 Two repositories, under one org

An organisation, not a personal account. The container namespace ends up in every
Helm values file and Compose file shipped to a customer — `ghcr.io/copperkeep/api`
reads correctly, a personal-account prefix does not. It is also the ownership
boundary if this becomes a business, and transferring a repo later breaks every URL.

| Repo | Holds | Versioning |
|---|---|---|
| `copperkeep/copperkeep` | Platform: all five services, shared packages, deploy manifests, docs | semver |
| `copperkeep/curriculum` | Lessons, skills ontology, prose tiers, tests, authoring docs | calver (§11.1) |
| `copperkeep/.github` | Issue templates, security policy, community health | — |

**The curriculum split is the only boundary that is real.** Different release cadence,
different CI entirely (readability gates, reference solutions, Piper audio), eventually
non-engineer contributors, and it is the artefact that becomes a subscription. The
authoring UI in Phase 6 commits to this repo.

**Everything else stays together.** A monorepo is not a monolith: the five services are
still independently built, versioned, and deployed (§3, §11). Only the source lives
together. The reason is that a change to the events contract touches `contracts`, `api`
and `web` at once — as one repo that is a single commit whose CI proves all three still
agree; as three repos it is three PRs and a window where they disagree.

The cost to pay for that: **path-filtered CI**. Rebuild `api` only when `apps/api/**`
or `packages/contracts/**` changed. Set this up in the first week, not the tenth.

**Do not pre-split for open-core.** The commercial layer — multi-tenancy, dashboards,
cross-cohort analytics (§15) — does not exist until a customer asks for it. Carve it
out then, as a private repo or an `/ee/` directory under a separate licence. Splitting
before there is anything to split only adds friction to Phase 1.

> **Open — the licence.** Apache-2.0 maximises adoption. AGPL-3.0 prevents someone
> hosting the open core as SaaS without publishing changes, which protects rather than
> harms a business model that is explicitly *not* SaaS — at the cost of some school
> procurement teams flinching. A reasonable split is AGPL for the platform, permissive
> for the runtime adapters and content schema so the ecosystem pieces spread freely.
> Decide before the first external contributor, because it is hard to reverse after.

### 10.2 Layout

```
copperkeep/
├── README.md                  what it is, how to run it locally
├── apps/
│   ├── web/                   SPA (Vite + React)
│   ├── api/                   FastAPI — the only service with DB credentials
│   └── tutor/                 optional LLM service (§19)
├── packages/
│   ├── contracts/             shared TS types: LanguageRuntime, API schemas
│   ├── runtime-python/        Pyodide adapter
│   ├── runtime-conformance/   the adapter contract suite (§4)
│   └── ui/                    tokens.css, components.css (§13)
├── images/
│   ├── content/ audio/ runtimes/   nginx confs, Dockerfiles, wheel vendoring
├── deploy/
│   ├── compose/               single-box deployment
│   └── helm/                  chart, three Postgres modes (§9.3)
└── docs/
    ├── architecture/          this plan
    ├── adr/                   decision records (§10.4)
    ├── operations/            install, backup & restore, upgrade, troubleshooting
    └── contributing/          setup, conventions, the adapter contract

curriculum/
└── docs/authoring/            how to write a lesson, the schema, the gates
```

### 10.3 Docs live with the code

**No separate docs repository.** Documentation in a second repo cannot change in the
same commit as the code it describes, so it cannot be required by the same PR, so it
rots. `docs/` alongside the code gets reviewed with the change that invalidated it.

The two things that would justify a split do not apply here: non-engineer contribution
is already absorbed by the curriculum repo, and docs have no independent cadence —
they version with the app.

The one genuine exception is **authoring documentation**, which lives in
`curriculum/docs/authoring/` because that is where its reader is working.

If a published site is wanted later (`docs.copperkeep.dev`), the markdown stays in
this repo and the site build pulls from it — Docusaurus or Astro Starlight both do
this. The published artefact moves; the source does not.

**Operations docs are a product surface, not internal notes.** The moment a tutoring
center runs this, *they* are the ones reading "how do I restore from backup" — under
pressure, on a bad day. Write the restore doc at the same time as the backup job
(§9.6) and follow it once, on a real machine, before believing it.

### 10.4 Decision records

§18 is a decisions table, which is the right shape but loses the reasoning behind each
row. Each becomes `docs/adr/NNNN-short-title.md` with context, decision, and
consequences.

The value shows up on reversal. Three decisions in this document were already reversed
during review — Redis, TLS, and the PWA's purpose — and an ADR records a reversal as a
**new record superseding the old one**, leaving both readable. A table row edited in
place loses the fact that anyone ever thought otherwise, and why.

Write one whenever a choice would be expensive to revisit or surprising to a newcomer.
Not every commit; roughly the granularity of §18's rows.

---

## 11. Build & release

### 11.1 Versioning

- **Application:** semver (`1.4.2`)
- **Curriculum:** calendar version (`2026.09.1`) — reads far better for content
- **Compatibility:** the content manifest declares `minAppVersion`. `content` is plain
  nginx and enforces nothing; the check runs in two places — the API at startup
  (fails its readiness probe on a mismatch, so a bad deploy never goes live) and the
  SPA at boot (shows a clear message rather than a broken lesson)

This guard costs nothing now and becomes essential the moment a customer runs a pinned
app version against a curriculum subscription.

### 11.2 Curriculum pipeline

On merge to the curriculum repo:

1. Validate manifests; **check ID stability against the previous release**
2. Run every reference solution against its own test suite
3. Readability + vocabulary check on grade3 prose
4. **Reject any external subresource in lesson MDX or assets**
5. Generate Piper audio for changed prose only
6. Build `content` and `audio` images; cosign-sign; push
7. Renovate bumps the values file; CI runs `helm upgrade`

Step 2 is the highest-value gate in the pipeline — it catches broken exercises before
a child does.

Step 4 extends the determinism check in §11.4 to curriculum content: no CDN fonts, no
remote images, no iframes, no external embeds. Everything ships inside the image. This
was already required by the on-premise design; COEP `require-corp` (§3.1) now makes a
violation fail *silently in the browser* rather than merely being wrong, so the gate
moves from good hygiene to load-bearing. Two constraints reinforcing each other, not a
new tax.

Compose parity: `docker compose pull && docker compose up -d`. Do **not** use
Watchtower; an auto-update landing mid-lesson is a bad experience.

### 11.3 Content delivery

Start with curriculum **baked into the `content` image**. Keep the seam: the content
service reads from a configurable path rather than its own filesystem, so switching to
an ORAS-pulled OCI artifact later is a values change, not a rewrite.

### 11.4 Chart packaging and release

The chart publishes as an **OCI artifact to the same registry as the images**:

```
oci://ghcr.io/copperkeep/charts/copperkeep
```

Same registry, same credentials, same cosign signing, same digest pinning as every
image. No `gh-pages` branch, no `index.yaml` to maintain, and an air-gapped customer
mirrors charts and images with one tool instead of two.

Install becomes:

```
helm install copperkeep oci://ghcr.io/copperkeep/charts/copperkeep --version 1.4.2
```

Released by the same job that pushes the images, so a chart version that exists always
has images that exist.

### 11.5 Deployment CI

Every PR that touches `deploy/`, `apps/` or `images/`:

1. `helm lint` and validate `values.schema.json` against `values.yaml`
2. `helm template` for each Postgres mode and each `tutor.enabled` state, diffed
   against golden files — an unintended manifest change shows up as a reviewable diff
3. Install into **k3d** and into **Compose**, then run the same smoke test against
   both: log in, load a lesson, run code, assert `crossOriginIsolated`, post an event,
   read it back
4. Assert the ingress actually returns the COOP/COEP headers — the one thing that
   silently disables `interrupt()` (§4) if a template edit drops it

Step 3 is what keeps the two deployment paths honest. Step 4 is cheap and guards the
design's most fragile assumption.

### 11.6 Determinism check

CI should fail the build on unexpected outbound URLs in the frontend bundle. Egress is
permitted for infrastructure, but the *application* should not quietly acquire a Google
Fonts import or an analytics beacon. A five-line grep.

---

## 12. UI design notes

### 12.1 Core layout (lesson screen)

Three panes on desktop, stacked with tabs on tablet:

- **Instruction pane** — prose at the learner's reading tier, with a prominent
  read-aloud control. Large type, generous line height.
- **Editor pane** — CodeMirror 6. Chosen over Monaco: far lighter, meaningfully better
  touch and mobile behavior, and the learners are on tablets and Chromebooks.
- **Output pane** — stdout/stderr, plus per-test-case results in plain language, not
  stack traces.

A step-through execution visualizer (Python Tutor style: show each line executing with
variable state) is the highest-leverage widget for beginners. **Build the concept, do
not copy the code** — see §15.

### 12.2 Progression UI

The learner sees a **skill map**, not a linear list — it makes "you need this before
that" visible and makes the branch-on-failure behavior legible rather than punitive.
Mastered skills, in-progress skills, and locked skills are visually distinct. Review-due
skills surface as a small daily queue.

### 12.3 Any-age requirements

These are not accessibility extras; they are what makes one app work for an 8-year-old
and a 40-year-old.

- Minimum 44px touch targets
- Read-aloud on all instruction prose
- Reading tier switcher, changeable mid-lesson
- Dyslexia-friendly font toggle
- Keyboard-light interaction — parsons and predict steps need no typing
- No timers, no leaderboards, no streak-loss pressure for learner accounts
- Error messages rewritten in plain language, never raw tracebacks at grade3 tier

### 12.4 Storage persistence

The design leans on Cache Storage for Pyodide (~10MB gz) and narration audio. Both
Safari and Chromium evict script-writable storage — Safari after roughly a week of
inactivity, Chromium under disk pressure. On shared 32GB tablets this is routine, not
an edge case.

The failure mode is not one slow learner: it is **25 tablets cold-fetching Pyodide
simultaneously at the start of a class**, which saturates the access point rather than
the server.

- Call `navigator.storage.persist()` after the first successful lesson
- **PWA install becomes load-bearing**, not cosmetic — installed apps are granted
  persistent storage far more readily. (An earlier draft kept the PWA only for
  fullscreen tablet mode; this is the stronger reason.)
- Show cache state in the instructor view so a cold classroom is visible before the
  period starts, not during it
- Version runtime assets by path so a content release never invalidates the Pyodide
  cache

### 12.5 Parent / instructor view

A projection over `progress_events`. Weekly digest contains:

- Skills mastered this week
- Time on task
- Where they got stuck (skill, not lesson)
- Review performance — what survived a week
- **Two or three questions to ask out loud** ("ask her what a loop does")

Deliberately **not** a grade, a percentile, or a leaderboard. The last item is the most
useful thing on the page and the easiest to overlook when building it.

### 12.6 Stack

Vite + React + TypeScript, Tailwind + shadcn/ui, CodeMirror 6. No SSR framework.

**No xterm.js.** An earlier draft listed it for a REPL pane, but no REPL was ever
designed, and a terminal *emulator* — escape codes, cursor addressing, scrollback —
is the wrong tool for `>>> 2 + 2` in a child's first lesson. If a REPL is wanted
later it is a `repl` step type: a transcript list of prompt/response pairs rendered
with the same components as everything else, driven by the runtime adapter's
`run()` one line at a time. Nothing new to ship.

---

## 13. Visual design system

Two themes, one system. **Dark is the house style, adopted verbatim**: near-black
navy ground, one heavy grotesque for headlines, monospace for every label, four
accents that each mean one thing. **Light is the paper the terminal was designed
on** — the same navy undertone, the same type, the same four meanings at a luminance
that survives a white page. Neither is an inversion of the other.

Tokens live in `assets/tokens.css` under `[data-theme="dark"]` and
`[data-theme="light"]`; components in `assets/components.css` reference tokens only.
A component that names a hex is a bug.

### 13.1 Which theme, where

| Surface | Default | Why |
|---|---|---|
| Learner: lessons, skill map | `prefers-color-scheme`, falling back to **light** | Bright classrooms, projectors, and long prose for young readers |
| Adult: reports, dashboards, admin | **dark** | These *are* the house-style reports |

Always a toggle; persisted in `users.theme`. Never decide by role alone — a parent
reading a report on a sunny porch flips to light.

**The signature of light mode: code stays in the terminal.** The editor and output
panes sit on `--ink-800` in *both* themes. The prose goes to paper; the code never
does. This keeps the brand's identity when the page is white, gives code its best
contrast, and makes the prose/code boundary visible structure rather than a border.

### 13.2 Tokens

**Ground.** Note the direction flips: in dark, *up* is lighter; in light, *up* is
whiter and wells sink into tint.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--ink-900` | `#080b12` | `#f6f8fb` | page |
| `--ink-850` | `#0b1020` | `#eff2f7` | deck / report ground |
| `--ink-800` | `#111725` | `#e7ebf2` | wells, chart panels — **and the editor, in both themes** |
| `--ink-700` | `#161e30` | `#ffffff` | cards, callouts, hint cards |
| `--ink-600` | `#1e2839` | `#ffffff` + `0 1px 2px rgba(15,22,38,.08)` | raised: avatars, popovers |
| `--line` | `#232e44` | `#d8dee9` | hairlines, gridlines |
| `--line-strong` | `#33415c` | `#b9c3d3` | borders |

**Text.**

| Token | Dark | Light | Contrast on page (dark / light) |
|---|---|---|---|
| `--fg` | `#e8ecf3` | `#0f1626` | 16.6 / 17.0 |
| `--fg-muted` | `#9fb1c7` | `#3f4d66` | 9.0 / 8.0 |
| `--fg-dim` | `#6f8098` | `#5a6a84` | 4.9 / 5.2 |

Light `--fg` is dark `--ink-800`'s hue. The palette is one navy at two ends.

**Accents — one meaning each.** The reference accents fail on white (`#00e06a` is
1.8:1); light mode keeps the hue and drops the luminance until each clears 4.5:1 as
text on the page.

| Token | Dark | Light | Contrast (dark / light) | Means |
|---|---|---|---|---|
| `--accent` | `#00e06a` | `#0b7d3f` | 11.1 / 4.9 | the answer — mastered, passed |
| `--accent-warn` | `#ff9d2e` | `#b45309` | 9.5 / 4.7 | attention — review due, hint used |
| `--accent-alt` | `#5b8cff` | `#2a5bd7` | 6.2 / 5.5 | in progress, links, focus |
| `--accent-hot` | `#f0466e` | `#c2184a` | 5.4 / 5.6 | failed, locked by failure |

Every light accent also carries white text at ≥ 5:1, so the same token works as a
fill.

**Categorical series** — same hue order in both themes; light variants clear 3:1 on
the chart well.

| | c1 | c2 | c3 | c4 | c5 | c6 | c7 |
|---|---|---|---|---|---|---|---|
| Dark | `#a9c6e8` | `#2fd16b` | `#31d0c6` | `#f97d26` | `#efc03a` | `#f0619a` | `#c46be8` |
| Light | `#4a78b3` | `#1f8f49` | `#158f87` | `#c95f0e` | `#9c7814` | `#c43d78` | `#8b47b8` |

All ratios above are measured, not estimated; the script is a dozen lines and belongs
in CI so a token edit cannot silently regress contrast.

### 13.3 Meaning map — the four accents applied to the app

The house rule *"if nothing on the page is the answer, nothing on the page is
green"* maps directly onto the mastery engine. A new learner's skill map has **zero
green on it**. That is correct, and it is the point.

| State | Token | Also carried by |
|---|---|---|
| Skill mastered / test passed | `--accent` | filled node, check icon, the word |
| Skill in progress / link / focus ring | `--accent-alt` | outlined node |
| Review due / authored hint shown | `--accent-warn` | dashed node, clock icon |
| Test failed / skill locked *by failure* (§6.4) | `--accent-hot` | ✕ icon, the word |
| Skill not yet available | none — `--fg-dim` on `--line` | dotted node |
| AI-generated hint (§19.5) | `--accent-alt` at 8% as a tint on `--ink-700` | small "generated" label |

Colour is never the only carrier; every state above also has a shape or a word.

**The editor is a bounded context.** Syntax highlighting uses the categorical series
`--c1…--c7`, never the four semantic accents. A green string literal must not read
as "correct", and a red keyword must not read as "failed". The editor borrows the
ground and the type; it does not borrow the meanings.

### 13.4 Type

| Role | Face | Treatment |
|---|---|---|
| Display | Inter Tight 800 | tracking `-0.025em`, line-height ~1.0, sentence case |
| Body | Inter 400/500 | line-height 1.55 adult · **1.6 at `grade3`** |
| Label | JetBrains Mono 500 | see the tier rule below |
| Code | JetBrains Mono 400 | in the editor and output panes |

All four faces are SIL OFL and **self-hosted in the `web` image**. There is no font
CDN; §11.2 fails the build on one.

The house rule holds: **mono is for labels, never for prose.** Kickers, test-case
names, skill IDs, axis ticks, metadata — mono. Everything a learner reads — Inter.

**One deliberate departure, by tier.** The house treatment for labels is uppercase,
wide-tracked, small. Uppercase text is measurably slower for early readers, and small
wide-tracked text is hard on a tablet. So:

| Tier / surface | Label treatment |
|---|---|
| `grade3` learner surfaces | mono, **sentence case**, normal tracking, ≥ 13px |
| `adult` learner surfaces | house treatment: uppercase, `0.14em`, `--fg-dim` |
| Instructor and parent surfaces | house treatment |

Body size floor at `grade3` is **18px on tablet**, max measure **60ch** — shorter than
the house 70ch, because young readers lose a long line. Headlines stay claims in
sentence case: "Loops repeat things", never "Loops".

The dyslexia toggle (§12.3) swaps Inter for **Atkinson Hyperlegible** (OFL) for prose
only. JetBrains Mono stays for code; its `0/O` and `l/1/I` distinctions are already
the point.

### 13.5 Components — house classes mapped to the app

| House class | In the learner surface | In reports |
|---|---|---|
| `.kicker` | step position — `3 / Loops / Count to ten` | section index |
| `.display` + `.hl` | the lesson's claim | the report's claim |
| `.lede` | the instruction, one sentence | the finding, one sentence |
| `.callout` | an authored hint | reasoning beside evidence |
| `.code` + `.code__title` | starter and solution, read-only | a verbatim submission |
| `.progress` | one segment per step in the lesson | one per act |
| `.chips` | skill states on the map | section index |
| `.stat-strip`, `.bignum`, `.chart-well`, `.legend`, `table.data`, `.quote-card`, `.meta` | — | the weekly digest, verbatim house style |

**New components the house does not have** — add to `components.css`, then use:

- `.tap` — the 44px target primitive every interactive element composes
- `.test-row` — one test case: name in mono, result word, `--accent` or `--accent-hot`
- `.skill-node` — map node with the five states in §13.3, shape-coded
- `.hint` / `.hint--ai` — callout variants; `--ai` carries the tint and label
- `.parsons-line` — a draggable code line with a grab affordance large enough for a
  child's thumb
- `.transcript` — prompt/response pairs, if a `repl` step type is ever built (§12.6)

### 13.6 Layout

Left-aligned throughout. Prose is never centred.

```
Desktop (≥ 1024px)                        Tablet (< 1024px)
┌──────────────┬──────────────┬─────────┐  ┌──────────────────────┐
│ kicker       │ ┌──────────┐ │ output  │  │ [Read] [Code] [Run]  │  ← tabs
│ Claim as     │ │ editor   │ │ tests   │  ├──────────────────────┤
│ headline     │ │ ink-800  │ │ ink-800 │  │ active pane          │
│ lede         │ │ always   │ │ always  │  │                      │
│ prose (Inter)│ └──────────┘ │         │  │                      │
│ ▶ read aloud │  [Run] [I'm stuck]     │  │ [Run]   [I'm stuck]  │
└──────────────┴──────────────┴─────────┘  └──────────────────────┘
```

Instruction pane on paper (light) or ink (dark); editor and output on `--ink-800`
regardless. "I'm stuck" is always visible, never behind a menu. The parent report is
the house report page, unchanged.

### 13.7 Motion and accessibility

- Motion only answers an action: a test row settling, a skill node filling. No entrance
  animations, no hover choreography. `prefers-reduced-motion` disables the two that
  exist.
- Focus ring: 2px `--accent-alt`, 2px offset, on every `.tap`.
- Every text token clears 4.5:1 on every ground it is specified for, in both themes
  (§13.2). CI enforces it.
- Charts follow the house rules unchanged: horizontal hairlines in `--line`, mono
  ticks, direct-label the point that matters, series in `c1…c7` order, `--accent-warn`
  dashed for a limit, `--accent-hot` for a breach.

A working preview of both themes — swatches, a lesson panel, the five skill states, a
chart well — ships beside this plan as `design-preview.html`. It is self-contained and
uses system fallbacks for type, so what it shows is the colour system, not the final
typography.

---

## 14. Curriculum outline

Structure only — content authoring is a separate workstream.

**Python A — Foundations** (target: 3rd grade and up)
Output and strings · variables · numbers and arithmetic · input · booleans and
comparison · `if`/`else` · `for` with `range` · lists · `while` · functions without
return · simple projects

**Python B — Working Programs**
Functions with return and parameters · scope · dictionaries · nested data · string
methods · list comprehensions · errors and exceptions · file-shaped I/O (virtual FS) ·
modules · debugging as a taught skill · multi-step projects

**Python C — Real Code**
Classes and objects · iterators and generators · decorators · testing with assertions ·
algorithmic thinking and complexity · data manipulation · pure-Python packages via
micropip · a capstone project

Each section is a `Course`. Skills carry across sections — Python B prerequisites
reference Python A skill IDs directly.

---

## 15. Licensing & commercial notes

| Component | License | Use |
|---|---|---|
| Pyodide | MPL-2.0 | Safe to embed |
| CodeMirror 6 | MIT | Safe to embed |
| xterm.js | MIT | Safe to embed |
| Piper | MIT | Build-time only — **voice models carry their own licences**; check each before shipping its audio |
| Runestone Interactive | Copyleft | **Study the exercise model; do not embed** |
| Python Tutor | Non-standard terms | **Borrow the idea; do not copy the code** |

**Open-core structure** keeps both doors open:

- **Open source:** runtime adapters, editor shell, content format and schema, mastery
  engine, a starter Python curriculum. Drives adoption and contributed courses.
- **Commercial:** multi-tenancy, cohort and roster management, instructor dashboards,
  cross-cohort analytics, white-labeling, curriculum subscription.

A tutoring center is buying exactly that second list plus the appliance. The business is
*a box and a curriculum subscription*, not hosted SaaS — which means you are not running
anyone else's infrastructure.

---

## 16. Phasing

**Phase 0 — Spike (a weekend, before anything else)**
Create the org and both repos (§10); reserve the name on npm, PyPI and the domain.
Pyodide in a Web Worker behind a COOP/COEP proxy over HTTPS, on the cheapest tablet
or Chromebook you expect to support. A textarea and a Run button. No auth, no
database, no editor. **Prove three things:** `crossOriginIsolated === true`;
`interrupt()` stops `while True: pass` without terminating the worker; memory stays
sane through twenty runs. Every later phase assumes these. If one fails, the worker
strategy changes and you want to know before writing auth.

**Phase 1 — Walking skeleton**
Pyodide adapter in a Web Worker · adapter contract suite (§4) · CodeMirror editor ·
one hardcoded lesson with tests · username + PIN auth **with throttling** · batched
progress events to Postgres · Compose deployment behind **one origin with COOP/COEP
and HTTPS** · both themes (§13)

*Exit criterion:* one child completes one lesson end to end on the target tablet,
and a parent sees it in the report. That is the vertical slice; everything else is
scaffolding.

**Phase 2 — Content system**
Curriculum repo and schema · content build pipeline · ID stability check · reference
solution CI · grade3/adult tiers · Python A authored end to end

**Phase 3 — Mastery**
Skill registry · server-side BKT · parsons and predict step types · `transferFor`
flag · failure classification ·
branch-on-failure · hint ladder · skill map UI

**Phase 4 — Adults in the loop**
Parent/instructor accounts · guardianship · weekly report projection · cohorts and
join codes · reading tier switcher · read-aloud audio

**Phase 5 — Production shape**
Helm chart (§9.7) · `values.schema.json` · OCI chart publishing · k3d + Compose parity
CI (§11.5) · three Postgres modes · DNS-01 TLS · backup and tested restore ·
spaced review scheduler · Python B and C

*Design the values contract in Phase 1, build the chart here.* Compose comes first, but
nothing in Phase 1 should hardcode what will later be a chart value — then the chart is
a mapping exercise rather than a refactor.

**Phase 6 — Expansion**
yaegi-in-WASM spike · Go adapter · authoring UI that commits to the repo ·
multi-tenancy hardening · optional `tutor` service (§19), starting with tier
rephrasing before generated guidance

---

## 17. Open risks

| Risk | Mitigation |
|---|---|
| Go in-browser may not be viable | Spike yaegi early (Phase 6 gate, not an assumption) |
| BKT parameters are guesses until there is data | Event log allows full recompute after retuning |
| Mastery gating could frustrate rather than motivate | Branch-never-lock; watch the 6-failure flag in real use |
| Grade3 prose is hard to write consistently | Mechanical CI gate, not discipline |
| Pyodide first-load on weak tablets | Measure early; explicit progress UI; Cache Storage |
| Curriculum edits require a PR | Acceptable for you; authoring UI is the first business-customer ask |
| Audio corpus bloats image pulls | Already split into its own image; regenerate only changed prose |
| Learners farm wrong answers for AI hints | Authored ladder first; one hint per step; `hint_source` penalty on mastery |
| Generated hints give away the answer | Server-side validator rejects code and solution tokens, falls back to authored |
| Local inference needs hardware the appliance lacks | Size it separately; cloud is an explicit, consented choice; startup latency gate (§19.7) |
| Pyodide memory pressure on 4GB Chromebooks | Free the runtime on lesson exit; measure on the worst target device in Phase 1 |
| Cache eviction causes classroom-wide cold starts | `storage.persist()`, PWA install, cache visibility in the instructor view (§12.4) |
| Cross-origin isolation not achieved | Single-origin ingress; assert `crossOriginIsolated` in Phase 1 |
| Skill ontology splits orphan history | Explicit transitions with replay (§5.5) |
| Compose and Helm drift apart | Shared config contract; CI smoke-tests both (§11.5) |

---

## 18. Decisions log

| Decision | Rationale |
|---|---|
| All execution client-side | Zero marginal cost, no sandbox risk, works on any device |
| Text-only, no Blockly | Scratch experience already present; block mode is a lateral move |
| Parsons problems as the on-ramp | No-typing scaffolding while keeping real Python on screen |
| Content as files, not database rows | Makes rollback atomic with the image |
| No email | Removes the IdP, removes PII, removes COPPA collection triggers |
| Static SPA, no SSR | No SEO need, all users authenticated, all work client-side |
| No Redis | No queue; sessions, throttling counters and the hint cache fit in Postgres |
| `embedded` Postgres by default | An operator to manage one database on one node is upside down |
| Append-only progress events | Recomputable mastery; reports are a projection |
| Runtime adapter interface | Adding Go is a new adapter, not a re-architecture |
| Audio as a separate image | 50–200MB vs 2MB; typo fixes should not re-pull narration |
| AI guidance is one-way, no chat | Smaller safety surface, stateless service, far easier to sell to a school |
| The validator is the guarantee, not the prompt | Prompts are requests; server-side rejection is enforceable |
| Single public origin, path-routed | Enables SharedArrayBuffer, removes CORS, one cert to manage |
| Syntax errors are not mastery opportunities | Otherwise the gate punishes normal beginner iteration |
| Throttling despite being on a LAN | The LAN is where the attacker sits; keyspaces are tiny |
| Two reading tiers: `grade3` + `adult` | Adult is the natural base to simplify from; `grade7` added on evidence |
| Flat REST under `/v1/` | Free now; unlocks SIS/LTI integration later without touching the SPA |
| Light mode keeps code on `--ink-800` | Brand survives a white page; code gets its best contrast; the prose/code boundary becomes structure |
| Sentence-case mono labels at `grade3` | Uppercase tracked text is slower for early readers; house treatment stays for adults |
| Editor syntax uses `c1…c7`, never the accents | A green string must not read as "correct" |
| Monorepo for the platform, separate curriculum repo | Contract changes stay one atomic commit; curriculum has its own cadence and contributors |
| Docs in `docs/`, no docs repo | Docs that cannot change in the same PR as the code will rot |
| ADRs rather than only a decisions table | A reversal appends a superseding record instead of silently editing history |
| Chart in the main repo, versioned with the app | Values are the app's config surface; a split chart drifts from its images |
| One chart, no per-service charts | Five services, one product, one release |
| No Postgres subchart | `embedded` exists so the restore path is understandable; a dependency undoes that |
| Chart published as an OCI artifact | One registry, one auth, one mirroring tool for air-gapped sites |

---

## 19. AI-assisted guidance & reporting (optional)

Off by default and absent from the deployment when disabled. Any OpenAI-compatible
endpoint works — Ollama, vLLM, llama.cpp, LM Studio, OpenRouter, or a commercial API.

### 19.1 Two features, two toggles

These have different risk profiles and ship behind separate flags. A school may well
want the first and refuse the second.

| Feature | Shape | Risk |
|---|---|---|
| `reporting` | Batch, nightly, adult-facing; turns existing data into prose | Low — a wrong sentence in a parent digest |
| `guidance` | Real-time, child-facing; fires on a wrong answer | High — points directly at the mastery mechanism |

**There is no chat interface.** The learner never composes a prompt, never types to the
model, and cannot continue a conversation. The only affordance is a hint that appears.
An open text box to a model is a different product with a different safety surface, and
it is the single thing most likely to make a school decline.

### 19.2 Guidance trigger rules

"On incorrect answer" is not precise enough on its own. The naive version teaches
farming: fail deliberately, collect help.

1. **The authored ladder goes first.** The first two *semantic* failures get reviewed,
   readability-checked hints from `meta.yaml`. The tutor fires only once those are
   exhausted and the learner is still wrong.
2. **Once per step, not per attempt.** One AI hint per step, and it does not refresh on
   the next wrong submission. Otherwise "submit garbage repeatedly for a more specific
   hint" is a discoverable strategy, and a child will discover it.
3. **Suppressed on `predict` and `parsons` steps by default.** Those are the
   understanding probes; the point is that they are unaided. Configurable per step type
   and overridable per step via `aiGuidance` (§5.4).
4. **Never on a spaced-review item.** Review measures retention. Assistance there
   invalidates the signal entirely.

### 19.3 Request payload

Fully assembled by the API. The learner supplies none of it.

```json
{
  "language": "python",
  "readingTier": "grade3",
  "skills": ["for-loop-range"],
  "instruction": "<the step's prompt text>",
  "learnerCode": "<their submission>",
  "failures": [{ "expected": "0..9", "actual": "1..10" }],
  "authoredHintsAlreadyShown": ["Remember, range(10) counts 0 to 9."]
}
```

Sending the already-shown hints matters — without them the model rephrases what the
learner just read and ignored.

Deliberately absent: display name, user ID, learner history, anything about any other
learner. The payload is a code snippet and a test failure. That keeps the privacy story
intact even against a cloud endpoint.

### 19.4 Structured output and server-side validation

The model is asked for JSON. The API then **enforces** the contract rather than
trusting it.

```json
{
  "observation": "Your loop is counting from 1, but the test wants it to start at 0.",
  "nudge": "What number does range(10) start counting from?",
  "confidence": "high"
}
```

Rejection rules, applied in the API before anything reaches the browser:

- Contains a code fence, or a line that parses as a statement in the target language
- Contains the reference solution's distinguishing tokens
- Exceeds the word ceiling for the reading tier (~35 words at `grade3`)
- Fails the same readability check the curriculum CI applies
- `confidence` is anything other than `high`

**A rejected hint falls back to the authored ladder, silently.** The prompt is a
request; the validator is the guarantee. Log every rejection — a rising rejection rate
on a step means that step needs better authored hints.

### 19.5 Presentation

One short line in the feedback area. No avatar, no persona, no name, no first person,
no typing animation. It should read as though the app noticed something, not as though
a character arrived to help. Anything that invites conversation invites a child to try
to converse with something that cannot hear her.

Visually distinguished from authored hints — a background tint is enough. Parents and
instructors should be able to tell at a glance which guidance was written and which was
generated.

### 19.6 Effect on mastery

An attempt solved after AI guidance contributes less to `P(known)` and **requires a
transfer item before the skill can be marked mastered**. Because guidance is
once-per-step and late in the ladder, this penalty is rare enough not to feel punitive.

This is why `hint_source` exists in the event log (§8). Without it the mastery estimate
silently measures how well a learner uses the AI rather than whether she understands
loops.

### 19.7 Service and configuration

A separate optional `tutor` service. An 8–10 second LLM timeout has no business in a
service where everything else answers in 50ms, and keeping it separate leaves the API
free of a dead config path.

Request path: browser → `api` (auth, context assembly, validation) → `tutor`
(stateless) → endpoint. The API remains the only front door and the only service
touching Postgres.

```yaml
tutor:
  enabled: false
  baseUrl: http://ollama:11434/v1
  model: qwen2.5-coder:7b
  apiKeySecret: tutor-llm-key       # optional; local endpoints need none
  timeoutSeconds: 8
  latencyGate:
    enabled: true                   # measure p95 at startup; disable guidance if over
    probeOnStart: true
  features:
    guidance: false
    reporting: false
  guidance:
    afterAuthoredHintsExhausted: true
    maxPerStep: 1
    suppressedStepTypes: [predict, parsons]
    suppressOnReview: true
    wordCeiling: { grade3: 35, grade7: 60, adult: 80 }
```

**Degrade, never block.** Endpoint down, slow, or rate-limited → fall back to the
authored ladder. The learner never sees a spinner that does not resolve.

**The latency gate is not optional.** An 8s budget and a local 7B model on N100 CPU are
mutually exclusive — that combination measures in tens of seconds, not single digits.
Rather than documenting the contradiction, the tutor probes real p95 at startup and
refuses to enable `guidance` if it exceeds the budget, logging why. A small model on a
GPU, or a 1–3B model on capable CPU, clears it; the default config does not.

**Watch the rejection rate too.** Small local models frequently miss rigid output
constraints. If §19.4 rejects a large share of generations, the system burns inference
for no pedagogical gain and should fall back to §19.11 permanently. Expose the
rejection rate as a metric and set an alarm on it.

### 19.8 Caching and the misconception corpus

Wrong answers cluster hard — most learners fail a given step in one of roughly five
ways. Cache on `(step_id, normalized_code_hash)`.

Cost and latency are the smaller benefit. The cache is a **misconception corpus**:
after a term it shows the most common ways learners break each step, and the good
generated hints can be promoted into authored, reviewed, readability-checked hints in
the curriculum repo. The AI becomes a tool for improving content rather than a
permanent runtime dependency.

### 19.9 Privacy and sizing

"Student data never leaves your building" is the strongest commercial claim in this
design. A cloud endpoint sends learner code and failure patterns to a third party and
ends it.

- Default `baseUrl` to a local endpoint; ship Ollama as the documented reference config
- Cloud endpoints require an explicit admin choice behind a plainly worded consent screen
- For a school customer, cloud inference is a contractual question, not a checkbox

**Sizing reality:** the N100 that comfortably serves this application cannot run a
useful model. Local inference means a GPU in the box or a separate inference host on
the LAN. Worth knowing before promising a customer local AI on the appliance they
already bought.

### 19.10 Parent reporting

Same endpoint, separate toggle, entirely different shape: a nightly batch job over the
existing `progress_events` projection (§12.5), turning the numbers into prose. No
learner interaction, no real-time path, no validation beyond length and tone. If
reporting is disabled the digest still renders — it just stays structured rather than
narrative.

### 19.11 Lower-risk variant worth building first

Rather than generating novel hints, use the model to **rephrase authored hints at the
learner's reading tier**. The pedagogical content stays deterministic, reviewed and
correct; only the delivery adapts. Much smaller prompt, far less that can go wrong, and
it makes the three-tier authoring burden flagged in §20 largely disappear.

This is likely the right first implementation, with generated guidance following once
there is real failure data to evaluate it against.

---

## 20. For review

Specific things worth a second look before implementation:

1. **BKT threshold and parameters** (§6.1) — 0.90 over 3 opportunities is a starting
   guess. Too strict frustrates; too loose defeats the purpose.
2. **Failure thresholds** (§6.4) — 2/4/6 is a judgment call, not a finding.
3. **Spaced review intervals** (§6.3) — 3/7/21 days is conventional but untested here.
4. ~~Reading tier count~~ — **decided:** two tiers, `grade3` + `adult` (§5.6).
5. **Phase 1 scope** — the walking skeleton may still be too large for one sitting.
6. **Learner sign-in method** — PIN is simplest; QR cards are the right answer if a
   tutoring center is a near-term goal rather than a distant one.
7. **Whether to ship generated guidance at all** (§19.11) — stopping at tier
   rephrasing keeps every hint reviewed and may be enough.
8. **Open-source licence** (§10.1) — Apache-2.0 versus AGPL-3.0 for the platform.
   Decide before the first external contributor.

---

## 21. Changelog

**0.6** — Added the Helm chart (§9.7), OCI chart publishing (§11.4) and deployment
CI with Compose parity (§11.5).

**0.5** — Named the project Copperkeep. Added §10: two repos under one org, the
monorepo layout, docs beside the code, and ADRs. Added the licence question to §19.
Renumbered §10–§20 → §11–§21.

**0.4** — Added the visual design system (§13): dark theme adopted from the house
style verbatim, a measured light counterpart, the accent-to-mastery meaning map,
and tier-aware label treatment. Added Phase 0 spike and the Phase 1 exit criterion
(§16), the adapter contract suite (§4), the threat model (§7). Dropped xterm.js
(§12.6). Renumbered §13–§20 → §14–§21.

**0.3.1** — Decisions taken: two reading tiers (§5.6, §20); API routes under `/v1/`
(§3.3).

**0.3** — Second full pass. Added the API surface (§3.3) and the API's read-only
dependency on `content`. Made TLS a hard requirement (§9.5) on secure-context grounds.
Vendored micropip wheels (§4). Made `transfer` a flag rather than a step type. Renamed
hint counters to `afterSemanticFailures`. Separated the per-step and per-skill ladders
(§6.5). Added `device_credentials`, `failure_kind` as a column, `org_id` on every
table, row-locking and the review scheduler (§8). Fixed the §9.2 load claim to match
§12.4. Reconciled §5.6 with Phase 2 on tier count. Fixed stale cross-references left
by the 0.2 renumbering.

**0.2** — Applied the first adversarial review: single-origin ingress and COOP/COEP,
failure classification, per-item `pGuess`, ontology transitions, abuse controls,
storage persistence, inference latency gate. Made BKT server-authoritative and
separated the two trust layers (§8). Added the subresource gate to the curriculum
pipeline and the loader state machine.

**0.1** — Initial plan.
