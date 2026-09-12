# 0008 — One chart, in this repo, versioned with the app

**Status:** Accepted

## Context

Three conventional choices, each defensible in isolation: a chart repository of its own,
a chart per service, and a Postgres subchart dependency.

## Decision

- The chart lives in `deploy/helm/`, in this repo.
- One chart for all five services, not one per service.
- `version` and `appVersion` both track the app's semver.
- No Postgres subchart.
- Published as an **OCI artifact** to the same registry as the images.

## Consequences

- The chart's values **are** the application's configuration surface, so a new API
  setting is a template change in the same commit. A split chart drifts from the images
  it deploys, which is the most common way a Helm chart becomes untrustworthy.
- Five services are five faces of one product released on one version. A chart per
  service would mean five version bumps per release and a customer wiring them together
  by hand.
- Independent chart versioning is for charts that package *someone else's* software.
  Here they ship as one thing, and the release job verifies `Chart.yaml` matches the git
  tag before publishing anything.
- No subchart means `embedded` Postgres is a StatefulSet, a PVC, a Service and a
  `pg_dump` CronJob — well under a hundred lines, readable in one sitting. That is the
  entire reason `embedded` exists: so the restore path is something you understand. A
  dependency would undo it, drag in a large configuration surface, tie the release
  cadence to someone else's, and expose the project to upstream licensing and
  image-hosting changes.
- OCI publishing means one registry, one set of credentials, one signing story, and an
  air-gapped customer mirrors charts and images with one tool instead of two. No
  `gh-pages` branch, no `index.yaml`.
- The risk this leaves is **Compose/Helm drift**. Two defences: both render the same
  `/config.json` and use the same environment variable names, and CI runs one smoke
  script against both.
