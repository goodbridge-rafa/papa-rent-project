# Data model

Source of truth: `packages/db/src/schema.ts` and `packages/db/src/auth-schema.ts` (Drizzle). This document explains the intent.

| Table | Purpose | Notes |
|---|---|---|
| `sources` | runtime state per source (last successful poll, consecutive failures, ETag/Last-Modified/hash) | configuration lives in the registry YAML; `syncSources` syncs it |
| `listings` | one canonical listing per (source, id at source) | `canonical_key` = postcode + house number + addition, for cross-source dedup; `removed_at` when it disappears from the feed; `raw` keeps the original item for audits and repairs |
| `listing_events` | `new`, `updated`, `price_changed`, `closing_soon`, `removed` | queue for the matcher/notifier (`processed_at`) |
| `source_runs` | one row per poll | latency, coverage, errors; basis for the reports |
| `radars` | a user's saved search (area as municipalities/provinces or radius, max rent, bedrooms, segments, labels, allocation models, push/e-mail mode, quiet hours) | matched against new events by the shared radar-match query |
| `devices` | push tokens per user | |
| `notifications` | what was sent to whom, by which channel | backs the inbox |
| Better Auth (`user`, `session`, `account`, `verification`) | accounts and sessions | `auth-schema.ts` |

Rules: prices as `numeric(10,2)`; dates as ISO `timestamptz`; `labels`, `target_groups`, `photos`, `notices` as `text[]`; `eligibility` as `jsonb` (min/max income, age, household size, local ties).
