#!/usr/bin/env bash
# Restores the newest backup into a throwaway Postgres and counts what came
# back. Touches nothing in production. Run it monthly, and after any change
# to backup.sh: a backup nobody has restored is a hope, not a backup.
#
#   BACKUP_BUCKET  required
#   BACKUP_KEY     optional; a specific object instead of the newest
set -euo pipefail

: "${BACKUP_BUCKET:?BACKUP_BUCKET is not set}"
key="${BACKUP_KEY:-$(aws s3 ls "s3://$BACKUP_BUCKET/whiteboard/" | awk '{print $4}' | sort | tail -n 1)}"
[ -n "$key" ] || { echo "no backups in s3://$BACKUP_BUCKET/whiteboard/" >&2; exit 1; }
key="${key#whiteboard/}"

work="$(mktemp -d)"
name="whiteboard-restore-drill-$$"
trap 'docker rm -f "$name" > /dev/null 2>&1 || true; rm -rf "$work"' EXIT

aws s3 cp "s3://$BACKUP_BUCKET/whiteboard/$key" "$work/dump.sql.gz" --only-show-errors
docker run -d --name "$name" -e POSTGRES_USER=whiteboard -e POSTGRES_PASSWORD=drill postgres:18 > /dev/null
until docker exec "$name" pg_isready -U whiteboard > /dev/null 2>&1; do sleep 1; done
sleep 2

# "role whiteboard already exists" is expected: the fresh cluster made it.
gunzip -c "$work/dump.sql.gz" | docker exec -i "$name" psql -q -U whiteboard -d postgres > "$work/restore.log" 2>&1 || true
grep -v 'role "whiteboard" already exists' "$work/restore.log" | grep -i 'error' && { echo "restore reported errors" >&2; exit 1; }

docker exec "$name" psql -U whiteboard -d whiteboard -Atc "
  SELECT 'organizations ' || count(*) FROM tenant
  UNION ALL SELECT 'users ' || count(*) FROM \"user\"
  UNION ALL SELECT 'appointments ' || count(*) FROM appointment
  UNION ALL SELECT 'migrations ' || count(*) FROM pgmigrations"
echo "restored $key into a throwaway container; removed on exit"
