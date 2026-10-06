# Market segments and labels

All amounts and point thresholds come from `docs/knowledge/market-rules.md` (verified values, mirrored from `packages/core/src/market-rules.ts`). Do not hardcode them anywhere else.

## The three segments

| Segment | WWS points | Net rent (*kale huur*), 2026 |
|---|---|---|
| **Sociale huur** (social) | ≤ 143 | up to € 932.93/month |
| **Middenhuur** (mid-rent, regulated) | 144 to 186 | € 932.94 to € 1,228.07/month |
| **Vrije sector** (free sector) | ≥ 187 | from € 1,228.08/month |

Social and mid-rent homes are price-regulated by the WWS points system; the free sector is not. The exact scope of the Huurcommissie and of annual rent increases per segment is not encoded in the code and must be read from official sources before the product states it.

## How a listing is classified

No source exposes a reliable, universal "social/midden/free" field, so the segment is derived. `classifySegment` (`packages/core/src/classify.ts`) uses this order:

1. **Source hint**: an explicit segment the adapter passes when the listing itself states it. It reflects the source's own legal classification. Adapters omit it when a feed mixes segments (Eigen Haard), so the price decides.
2. **WWS points**, when the listing has them: compared with `wws_social_max_points` (143) and `wws_midden_max_points` (186).
3. **Net rent**: compared with `social_rent_cap` and `midden_rent_cap`.
   - `netRent ≤ 932.93` → social
   - `932.93 < netRent ≤ 1,228.07` → midden
   - `netRent > 1,228.07` → free
4. No price → `unknown`.

Cautions:
- **New-build surcharge** (*nieuwbouwopslag*): a new-build middenhuur home may be allowed a rent above the standard cap and still be middenhuur. The exact rule is not verified yet (see `market-rules.md`), so a price slightly above the midden cap on a new-build listing should not be read as certain free sector.
- **Huurtoeslag**: a source field such as `huurtoeslagMogelijk` is a useful signal, but since 2026 rent alone no longer excludes huurtoeslag (Rijksoverheid 24-11-2025), so it does not prove a segment by itself.
- **Source kind** (`consortium` vs `manager`) is at most a tie-breaker, never the only signal. Never classify by portal name alone: confirm with the individual listing's price.

## Labels and preferential categories (*gelabelde woonruimte*)

Labels restrict **who may apply**, not the price segment: a listing can be, for example, social and a youth home at the same time. Ages and thresholds vary per landlord and complex; the listing carries the real value.

| Label | Meaning | Relevance for alerts |
|---|---|---|
| **Jongeren** (*jongerenwoningen*) | Homes reserved for young people, often with a temporary youth contract | Filter by the user's age; alert only eligible users |
| **Senioren** (*seniorenwoningen*) | Accessible homes with a minimum age (commonly 55 or 65, per complex) | Filter by the user's declared age |
| **Doorstromers** | Priority for people who free up a social home in the same municipality | Profile flag; only relevant for users with a current social contract |
| **Grote gezinnen** (large families) | Larger homes reserved for large households | Filter by household size |
| **Sleutelberoepen** (key professions) | Priority for essential workers (for example nurses, police, teachers) in some municipalities | Profession flag in the profile |
| **Nultredenwoningen** | Step-free, accessible homes | Highlight for users who need accessibility |
| **Student/campus** (*campuscontracten*) | Contract tied to active enrolment | Only for enrolled users; proof is required by the source, not by the product |

## Operational notes

- One home can carry several labels (for example jongerenwoning **and** nultreden). Treat `labels`/target groups as a set, not a single field.
- Labels are orthogonal to the segment.
- See `docs/knowledge/allocation-models.md` for how the allocation model (not the segment) drives alert urgency.
