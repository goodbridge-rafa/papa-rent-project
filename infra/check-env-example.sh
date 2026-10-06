#!/usr/bin/env bash
# Ensures .env.example documents everything needed to run the project:
#   1. every variable the code reads (process.env.X / env.X / env["X"]);
#   2. every variable interpolated in the compose files (${X});
#   3. no key declared twice (every parser is silently last-wins).
# Why: POSTGRES_PASSWORD was required by the production compose and missing from the
# example — anyone copying the file put the database online without a password.
#
# Usage: infra/check-env-example.sh [file] (also runs in CI; the argument only
# serves the tests in infra/test-infra-scripts.sh)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
EXAMPLE="${1:-.env.example}"

# These come from the runtime environment (Node, pnpm, runner, compose), never from a .env.
IGNORED="NODE_ENV INIT_CWD HTTP_PROXY HTTPS_PROXY CI"

[ -f "$EXAMPLE" ] || { echo "cannot find $EXAMPLE" >&2; exit 1; }

# A variable counts as documented even when commented out: some options change behaviour
# when empty and are therefore commented out on purpose.
documented=$(grep -oE '^[[:space:]]*#?[[:space:]]*[A-Z][A-Z0-9_]*=' "$EXAMPLE" | tr -d " #=" | sort -u)

# Repeated keys: compose (env_file), the `set -a; . .env` in backup.sh/alert.sh and the
# systemd EnvironmentFile all keep the LAST occurrence, without warning — so a second
# empty entry silently overrides the value the owner set in the first.
# Only active lines count: a commented line is inert for those parsers, and some prose
# comments start with `# NAME=…` (see the BACKUP_REMOTE note) that are not declarations
# and must not be read as repeats.
duplicated=$(grep -oE '^[A-Z][A-Z0-9_]*=' "$EXAMPLE" | tr -d '=' | sort | uniq -d)
if [ -n "$duplicated" ]; then
  echo "ERROR: repeated keys in $EXAMPLE (the last one always wins, silently):" >&2
  # shellcheck disable=SC2086
  for name in $duplicated; do
    echo "  - $name (lines: $(grep -nE "^$name=" "$EXAMPLE" | cut -d: -f1 | tr '\n' ' '))" >&2
  done
  exit 1
fi

used_by_code=$(grep -rhoE "(process\.)?env(\.[A-Z][A-Z0-9_]+|\[[\"'][A-Z][A-Z0-9_]+[\"'])" \
  apps packages --include='*.ts' --include='*.tsx' |
  grep -oE '[A-Z][A-Z0-9_]+' | sort -u)

used_by_compose=$(grep -rhoE '\$\{[A-Z][A-Z0-9_]*' infra/docker-compose*.yml |
  sed 's/^\${//' | sort -u)

all_used=$(printf '%s\n%s\n' "$used_by_code" "$used_by_compose" | grep . | sort -u)

missing=""
# Splitting on spaces/lines is intentional in these loops: the lists are variable names.
# shellcheck disable=SC2086
for name in $all_used; do
  case " $IGNORED " in *" $name "*) continue ;; esac
  case $'\n'"$documented"$'\n' in *$'\n'"$name"$'\n'*) ;; *) missing="$missing $name" ;; esac
done

if [ -n "$missing" ]; then
  echo "ERROR: variables used but missing from $EXAMPLE:" >&2
  # shellcheck disable=SC2086
  for name in $missing; do echo "  - $name" >&2; done
  exit 1
fi

echo "$EXAMPLE covers $(printf '%s\n' "$all_used" | grep -c .) used variables: ok"
