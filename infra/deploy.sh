#!/usr/bin/env bash
# Deploy to the VPS. Usage: infra/deploy.sh papa@SERVER_IP [branch]
#
# In this order: validates .env → updates the code → installs/updates the backup
# timer → builds the images → migrates the database → starts api/engine/caddy → waits for
# the API to become healthy. Any failing step aborts the deploy and shows the logs.
set -euo pipefail
HOST="${1:?usage: deploy.sh user@host [branch]}"
BRANCH="${2:-}"
REPO_URL="${PAPA_REPO_URL:-https://github.com/your-org/papa-rent.git}"

# ssh does not preserve argv: it joins the arguments into a single string that the remote
# shell splits again on spaces. An empty argument collapses and shifts the following ones,
# so the optional one ($BRANCH) must come LAST — only then does `deploy.sh papa@IP`,
# the documented invocation, reach the remote with REPO_URL in the right position.
ssh "$HOST" bash -s -- "$REPO_URL" "$BRANCH" <<'REMOTE'
set -euo pipefail
REPO_URL="${1:?}"
BRANCH="${2:-}"
APP_DIR=/opt/papa/app
ENV_FILE=/opt/papa/.env
COMPOSE_FILE="$APP_DIR/infra/docker-compose.prod.yml"
SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"

step() { printf '\n=== %s\n' "$*"; }
fail() { printf 'deploy aborted: %s\n' "$*" >&2; exit 1; }
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

step "environment"
[ -f "$ENV_FILE" ] || fail "missing $ENV_FILE — copy .env.example, fill it in and run again"
grep -qE '^POSTGRES_PASSWORD=.+' "$ENV_FILE" ||
  fail "POSTGRES_PASSWORD missing or empty in $ENV_FILE"
grep -qE '^POSTGRES_PASSWORD=CHANGE_ME' "$ENV_FILE" &&
  fail "POSTGRES_PASSWORD is still the example value — change it before the first start"
echo "ok: $ENV_FILE"

step "code"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
git fetch --prune origin
[ -n "$BRANCH" ] && git checkout "$BRANCH"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git pull --ff-only origin "$CURRENT_BRANCH"
echo "on $CURRENT_BRANCH @ $(git rev-parse --short HEAD)"

step "scheduled backup"
if command -v systemctl >/dev/null 2>&1; then
  $SUDO install -m 0644 -t /etc/systemd/system \
    infra/systemd/papa-backup.service \
    infra/systemd/papa-backup.timer \
    infra/systemd/papa-alert@.service
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now papa-backup.timer
  $SUDO systemctl list-timers --no-pager papa-backup.timer || true
else
  echo "WARNING: no systemd — the backup is not scheduled on this machine" >&2
fi

step "images"
compose build

step "migrations and services"
# api and engine depend on `migrate` with condition: service_completed_successfully,
# so compose runs the migrations and only starts the rest if they exit with 0.
if ! compose up -d --remove-orphans; then
  echo "--- migration logs ---" >&2
  compose logs --no-color --tail 80 migrate >&2 || true
  fail "compose up failed"
fi
MIGRATE_CID=$(compose ps -aq migrate | head -1)
if [ -n "$MIGRATE_CID" ]; then
  MIGRATE_EXIT=$(docker inspect -f '{{.State.ExitCode}}' "$MIGRATE_CID")
  [ "$MIGRATE_EXIT" = "0" ] || {
    compose logs --no-color --tail 80 migrate >&2 || true
    fail "migrations exited with code $MIGRATE_EXIT"
  }
  echo "migrations ok"
fi

step "API health"
API_CID=$(compose ps -q api)
[ -n "$API_CID" ] || fail "api container does not exist after up"
STATUS=starting
for _ in $(seq 1 60); do
  STATUS=$(docker inspect -f '{{.State.Health.Status}}' "$API_CID" 2>/dev/null || echo starting)
  if [ "$STATUS" = "healthy" ]; then break; fi
  if [ "$STATUS" = "unhealthy" ]; then break; fi
  sleep 5
done
if [ "$STATUS" != "healthy" ]; then
  echo "--- api logs ---" >&2
  compose logs --no-color --tail 80 api >&2 || true
  fail "api stayed '$STATUS' after 5 minutes"
fi
echo "api healthy"

step "cleanup"
docker image prune -f >/dev/null
compose ps
REMOTE
