#!/usr/bin/env bash
# Nightly: every database and role in the cluster, gzipped, to S3.
# Run by cron on the instance as ubuntu; see docs/deployment.md, "Backups".
#
#   BACKUP_BUCKET    required, e.g. whiteboard-backups-174683182383
#   BACKUP_PING_URL  optional; fetched only after a good upload, so a missed
#                    ping is the alert that a backup didn't happen.
set -euo pipefail

: "${BACKUP_BUCKET:?BACKUP_BUCKET is not set}"
DUMP_CMD="${DUMP_CMD:-docker compose -f /opt/whiteboard/compose.prod.yml exec -T postgres pg_dumpall -U whiteboard}"

stamp="$(date -u +%Y-%m-%dT%H%MZ)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
file="$work/whiteboard-$stamp.sql.gz"

# To a file first: piping straight into S3 would upload a truncated dump if
# pg_dumpall died halfway, and the upload would still look like a success.
$DUMP_CMD | gzip -9 > "$file"
gzip -t "$file"
# pg_dumpall writes this as its last line; a dump without it is incomplete.
gunzip -c "$file" | tail -n 5 | grep -q 'PostgreSQL database cluster dump complete'

aws s3 cp "$file" "s3://$BACKUP_BUCKET/whiteboard/$(basename "$file")" --only-show-errors --sse AES256
echo "$(date -u +%FT%TZ) backed up $(du -h "$file" | cut -f1) to s3://$BACKUP_BUCKET/whiteboard/$(basename "$file")"

if [ -n "${BACKUP_PING_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "$BACKUP_PING_URL" > /dev/null
fi
