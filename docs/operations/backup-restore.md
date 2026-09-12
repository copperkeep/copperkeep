# Backup and restore

On-premise means nobody else is doing this.

**Follow this once, on the real machine, before you need it.** A restore procedure you
have not executed is a hope, not a plan — and you will next read this page under
pressure, on a bad day.

## What needs backing up

Only Postgres. Content is in an image: if you lose it, you pull it again. Progress
events, submissions, accounts and sessions are the only irreplaceable state.

## Backup (Helm, embedded mode)

A CronJob runs `pg_dump -Fc` nightly into a PVC and prunes dumps older than
`postgres.backup.retentionDays`.

```sh
kubectl -n copperkeep get cronjob copperkeep-copperkeep-backup
kubectl -n copperkeep create job --from=cronjob/copperkeep-copperkeep-backup manual-backup
```

**Point that PVC at a NAS.** A backup on the same disk as the database is not a backup.
Set `postgres.backup.storage.className` to a network-backed class, or mount the PVC's
node path to a share.

## Backup (Compose)

Nothing runs on a schedule. Add this to the host's crontab:

```sh
0 2 * * * cd /srv/copperkeep/deploy/compose && \
  docker compose exec -T postgres pg_dump -U copperkeep -Fc copperkeep \
  > /mnt/nas/copperkeep-$(date +\%Y-\%m-\%d).dump
```

## Restore

The database must exist and be empty of Copperkeep's tables. The safest path is a fresh
database rather than restoring over a live one.

### Helm

```sh
# 1. Stop writers. The API is the only one.
kubectl -n copperkeep scale deploy/copperkeep-copperkeep-api --replicas=0

# 2. Copy the dump into the Postgres pod.
kubectl -n copperkeep cp ./copperkeep-2026-09-10.dump \
  copperkeep-copperkeep-postgres-0:/tmp/restore.dump

# 3. Recreate the database.
kubectl -n copperkeep exec -it copperkeep-copperkeep-postgres-0 -- \
  psql -U copperkeep -d postgres -c "DROP DATABASE copperkeep;" \
                                  -c "CREATE DATABASE copperkeep OWNER copperkeep;"

# 4. Restore.
kubectl -n copperkeep exec -it copperkeep-copperkeep-postgres-0 -- \
  pg_restore -U copperkeep -d copperkeep --no-owner /tmp/restore.dump

# 5. Bring the API back.
kubectl -n copperkeep scale deploy/copperkeep-copperkeep-api --replicas=1
```

### Compose

```sh
docker compose stop api
cat copperkeep-2026-09-10.dump | docker compose exec -T postgres \
  pg_restore -U copperkeep -d copperkeep --clean --if-exists --no-owner
docker compose start api
```

## Verify the restore

Do not skip this. A `pg_restore` that printed warnings may still have left you short.

```sh
# Accounts and events came back:
psql -U copperkeep -d copperkeep -c "SELECT count(*) FROM users;"
psql -U copperkeep -d copperkeep -c "SELECT count(*), max(occurred_at) FROM progress_events;"

# The derived cache is recomputable, so rebuild it rather than trusting it:
curl -X POST -b adult.cookies https://learn.example.com/v1/admin/learners/<id>/recompute
```

That last step is the point of the append-only event log: `skill_state` is a cache, and
after any restore the honest move is to rebuild it from the log rather than assume it
survived intact.

## What a restore loses

- **Sessions.** Every learner signs in again. Expected.
- **Anything since the last dump.** Nightly means up to 24 hours of progress events. If
  that matters, dump more often; the database is small.
