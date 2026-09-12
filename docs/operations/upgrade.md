# Upgrade

Two things version independently: the **application** (semver, `0.1.2`) and the
**curriculum** (calendar version, `2026.09.1`).

## Application

```sh
helm upgrade copperkeep oci://ghcr.io/copperkeep/charts/copperkeep --version 0.2.0 --reuse-values
```

The chart version always equals the app version, and the release job refuses to publish
a chart whose version does not match the images. Migrations run as a `pre-upgrade` Job
before any new pod starts — never on API startup, which is what keeps deploy order and
replica count from mattering.

Compose:

```sh
cd deploy/compose
# Edit COPPERKEEP_VERSION in .env, then:
docker compose pull && docker compose up -d
```

**Do not use Watchtower.** An auto-update landing mid-lesson is a bad experience.

## Curriculum

```sh
helm upgrade copperkeep ... --set content.tag=2026.10.1 --set audio.tag=2026.10.1
```

The curriculum manifest declares `minAppVersion`. The API checks it at startup and
**fails its readiness probe** on a mismatch, so a curriculum that needs a newer app never
goes live — the old pods keep serving. The SPA checks it too and shows a plain message
rather than a broken lesson.

If you see the API stuck not-ready after a content bump, that is this check working.
`kubectl logs` will name the versions; upgrade the app first.

## Rolling back

Content rollback is atomic with the image, because content is files rather than database
rows:

```sh
helm rollback copperkeep
```

Nothing in `progress_events` is rewritten by an upgrade or a rollback. Skill and step IDs
are stable across content versions by contract — that is the one thing a curriculum
release genuinely cannot break, and curriculum CI fails the build if it does.

## After a BKT parameter change

Parameters live in `skills.yaml`, so retuning them arrives as a curriculum release.
Existing `skill_state` was computed under the old parameters. Rebuild it:

```sh
curl -X POST -b adult.cookies https://learn.example.com/v1/admin/learners/<id>/recompute
```

This replays `progress_events` through the current parameters and ontology transitions.
It is a projection, not a migration — you can run it as often as you like.
