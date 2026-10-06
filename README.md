# Papa Rent

[![ci](https://github.com/goodbridge-rafa/papa-rent-project/actions/workflows/ci.yml/badge.svg)](https://github.com/goodbridge-rafa/papa-rent-project/actions/workflows/ci.yml)

**Alert-first search for regulated rental housing in the Netherlands.** Social and mid-rent homes
(*sociale huur*, *middenhuur*) are published across dozens of housing-association and landlord
portals, each with its own rules, and the good ones are gone in hours. Papa Rent collects them into
one feed, tells you which ones you are actually eligible for, and alerts you so you can apply at the
source.

A TypeScript monorepo: a polite crawler, an API, a mobile and web app, and the rules engine that
decides eligibility, with 256 tests across six packages.

```
sources ─▶ engine (adapters → normalise → store) ─▶ Postgres ─▶ API (Hono) ─▶ app (Expo: iOS, Android, web)
                                   │                                 ▲
                                   └──── notifier: match new listings against saved "radars" ──▶ push / e-mail
```

## What is worth looking at

- **An adapter contract built for partial failure** ([`packages/adapters/src/types.ts`](packages/adapters/src/types.ts)).
  A source that returns half a page reports `partial: true` and the IDs it saw, so a flaky source can
  never cause a mass removal of listings. Schema drift becomes a warning, not a crash.
- **A polite crawler** ([`apps/engine`](apps/engine)). It identifies itself as a bot, reads
  `robots.txt` and matches its own product token as RFC 9309 specifies, keeps at least 60 seconds
  between requests to the same host, backs off on failure, and reports which sources have gone quiet.
- **Eligibility as versioned, sourced rules** ([`packages/core/src/eligibility.ts`](packages/core/src/eligibility.ts),
  [`market-rules.ts`](packages/core/src/market-rules.ts)). Income bands, rent caps and age rules carry
  their official source and a verification date; a rule too old to trust is not used. Every listing
  gets a verdict per user: fits, unlikely, or does not fit, with the reason.
- **One matching predicate, two runtimes.** The query that decides whether a listing matches a saved
  radar is shared by the API and the notifier, with a test proving they agree
  ([`packages/db/src/queries/radar-match.ts`](packages/db/src/queries/radar-match.ts)).
- **Honesty built into the product.** Legal texts with open placeholders cannot ship (the generator
  marks them blocked and a test guards it). Demo mode refuses every write behind a permanent banner.
  Production refuses to start with a weak auth secret or an empty database password.
- **CI that checks the infrastructure too** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):
  lint, types, tests, the source registry, that `.env.example` covers every variable the code reads,
  regression tests for the deploy scripts, and valid compose files.
- **Built with a small multi-agent process** ([`.claude/`](.claude)): a source scout that checks
  `robots.txt` and terms before anything else, an adapter builder, and skills for market-rule
  verification and releases.

## Repository map

| Path | What it is |
|---|---|
| [`apps/engine`](apps/engine) | the crawler: scheduler, HTTP with per-host pacing, robots, store, notifier, health reports |
| [`apps/api`](apps/api) | Hono API: auth (Better Auth), radars, feed, inbox, GDPR export and delete |
| [`apps/mobile`](apps/mobile) | Expo app (iOS, Android, web) with a demo mode on fictional data |
| [`packages/core`](packages/core) | listing model, normalisation, eligibility, market rules, source registry schema |
| [`packages/db`](packages/db) | Drizzle schema, migrations, the shared radar-match query |
| [`packages/adapters`](packages/adapters) | three source adapters with synthetic test fixtures |
| [`infra`](infra) | Docker, Caddy, systemd timers, backup, alerting, deploy script, cloud-init |
| [`docs`](docs) | architecture, decisions (ADRs), domain knowledge, product |

## Run it

Requires Node (see `.node-version`) and pnpm.

```bash
pnpm install
pnpm check                 # lint + typecheck + 256 tests, no network, no secrets
pnpm engine sources        # the source registry and what is pollable
pnpm engine --help         # every engine command
```

The API and engine run against Postgres (`infra/docker-compose.yml`); the tests use an in-process
PGlite database, local HTTP servers and fake mail and push transports.

## This public copy

The working repository covers many more sources. This copy keeps three adapters, and every test
fixture is synthetic: fictional portals, streets and IDs on `example.*` hosts. Pages captured from
real websites are not redistributed. The demo dataset is fictional too.

## Limits, stated plainly

- The engine has run in development sessions, not yet as a 24/7 service; detection latency has not
  been measured in production.
- Push and e-mail notifications are implemented and tested with fake transports; none have been
  sent live.
- The public web demo shows fictional listings.

## How this was built

This repository is a curated public copy of a private working repository (114 commits since September 2026); its own history starts at publication.

Designed and directed by Rafa Maretti; implemented with AI coding agents (Claude Code). The agents
wrote the code. The product, the source policy, the eligibility rules, the acceptance tests and the
review of every change were his.

## License

Copyright © 2026 Rafa Maretti. All rights reserved. The source is published so it can be
reviewed; using, copying or commercialising it requires a written licence from the author
(hello@rafamaretti.com). See [LICENSE](LICENSE).
