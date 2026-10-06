# Architecture overview

```
public sources ──► apps/engine (Radar) ──► Postgres ──► apps/api ──► apps/mobile (iOS/Android/Web)
   (Zig365 JSON,      scheduler · http        listings      Hono          Expo Router
    landlord sites)   robots · adapters       events        Better Auth
                      store · enrich          runs          radars, feed
                      notifier ──────────────────────────────────────────► push / e-mail
```

- **Registry** (`docs/sources/registry.yaml`) is the source configuration: stack, legal tier, interval, adapter. The engine only polls `status: live` sources in tier A (or B with a recorded decision). `packages/core/src/registry.ts` validates it.
- **Adapters** (`packages/adapters`: `zig365`, `heimstaden`, `eigen-haard`) are pure: `plan()` → what to fetch; `parse()` → `CanonicalListing[]`; optional `enrich()` for new-listing detail. Tested with synthetic fixtures.
- **Engine** (`apps/engine`): one timer per source with jitter and backoff; an identified HTTP client (`PapaRentBot`) with a minimum gap per host (60 s by default); robots.txt check; conditional GET + body hash (nothing changed → nothing to apply); `applyListings` emits `new / updated / price_changed / removed` events; `source_runs` stores metrics; `report:latency` measures `first_seen_at − published_at`. The notifier matches new events against saved radars and schedules closing reminders.
- **Canonical schema** (`packages/core/src/listing.ts`): one format for every source; segment decided by `classifySegment` with versioned thresholds in `market-rules.ts`.
- **Database** (`packages/db`): Drizzle + Postgres 17; migrations in `packages/db/drizzle`; PGlite in tests.
- **API** (`apps/api`): Hono; `/health`, `/v1/sources`, `/v1/listings` (cursor pagination), `/v1/listings/:id`, plus authenticated `/v1/me`, `/v1/radars`, `/v1/feed`, `/v1/devices`, `/v1/notifications` and GDPR `/v1/account/export` and `DELETE /v1/account`.
- **App** (`apps/mobile`): universal Expo.
- **Infra** (`infra/`): dev/prod Compose, single Dockerfile, Caddy, cloud-init, deploy and backup.

Targets (not yet measured in production): detection p95 ≤ 90 s after publication on JSON sources (60 s polling); push ≤ 10 s after detection.
