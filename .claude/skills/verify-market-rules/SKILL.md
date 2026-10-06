---
name: verify-market-rules
description: Verifies every value in packages/core/src/market-rules.ts (liberalisatiegrens, middenhuurgrens, WWS boundaries, aftoppingsgrenzen, income limits) against an official source and updates docs/knowledge/market-rules.md. Run on 1 January, 1 July and whenever an official source changes.
---
1. For each rule in `MARKET_RULES`: WebFetch the official source (volkshuisvestingnederland.nl, huurcommissie.nl, rijksoverheid.nl, belastingdienst.nl for huurtoeslag, Staatsblad for laws). Note the URL, access date and a literal quote.
2. If the value matches: `verified: true`, `source: <URL>`, `verifiedAt: <date>`. If it changed: a new entry with `validFrom`, and `validTo` on the previous one (never delete history). A value with no official URL stays `verified: false`; never invent a source.
3. Run `pnpm --filter @papa/core test`. Update the table in `docs/knowledge/market-rules.md` (status, URL, date).
4. Commit: `chore(rules): verification <date>`. Record any divergence from earlier values in `docs/knowledge/market-rules.md`, section "Divergences".
