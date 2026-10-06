#!/usr/bin/env bash
# Failure alert for a systemd unit. Wired via `OnFailure=papa-alert@%n.service`.
# Usage: alert.sh <unit-name>
#
# Always writes to the journal (the record that stays on the VPS) and, if RESEND_API_KEY
# and ALERT_EMAIL are set, sends an email. No logs in the email on purpose: the body is fixed
# and the detail is one `journalctl` away, with no risk of leaking data on the way.
# No `-e`: an alert that crashes halfway must not be the reason nobody learns of the failure.
set -uo pipefail

UNIT=${1:-unknown-unit}
ENV_FILE=${ENV_FILE:-/opt/papa/.env}
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

HOST=$(hostname)
WHEN=$(date -u +%FT%TZ)
# Safe characters only: these values go into a hand-built JSON body.
SAFE_UNIT=$(printf '%s' "$UNIT" | tr -cd 'A-Za-z0-9@._-')
SAFE_HOST=$(printf '%s' "$HOST" | tr -cd 'A-Za-z0-9._-')
SUBJECT="PAPA RENT: $SAFE_UNIT failed on $SAFE_HOST"
BODY="Unit $SAFE_UNIT failed on $SAFE_HOST at $WHEN (UTC). Detail: journalctl -u $SAFE_UNIT -n 50 --no-pager"

echo "[alert] $SUBJECT" >&2
command -v logger >/dev/null 2>&1 && logger -t papa-alert -p daemon.err "$SUBJECT"

if [ -z "${RESEND_API_KEY:-}" ] || [ -z "${ALERT_EMAIL:-}" ]; then
  echo "[alert] no RESEND_API_KEY or ALERT_EMAIL: alert stays in the journal only" >&2
  exit 0
fi

# Strip quotes and backslashes: the JSON body is built with printf.
FROM=${EMAIL_FROM:-PAPA RENT <alerts@example.com>}
FROM=${FROM//\"/}
FROM=${FROM//\\/}
TO=$(printf '%s' "$ALERT_EMAIL" | tr -cd 'A-Za-z0-9@._+-')
RESPONSE=$(mktemp)
trap 'rm -f "$RESPONSE"' EXIT
PAYLOAD=$(printf '{"from":"%s","to":["%s"],"subject":"%s","text":"%s"}' \
  "$FROM" "$TO" "$SUBJECT" "$BODY")

STATUS=$(curl -sS -o "$RESPONSE" -w '%{http_code}' \
  -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if [ "$STATUS" = "200" ] || [ "$STATUS" = "201" ]; then
  echo "[alert] email sent to $TO" >&2
  exit 0
fi

echo "[alert] ERROR: Resend returned HTTP $STATUS" >&2
head -c 500 "$RESPONSE" >&2 2>/dev/null
exit 1
