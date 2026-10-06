# Infrastructure and cost

Planned setup (see ADR-001). Prices are estimates at decision time.

| Item | Choice | €/month |
|---|---|---|
| VPS | Hetzner CX32 (4 vCPU, 8 GB, DE) · Docker Compose: Postgres 17, api, engine, Caddy | ~7 |
| Backup | daily `pg_dump` → Backblaze B2 (10 GB free) + snapshot | ~1 |
| Web/landing/DNS/CDN | Cloudflare Pages + DNS | 0 |
| Push | Expo Push | 0 |
| E-mail | Resend free tier → SES when it grows | 0 |
| Monitoring | Uptime Kuma (self-hosted) + Sentry free | 0 |
| LLM (production) | not implemented; see ADR-006 | 0 today |
| Builds | EAS Build free | 0 |
| Domain | example.com (placeholder) | ~1 |
| **Total** | | **~9–15** + Apple Developer US$99/year + Google Play US$25 |

Files: `infra/docker-compose.yml` (dev: Postgres only), `infra/docker-compose.prod.yml`, `infra/Dockerfile`, `infra/Caddyfile`, `infra/cloud-init.yaml`, `infra/deploy.sh`, `infra/backup.sh`, `infra/alert.sh`, `infra/systemd/`.

Provisioning: create the server with cloud-init (SSH key in the placeholder) → `/opt/papa/.env` (POSTGRES_PASSWORD, BOT_*, RESEND_API_KEY…) → `infra/deploy.sh papa@IP` → DNS `api.<domain>` → Caddy issues TLS.
