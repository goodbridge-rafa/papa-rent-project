# Market rules (values in force)

Source of truth in code: `packages/core/src/market-rules.ts` (`getRule(key, date)`). This page mirrors it; if they disagree, the code wins and this page is wrong. Rows marked `verified: true` were checked against the official URL on the date shown; rows with `verified: false` are in the code but the eligibility engine refuses to use them (`market_rule_unverified`). Re-verify on 1 January and 1 July (skill `.claude/skills/verify-market-rules`).

## Terminology
In the law and on official pages, **liberalisatiegrens = bovengrens middenhuur (€ 1,228.07)**. The social cap is the **huurgrens DAEB-woningtoewijzing / bovengrens sociale huur (€ 932.93)**. Some secondary sources call the social cap "liberalisatiegrens"; the code uses `social_rent_cap` and `midden_rent_cap` to avoid the confusion.

## Verified on 2026-09-06

| Key | Value | Official label (NL) | In force from | Source |
|---|---|---|---|---|
| `social_rent_cap` | € 932.93 /month | Huurgrens DAEB-woningtoewijzing / bovengrens sociale huur (143 punten) | 2026-01-01 | [Rijksoverheid 25-11-2025](https://www.rijksoverheid.nl/actueel/nieuws/2025/11/25/indexering-inkomensgrenzen-woningcorporaties-maximale-huurprijsgrenzen-en-huurtoeslagparameters-2026) |
| `midden_rent_cap` | € 1,228.07 /month | Bovengrens middenhuur / liberalisatiegrens (186 punten) | 2026-01-01 | Rijksoverheid 25-11-2025 |
| `wws_social_max_points` | 143 | "Sociale huurwoningen hebben maximaal 143 punten." | 2024-07-01 | [VHN FAQ Wet betaalbare huur](https://www.volkshuisvestingnederland.nl/wat-betekent-de-wet-betaalbare-huur-voor-mij/info/veelgestelde-vragen) |
| `wws_midden_max_points` | 186 | "Middenhuurwoningen hebben 144 tot en met 186 punten." Vrije sector: 187+. | 2024-07-01 | VHN FAQ |
| `kwaliteitskortingsgrens` | € 498.20 /month | Kwaliteitskortingsgrens (huurtoeslag) | 2026-01-01 | Rijksoverheid 25-11-2025 |
| `aftoppingsgrens_1` | € 713.02 /month | Aftoppingsgrens laag / passend toewijzen 1-2 personen | 2026-01-01 | Rijksoverheid 25-11-2025 |
| `aftoppingsgrens_2` | € 764.14 /month | Aftoppingsgrens hoog / passend toewijzen 3+ personen | 2026-01-01 | Rijksoverheid 25-11-2025 |
| `daeb_income_single` | € 51,537 /year | Inkomensgrens woningtoewijzing eenpersoonshuishouden | 2026-01-01 | Rijksoverheid 25-11-2025 |
| `daeb_income_multi` | € 56,910 /year | Inkomensgrens woningtoewijzing meerpersoonshuishouden | 2026-01-01 | Rijksoverheid 25-11-2025 |
| `passend_income_single` | € 29,400 /year | Passend toewijzen, eenpersoons | 2026-01-01 | Rijksoverheid 25-11-2025 |
| `passend_income_multi` | € 39,925 /year | Passend toewijzen, meerpersoons | 2026-01-01 | Rijksoverheid 25-11-2025 |
| `passend_income_single_senior` | € 28,775 /year | Eenpersoonsouderenhuishouden (AOW) | 2026-01-01 | Rijksoverheid 25-11-2025 |
| `passend_income_multi_senior` | € 38,650 /year | Meerpersoonsouderenhuishouden (AOW) | 2026-01-01 | Rijksoverheid 25-11-2025 |
| `midden_income_single_max` | € 70,149 /year | Middeninkomen eenpersoons (national definition; municipalities may set their own bands) | 2026-01-01 | [VHN maximale huurprijsgrenzen](https://www.volkshuisvestingnederland.nl/onderwerpen/huren-en-wonen/inkomensgrenzen-huurprijsgrenzen-en-huurtoeslagparameters/maximale-huurprijsgrenzen) |
| `midden_income_multi_max` | € 93,531 /year | Middeninkomen meerpersoons | 2026-01-01 | VHN maximale huurprijsgrenzen |
| `huurtoeslag_youth_age_max` | 21 years | Young people under 21 (was 23 until 2025); their rent cap is the kwaliteitskortingsgrens | 2026-01-01 | [Rijksoverheid 24-11-2025](https://www.rijksoverheid.nl/actueel/nieuws/2025/11/24/meer-mensen-in-aanmerking-huurtoeslag) |
| `huurtoeslag_youth_max_rent` | € 498.20 /month | Huurtoeslag rent cap under 21 (= kwaliteitskortingsgrens) | 2026-01-01 | Rijksoverheid 24-11-2025 |

## In the code but not verified (the eligibility engine does not use them)

| Key | Value | Validity | Note |
|---|---|---|---|
| `huurtoeslag_youth_max_rent` | € 454.47 /month | 2025-01-01 to 2026-01-01 | historical 2025 value (< 23 years) |
| `youth_age_min` | 18 years | open | jongerenwoningen; varies by housing corporation |
| `youth_age_max` | 27 years | open | idem |
| `senior_age_min_common` | 55 years | open | 55 or 65 depending on the complex; listings carry the real value |
| `registration_age_min` | 18 years | open | |
| `registration_age_min_room` | 16 years | from 2024-01-01 | student rooms |

## Notes from the same official sources (not encoded as rules)
- Huurtoeslag 2026: rent is no longer an automatic reason for exclusion ("de huur kan niet meer te hoog zijn"), other conditions unchanged (Rijksoverheid 24-11-2025). **Product impact:** a "huurtoeslag possible" badge cannot depend on the rent cap alone; use the source's field when it exists.

## Not yet verified (do not use in code)
| Item | Where to verify |
|---|---|
| Exact trigger of the WOZ cap on WWS points | Besluit huurprijzen woonruimte, annex I; huurcommissie.nl |
| Nieuwbouwopslag (new-build surcharge on middenhuur): percentage, duration, cut-off dates | Wet betaalbare huur, transitional provisions; VHN |
| Full WWS table item by item (points per m², energy label, WOZ) | huurcommissie.nl (huurprijscheck) |
| Youth/senior ages per complex | come with the listing (doelgroep, actionLabel); not a national rule |
| Municipal middenhuur bands and local-ties (binding) rules | each municipality's Huisvestingsverordening |
