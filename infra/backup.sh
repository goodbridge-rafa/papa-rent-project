#!/usr/bin/env bash
# Dump of the production Postgres + offsite copy (Backblaze B2 via rclone).
#
# Who runs this: the systemd timer `papa-backup.timer` (infra/systemd/, installed by
# infra/deploy.sh). Manual run on the VPS: `sudo systemctl start papa-backup.service`
# or `sudo /opt/papa/app/infra/backup.sh`. See the result: `journalctl -u papa-backup`.
#
# Restore (a backup that was never tested is not a backup):
#   gunzip -c /opt/papa/backups/papa-YYYYMMDD-HHMMSS.sql.gz | \
#     docker compose -f /opt/papa/app/infra/docker-compose.prod.yml --env-file /opt/papa/.env \
#     exec -T db psql -U papa -d papa
#
# Golden rule: nothing fails silently. If upload is configured and does not happen,
# the script exits with an error; the unit's OnFailure sends the alert (infra/alert.sh).
set -euo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-/opt/papa/app/infra/docker-compose.prod.yml}
ENV_FILE=${ENV_FILE:-/opt/papa/.env}

# The timer already injects the .env (EnvironmentFile); on a manual run we load it here
# so both paths behave identically. The file must be shell-safe (values with spaces
# quoted), which is also what systemd expects.
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

BACKUP_DIR=${BACKUP_DIR:-/opt/papa/backups}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
REMOTE=${BACKUP_REMOTE:-}
STATE_FILE="$BACKUP_DIR/.last-run"
STAMP=$(date -u +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/papa-$STAMP.sql.gz"
PART="$OUT.part"
# Sanity floor: a valid dump, even of an empty database, is well above this.
MIN_BYTES=${BACKUP_MIN_BYTES:-512}

log() { printf '[backup] %s\n' "$*"; }
fail() {
  printf '[backup] ERROR: %s\n' "$*" >&2
  printf 'fail %s %s\n' "$(date -u +%FT%TZ)" "$*" >"$STATE_FILE" 2>/dev/null || true
  exit 1
}

mkdir -p "$BACKUP_DIR"
trap 'rm -f "$PART"' EXIT

[ -f "$COMPOSE_FILE" ] || fail "production compose not found at $COMPOSE_FILE"
[ -f "$ENV_FILE" ] || fail "environment file not found at $ENV_FILE"

# --env-file is mandatory: compose interpolates POSTGRES_PASSWORD and aborts without it.
log "dump of papa → $OUT"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T db \
  pg_dump -U papa -d papa --no-owner | gzip -9 >"$PART" ||
  fail "pg_dump failed (is the database up? docker compose ps)"

gzip -t "$PART" 2>/dev/null || fail "corrupted file, gzip -t failed"
SIZE=$(wc -c <"$PART")
[ "$SIZE" -ge "$MIN_BYTES" ] || fail "dump too small ($SIZE bytes < $MIN_BYTES): suspicious"
mv "$PART" "$OUT"
log "local dump ok ($SIZE bytes)"

# Local retention. Remote retention is left to the bucket lifecycle policy: deleting
# offsite copies from a script is the kind of automation you only regret once.
find "$BACKUP_DIR" -maxdepth 1 -name 'papa-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
log "local retention: $RETENTION_DAYS days"

if [ -z "$REMOTE" ]; then
  log "WARNING: BACKUP_REMOTE empty — local copy only, no offsite. Set it in $ENV_FILE."
else
  command -v rclone >/dev/null 2>&1 ||
    fail "BACKUP_REMOTE=$REMOTE but rclone is not installed (apt install rclone)"
  log "upload → $REMOTE"
  rclone copy "$OUT" "$REMOTE" --stats-one-line --stats 0 ||
    fail "upload to $REMOTE failed (RCLONE_CONFIG_* credentials?)"
  # Confirm the object really is there: a successful `copy` to the wrong remote
  # is still a backup that does not exist on the day it is needed.
  rclone lsf "$REMOTE" --include "$(basename "$OUT")" | grep -q . ||
    fail "upload reported done but $(basename "$OUT") does not show up in $REMOTE"
  log "upload confirmed at $REMOTE"
fi

printf 'ok %s %s %s\n' "$(date -u +%FT%TZ)" "$OUT" "$SIZE" >"$STATE_FILE"
log "backup ok: $OUT"
