# ADR-008 · Pinned versions

**Context (2026-09-06).** New major versions of TypeScript and Vitest had just been published on npm. Expo 57 was the latest SDK.

**Decision.** Pin TypeScript `~5.9.3` and Vitest `^4.1` until the ecosystem (Biome, tsx, Drizzle, Expo) confirms stable support for the new majors. Zod 4, Drizzle 0.45, Hono 4.13, Better Auth 1.7 and undici 8 at their current versions. Re-evaluate per quarter.

**Current state.** The root, `apps/api`, `apps/engine` and all `packages/*` pin TypeScript `~5.9.3`. `apps/mobile` uses TypeScript `~6.0.3`, so the pin does not hold for the app. Vitest is `^4.1.11` everywhere.
