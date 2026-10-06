# Radar engine

Flow of one poll (`apps/engine/src/runner.ts`):

1. `adapter.plan(source)` → list of requests. Optional `adapter.planMore(source, bodies)`: a second round discovered in the first round's bodies (pagination, unit ids, buildId), capped at 12 requests per poll.
2. `checkRobots` (24 h cache). Disallowed path → the poll ends with `robots_disallow`. A malformed robots.txt → warning in the log; the tier in the registry decides.
3. `Http.get` with an identified User-Agent (default `PapaRentBot/0.1 (+https://example.com/bot)`, override with `BOT_USER_AGENT`), matched in robots.txt by its product token `PapaRentBot`; a minimum gap per host (default 60 s, `ENGINE_MIN_GAP_PER_HOST_MS`); `If-None-Match`/`If-Modified-Since`. 304 → `not_modified`.
4. Body hash equal to the previous poll's → nothing to apply; the poll is still recorded.
5. `adapter.parse` → `CanonicalListing[]` + `skipped` + `warnings`. Zero listings with warnings → `parse_failed` (likely drift; check `raw` and the fixtures).
6. `applyListings`: insert/update/remove with events; `saveConditionalState`. If the adapter returns `partial: true` (missing page, truncated feed), nothing is marked as removed. The scheduler paces the load: each request of a poll costs `ENGINE_PER_REQUEST_BUDGET_MS` (60 s) in the next interval, so a source with 6 pages is read again only ≥ 6 min later.
7. `enrich` of new listings **off the critical path**: the poll ends as soon as the new listings are stored (the notifier can already send them); the scheduler keeps a per-source queue and fetches the detail (service costs, eligibility, number of responses) with its own pause (`ENGINE_ENRICH_GAP_MS`, 10 s) without delaying the next poll. `once --db` enriches inline, up to 10.
8. PDOK geocoding (Locatieserver, open data) in the background for new listings without municipality/province or coordinates; cached by postcode; `geocode:backfill` for the existing data.
9. `render` plans (technical Tier B): the adapter requests the page in headless Chromium (`playwright-core`, system Chromium via `ENGINE_BROWSER_EXECUTABLE`), with `captureResponse` (body of the XHR/fetch call the page makes) or `waitForSelector` (rendered HTML). Same User-Agent and same host policy; images/media/fonts blocked; no stealth, no login, no bypassing challenges.
10. `recordRun` → metrics.

Scheduler (`scheduler.ts`): one timer per source, never below the registry interval, up to +20 % jitter (upwards only), exponential backoff up to 15 min, bounded concurrency (`ENGINE_CONCURRENCY`, default 4), staggered start.

Adapters in this copy: `zig365`, `heimstaden`, `eigen-haard`. The registry (`docs/sources/registry.yaml`) has 4 sources: two fictional Zig365 portals, Heimstaden and Eigen Haard.

CLI: `pnpm engine sources` · `pnpm engine once -s <slug> [--db] [--json]` · `pnpm engine run` · `pnpm engine report:latency -h 24` · `pnpm engine registry:check` · `pnpm engine --help` for the rest.

Latency: `report:latency` computes p50/p95 of `first_seen_at − published_at`; it is only meaningful after continuous polling (the first poll imports the backlog).
