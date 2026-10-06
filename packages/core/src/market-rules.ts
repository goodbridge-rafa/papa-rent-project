/**
 * Market rules, versioned by date. NEVER hardcode these values anywhere else.
 * `verified: true` = confirmed against an official source (URL in `source`, date in `verifiedAt`).
 * Process: docs/knowledge/market-rules.md · skill `verify-market-rules` (1 Jan and 1 Jul).
 * `verified: false` rows are not confirmed against an official URL yet; the eligibility engine
 * refuses to use them (`market_rule_unverified`).
 *
 * Official terminology (Rijksoverheid, 2026):
 *  - `social_rent_cap`  = "huurgrens voor DAEB-woningtoewijzing / bovengrens sociale huur" (€ 932,93)
 *  - `midden_rent_cap`  = "bovengrens middenhuur / liberalisatiegrens" (€ 1.228,07)
 *  Note: some secondary sources call the social cap "liberalisatiegrens"; the law uses liberalisatiegrens for the middenhuur cap.
 */
export type RuleKey =
  | "social_rent_cap"
  | "midden_rent_cap"
  | "wws_social_max_points"
  | "wws_midden_max_points"
  | "kwaliteitskortingsgrens"
  | "aftoppingsgrens_1" // households of 1-2 people
  | "aftoppingsgrens_2" // households of 3+ people
  | "daeb_income_single"
  | "daeb_income_multi"
  | "passend_income_single"
  | "passend_income_multi"
  | "passend_income_single_senior"
  | "passend_income_multi_senior"
  | "midden_income_single_max"
  | "midden_income_multi_max"
  | "huurtoeslag_youth_age_max" // below this age (exclusive) the kwaliteitskortingsgrens applies as the cap
  | "huurtoeslag_youth_max_rent"
  | "youth_age_min"
  | "youth_age_max"
  | "senior_age_min_common"
  | "registration_age_min"
  | "registration_age_min_room";

export interface MarketRule {
  key: RuleKey;
  value: number;
  unit: "eur_month" | "points" | "eur_year" | "years";
  validFrom: string; // YYYY-MM-DD
  validTo?: string;
  confidence: "A" | "B" | "C";
  verified: boolean;
  verifiedAt?: string;
  source: string;
  note?: string;
}

const RIJKS_2026 =
  "https://www.rijksoverheid.nl/actueel/nieuws/2025/11/25/indexering-inkomensgrenzen-woningcorporaties-maximale-huurprijsgrenzen-en-huurtoeslagparameters-2026";
const VHN_GRENZEN =
  "https://www.volkshuisvestingnederland.nl/onderwerpen/huren-en-wonen/inkomensgrenzen-huurprijsgrenzen-en-huurtoeslagparameters/maximale-huurprijsgrenzen";
const VHN_FAQ =
  "https://www.volkshuisvestingnederland.nl/wat-betekent-de-wet-betaalbare-huur-voor-mij/info/veelgestelde-vragen";
const RIJKS_HUURTOESLAG_2026 =
  "https://www.rijksoverheid.nl/actueel/nieuws/2025/11/24/meer-mensen-in-aanmerking-huurtoeslag";
const V = "2026-09-06";

export const MARKET_RULES: MarketRule[] = [
  {
    key: "social_rent_cap",
    value: 932.93,
    unit: "eur_month",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_2026,
    note: "Huurgrens DAEB-woningtoewijzing / bovengrens sociale huur (143 punten)",
  },
  {
    key: "midden_rent_cap",
    value: 1228.07,
    unit: "eur_month",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_2026,
    note: "Bovengrens middenhuur / liberalisatiegrens (186 punten)",
  },
  {
    key: "wws_social_max_points",
    value: 143,
    unit: "points",
    validFrom: "2024-07-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: VHN_FAQ,
    note: "'Sociale huurwoningen hebben maximaal 143 punten.'",
  },
  {
    key: "wws_midden_max_points",
    value: 186,
    unit: "points",
    validFrom: "2024-07-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: VHN_FAQ,
    note: "'Middenhuurwoningen hebben 144 tot en met 186 punten.' Vrije sector: 187+.",
  },
  {
    key: "kwaliteitskortingsgrens",
    value: 498.2,
    unit: "eur_month",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_2026,
  },
  {
    key: "aftoppingsgrens_1",
    value: 713.02,
    unit: "eur_month",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_2026,
    note: "Passend toewijzen huurgrens 1-2 personen = aftoppingsgrens laag",
  },
  {
    key: "aftoppingsgrens_2",
    value: 764.14,
    unit: "eur_month",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_2026,
    note: "Passend toewijzen huurgrens 3+ personen = aftoppingsgrens hoog",
  },
  {
    key: "daeb_income_single",
    value: 51537,
    unit: "eur_year",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_2026,
    note: "Inkomensgrens woningtoewijzing eenpersoonshuishouden",
  },
  {
    key: "daeb_income_multi",
    value: 56910,
    unit: "eur_year",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_2026,
    note: "Inkomensgrens woningtoewijzing meerpersoonshuishouden",
  },
  {
    key: "passend_income_single",
    value: 29400,
    unit: "eur_year",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_2026,
  },
  {
    key: "passend_income_multi",
    value: 39925,
    unit: "eur_year",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_2026,
  },
  {
    key: "passend_income_single_senior",
    value: 28775,
    unit: "eur_year",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_2026,
    note: "Eenpersoonsouderenhuishouden (AOW)",
  },
  {
    key: "passend_income_multi_senior",
    value: 38650,
    unit: "eur_year",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_2026,
    note: "Meerpersoonsouderenhuishouden (AOW)",
  },
  {
    key: "midden_income_single_max",
    value: 70149,
    unit: "eur_year",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: VHN_GRENZEN,
    note: "National definition of middeninkomen; municipalities may set their own bands in the Huisvestingsverordening",
  },
  {
    key: "midden_income_multi_max",
    value: 93531,
    unit: "eur_year",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: VHN_GRENZEN,
    note: "Same, meerpersoonshuishouden",
  },
  {
    key: "huurtoeslag_youth_age_max",
    value: 21,
    unit: "years",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_HUURTOESLAG_2026,
    note: "2026: young people under 21 (was 23 until 2025); cap = kwaliteitskortingsgrens",
  },
  {
    key: "huurtoeslag_youth_max_rent",
    value: 498.2,
    unit: "eur_month",
    validFrom: "2026-01-01",
    confidence: "A",
    verified: true,
    verifiedAt: V,
    source: RIJKS_HUURTOESLAG_2026,
    note: "Replaces the 2025 value of € 454.47 (<23 years)",
  },
  {
    key: "huurtoeslag_youth_max_rent",
    value: 454.47,
    unit: "eur_month",
    validFrom: "2025-01-01",
    validTo: "2026-01-01",
    confidence: "C",
    verified: false,
    source: "public Dutch rent rules (2025, historical, not verified)",
  },
  {
    key: "youth_age_min",
    value: 18,
    unit: "years",
    validFrom: "2000-01-01",
    confidence: "A",
    verified: false,
    source: "public Dutch rent rules (2026)",
    note: "Jongerenwoningen 18-27; varies by housing corporation",
  },
  {
    key: "youth_age_max",
    value: 27,
    unit: "years",
    validFrom: "2000-01-01",
    confidence: "A",
    verified: false,
    source: "public Dutch rent rules (2026)",
  },
  {
    key: "senior_age_min_common",
    value: 55,
    unit: "years",
    validFrom: "2000-01-01",
    confidence: "A",
    verified: false,
    source: "public Dutch rent rules (2026)",
    note: "55 or 65 depending on the complex; listings carry the real value (doelgroep 55_plus, actionLabel)",
  },
  {
    key: "registration_age_min",
    value: 18,
    unit: "years",
    validFrom: "2000-01-01",
    confidence: "A",
    verified: false,
    source: "public Dutch rent rules (2026)",
  },
  {
    key: "registration_age_min_room",
    value: 16,
    unit: "years",
    validFrom: "2024-01-01",
    confidence: "A",
    verified: false,
    source: "public Dutch rent rules (2026)",
    note: "ROOM.nl (student rooms)",
  },
];

/** Returns the rule in force on the date (default: today). Throws if none exists. */
export function getRule(key: RuleKey, at: Date = new Date()): MarketRule {
  const iso = at.toISOString().slice(0, 10);
  const candidates = MARKET_RULES.filter(
    (r) => r.key === key && r.validFrom <= iso && (r.validTo === undefined || r.validTo > iso),
  ).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  const rule = candidates[0];
  if (!rule) throw new Error(`Market rule not found: ${key} @ ${iso}`);
  return rule;
}

export function unverifiedRules(): MarketRule[] {
  return MARKET_RULES.filter((r) => !r.verified && r.validTo === undefined);
}
