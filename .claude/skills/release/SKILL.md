---
name: release
description: Production release checklist (VPS): green checks, migration, deploy via infra/deploy.sh, API and engine smoke test.
---
1. `pnpm check` green. `git status` clean. Note the branch and commit.
2. `infra/deploy.sh papa@<host>` (set `PAPA_REPO_URL` if you deploy from a fork).
3. Smoke: `curl -sS https://<API_DOMAIN>/health`; `docker compose ... logs --tail=50 engine` shows "run ok" for at least 3 sources.
4. On the VPS (via ssh): `pnpm engine report:health` and `pnpm engine report:latency -h 1`; keep the output with the release notes.
5. Tag the release and push.
