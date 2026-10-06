#!/usr/bin/env bash
# Regression tests for the infra scripts. They touch neither the network nor the VPS.
# Usage: bash infra/test-infra-scripts.sh
#
# Covers two real defects:
#   1. deploy.sh passed the optional [branch] argument BEFORE the required REPO_URL.
#      ssh does not preserve argv — it joins the arguments into a string that the remote
#      shell splits again on spaces — so an empty argument in the middle shifts the
#      following ones and `infra/deploy.sh papa@IP` (the only documented invocation) died
#      at `REPO_URL="${2:?}"` before any deploy step.
#   2. .env.example had REQUIRE_EMAIL_VERIFICATION twice; every parser of the file
#      (compose, `set -a; . .env`, systemd EnvironmentFile) is silently last-wins,
#      so the second, empty occurrence overrode the first.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
failures=0
DEFAULT_REPO_URL=https://github.com/your-org/papa-rent.git

ok() { printf 'ok   %s\n' "$*"; }
ko() { printf 'FAIL %s\n' "$*" >&2; failures=$((failures + 1)); }

# --- fake ssh ---------------------------------------------------------------
# Replicates ssh(1) semantics: "the arguments will be appended to the command,
# separated by spaces, before it is sent to the server to be executed" — with no
# quoting at all, and the remote shell splits the string again on spaces.
# Runs only the prologue of the remote script (everything up to the first real step) and
# prints the values the remote ended up with, so the test needs neither docker nor git.
mkdir -p "$TMP/bin"
cat >"$TMP/bin/ssh" <<'FAKESSH'
#!/usr/bin/env bash
shift                                   # drop user@host
script=$(cat)                           # the heredoc arrives on stdin, as with real ssh
prologue=${script%%step \"environment\"*}
printf '%s\nprintf "REPO_URL=[%%s] BRANCH=[%%s]\\n" "$REPO_URL" "$BRANCH"\n' "$prologue" |
  sh -c "$*"                            # the remote receives ONE string and re-splits it
FAKESSH
chmod +x "$TMP/bin/ssh"

deploy_with() {
  PATH="$TMP/bin:$PATH" bash "$ROOT/infra/deploy.sh" "$@" 2>&1
}

# 1a. Without a branch — the invocation in .claude/skills/release/SKILL.md and in
#     docs/architecture/infra-and-cost.md. Must reach the remote with REPO_URL
#     in the right place and an empty BRANCH.
out=$(deploy_with papa@1.2.3.4)
if [ "$(printf '%s' "$out" | tail -1)" = "REPO_URL=[$DEFAULT_REPO_URL] BRANCH=[]" ]; then
  ok "deploy.sh without branch delivers REPO_URL to the remote"
else
  ko "deploy.sh without branch: remote received >>>$out<<<"
fi

# 1b. With a branch — the second argument still arrives.
out=$(deploy_with papa@1.2.3.4 main)
if [ "$(printf '%s' "$out" | tail -1)" = "REPO_URL=[$DEFAULT_REPO_URL] BRANCH=[main]" ]; then
  ok "deploy.sh with branch delivers REPO_URL and BRANCH to the remote"
else
  ko "deploy.sh with branch: remote received >>>$out<<<"
fi

# 1c. PAPA_REPO_URL is still honoured.
out=$(PAPA_REPO_URL=https://example.test/x.git deploy_with papa@1.2.3.4)
if [ "$(printf '%s' "$out" | tail -1)" = "REPO_URL=[https://example.test/x.git] BRANCH=[]" ]; then
  ok "deploy.sh honours PAPA_REPO_URL"
else
  ko "deploy.sh with PAPA_REPO_URL: remote received >>>$out<<<"
fi

# --- .env.example ------------------------------------------------------------
# 2a. The real file must not have repeated keys.
if out=$(bash "$ROOT/infra/check-env-example.sh" 2>&1); then
  ok "check-env-example.sh accepts the real .env.example"
else
  ko "check-env-example.sh rejected the real .env.example: $out"
fi

# 2b. A repeated key must make the check fail (this is what CI now catches).
dup="$TMP/env.dup"
cp "$ROOT/.env.example" "$dup"
printf 'PORT=4000\n' >>"$dup"
if out=$(bash "$ROOT/infra/check-env-example.sh" "$dup" 2>&1); then
  ko "check-env-example.sh did not detect the repeated key (exited 0): $out"
elif printf '%s' "$out" | grep -q 'PORT'; then
  ok "check-env-example.sh detects a repeated key"
else
  ko "check-env-example.sh failed but without naming the repeated key: $out"
fi

# 2c. A commented prose line that looks like an assignment (e.g. the BACKUP_REMOTE
#     note) must not be counted as a second occurrence.
if out=$(bash "$ROOT/infra/check-env-example.sh" 2>&1) && printf '%s' "$out" | grep -q 'ok'; then
  ok "comments do not count as repeats"
else
  ko "comment counted as a repeat: $out"
fi

if [ "$failures" -gt 0 ]; then
  printf '\n%s test(s) failed\n' "$failures" >&2
  exit 1
fi
printf '\nall infra tests passed\n'
