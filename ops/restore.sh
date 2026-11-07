#!/usr/bin/env bash
# Disaster recovery: loads a backup into the production cluster. Only for a
# cluster with nothing in it, such as a new instance or a recreated volume;
# it does not merge into existing data. Practise with restore-drill.sh first.
#
#   ./restore.sh <object name, e.g. whiteboard-2026-11-08T0317Z.sql.gz>
#   BACKUP_BUCKET  required
set -euo pipefail

: "${BACKUP_BUCKET:?BACKUP_BUCKET is not set}"
key="${1:?which backup? see: aws s3 ls s3://$BACKUP_BUCKET/whiteboard/}"
compose="docker compose -f /opt/whiteboard/compose.prod.yml"

existing="$($compose exec -T postgres psql -U whiteboard -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname = 'whiteboard'")"
if [ "$existing" != "0" ] && [ "${FORCE:-}" != "yes" ]; then
  echo "The cluster already has a whiteboard database. Restore only into an empty one." >&2
  echo "(After a fresh 'up', compose has created an empty one: rerun with FORCE=yes.)" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
aws s3 cp "s3://$BACKUP_BUCKET/whiteboard/$key" "$work/dump.sql.gz" --only-show-errors

$compose stop app
[ "$existing" != "0" ] && $compose exec -T postgres dropdb -U whiteboard whiteboard
gunzip -c "$work/dump.sql.gz" | $compose exec -T postgres psql -q -U whiteboard -d postgres
$compose start app
echo "restored $key; check the site, then the app logs"
