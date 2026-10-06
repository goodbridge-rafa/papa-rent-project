# ADR-001 · Minimum-cost infrastructure

**Context.** A very limited starting budget; the tool has to run 24/7 (continuous polling). Options considered: Supabase + Fly.io (~€50–120/month), Cloudflare Workers only (free, but no Playwright and no long-running processes), one VPS with Docker (~€7/month).

**Decision.** One Hetzner CX32 VPS (4 vCPU, 8 GB, Germany, EU) with Docker Compose: Postgres 17, API, engine and Caddy (automatic TLS). Daily backups via `pg_dump` to Backblaze B2 (free up to 10 GB). Free services around it: Cloudflare (DNS, Pages for web and landing), Expo Push, Resend (e-mail, free tier), Sentry free, self-hosted Uptime Kuma, EAS Build free.

**Consequences.** About €15/month + Apple Developer (US$99/year) + Google Play (US$25). Single point of failure, mitigated by backups, `cloud-init` and `deploy.sh` (rebuild in about 15 minutes). Scaling path once there is revenue: managed Postgres and a second VPS; nothing in the code depends on the provider.

**Review.** When MRR exceeds €500 or when polling needs more than one machine.
