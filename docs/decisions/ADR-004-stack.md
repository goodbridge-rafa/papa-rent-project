# ADR-004 · Technical stack

**Decision.** TypeScript everywhere, in a pnpm + Turborepo monorepo, lint/format with Biome, tests with Vitest, Node 22.
- **App**: Expo (SDK 57) + Expo Router, one codebase for iOS, Android and web. FlashList, expo-image, TanStack Query, Zustand, i18next (NL + EN); styling through theme tokens in `src/lib/theme.ts`.
- **API**: Hono on Node + Better Auth + Drizzle ORM on Postgres 17.
- **Engine**: a Node process with a per-source scheduler, an identified undici HTTP client, pure per-stack adapters (`packages/adapters`), event-based persistence, latency metrics in SQL.
- **Database tests**: PGlite (Postgres in WASM) with the same migrations; no mocks.
- **Runtime**: `tsx` in production (no build step for the services); one multi-service Docker image.

TypeScript versions: the root and the Node packages pin `~5.9.3` (ADR-008); `apps/mobile` uses `~6.0.3`.

**Rationale.** One language for the AI coding agents to write and maintain; pure adapters testable with fixtures; a real Postgres in tests avoids surprises; Expo covers the three platforms with one codebase.
