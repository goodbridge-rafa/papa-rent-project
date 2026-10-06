# Architecture decisions (ADRs)

One decision per file. Format: context → decision → consequences → review. Never delete an ADR; supersede it with a new one that points to the old one.

| # | Decision | Status |
|---|---|---|
| [001](ADR-001-minimum-cost-infra.md) | Minimum-cost infrastructure: one Hetzner VPS + Docker Compose | accepted |
| [002](ADR-002-application-deep-link.md) | Applying via deep link; no uploads in the app | accepted |
| [004](ADR-004-stack.md) | TypeScript monorepo; universal Expo; Hono; Drizzle/Postgres | accepted |
| [005](ADR-005-auth.md) | Auth with Better Auth inside the API; persistent login | accepted |
| [006](ADR-006-llm.md) | LLM only for unstructured sources; not implemented (later phase) | accepted |
| [008](ADR-008-versions.md) | Pinned versions: TypeScript 5.9 and Vitest 4 (the mobile app uses TypeScript 6.0) | accepted |

(numbers 003 and 007 are not part of this public copy)
