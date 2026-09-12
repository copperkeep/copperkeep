# Conventions

## The eight coupling rules

These keep the deployment decoupled. They are worth enforcing in review.

1. **Only the API touches Postgres.** Content never does. Two services on one database
   is how you get a distributed monolith.
2. **The SPA fetches `/config.json` at boot.** Never bake API or content URLs into the
   bundle, or you need a rebuild per environment.
3. **Content, audio and runtime URLs are configuration, not imports.** This is what lets
   curriculum and Pyodide version independently of the web build.
4. **Migrations run as a Helm `pre-upgrade` Job**, never on API startup.
5. **One public origin, path-routed at the ingress.** Never publish a second port to the
   browser: it breaks cross-origin isolation and reintroduces CORS.
6. **Every service DNS name is a chart value.**
7. **The API degrades rather than crashes if content is unreachable.** Learners keep
   their session; new lessons just do not load.
8. **Skill and step IDs are stable across content versions.** The one contract that
   genuinely cannot be broken.

## Naming

- Skill and step IDs are **never renamed and never reused**. They are opaque strings in
  an append-only event log; a rename silently orphans every historical event, mastery
  estimates reset, and parent reports go blank. A split or merge is an entry in
  `skills.yaml`'s `transitions` list, applied at projection time.

## Where things are written down

- A decision that would be expensive to revisit → `docs/adr/`.
- Something an operator will read under pressure → `docs/operations/`.
- Something a lesson author needs → the curriculum repo's `docs/authoring/`.

Docs live beside the code because documentation in a second repo cannot change in the
same commit as the code it describes, so it cannot be required by the same pull request,
so it rots.
