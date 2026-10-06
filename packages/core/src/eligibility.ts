import { z } from "zod";
import type { ListingLabel } from "./enums";
import type { CanonicalListing } from "./listing";
import { getRule, type MarketRule, type RuleKey } from "./market-rules";
import type { ProfilePatch } from "./radar";

/**
 * The "past bij jou" signal (docs/product/eligibility.md).
 *
 * It is a GUIDING signal, never an eligibility decision: the portal decides.
 * Pure function — no network, DB or clock access beyond the date it receives.
 *
 * Three invariants the rest of the code must not break:
 *  1. No market value here: everything comes from `getRule(...)` or from the listing itself.
 *  2. Missing data (profile, listing) or an unverified threshold ⇒ `UNKNOWN`, never a guess (§6).
 *  3. Thresholds are read at the listing's publication date, not today's (§3 rule 1).
 */

/** Badge states (§5). */
export type EligibilityState = "FIT" | "UNLIKELY" | "NO_FIT" | "UNKNOWN";

/**
 * Result of one dimension (§4).
 * `warn` does not change the state: it warns (e.g. above the aftoppingsgrens) without failing.
 * `not_applicable` = the listing imposes nothing on this dimension; it does not change the state either.
 */
export type DimensionStatus = "fit" | "no_fit" | "warn" | "unknown" | "not_applicable";

/** Dimensions evaluated, in the order in which they decide the verdict. */
export type EligibilityDimension = "income" | "household" | "age" | "target_group" | "priority";

/** Stable reason code. The NL/EN translation lives in the UI; only identifiers here. */
export type EligibilityReason =
  // income (§4.1)
  | "income_band_missing"
  | "income_band_not_declared"
  | "listing_net_rent_missing"
  | "listing_segment_not_regulated"
  | "income_band_within_segment"
  | "income_band_above_segment"
  | "income_band_below_segment"
  | "income_above_listing_max"
  | "income_below_listing_min"
  | "municipal_midden_income_band_missing"
  // household (§4.2)
  | "household_size_missing"
  | "household_below_listing_min"
  | "household_above_listing_max"
  | "household_within_listing_range"
  | "large_family_minimum_missing"
  | "rent_above_aftoppingsgrens"
  | "rent_within_aftoppingsgrens"
  | "aftoppingsgrens_not_checked"
  | "no_household_condition"
  // age (§4.3)
  | "date_of_birth_missing"
  | "age_below_listing_min"
  | "age_above_listing_max"
  | "age_within_listing_range"
  | "age_within_usual_rule"
  | "age_outside_usual_rule"
  | "no_age_condition"
  // target group (§4.3)
  | "student_status_not_collected"
  | "no_target_group_condition"
  // exclusive priority (§4.4)
  | "social_tenant_status_missing"
  | "doorstromer_required_met"
  | "doorstromer_required_not_met"
  | "no_priority_condition"
  // cross-cutting
  | "market_rule_unverified"
  | "all_conditions_match";

/** Explanatory notes to show in the detail; they do not change the state. */
export type EligibilityNote =
  | "social_income_exception_possible"
  | "income_maybe_too_low_for_landlord"
  | "above_aftoppingsgrens_less_huurtoeslag"
  | "age_rule_is_the_usual_one"
  | "local_binding_priority";

/** Actionable tips (§4.4): never filter, only suggest what to write in the application. */
export type EligibilityHint = "mention_doorstromer" | "mention_key_profession";

export interface EligibilityFinding {
  dimension: EligibilityDimension;
  status: DimensionStatus;
  reason: EligibilityReason;
  /** Market rules used in this dimension (value, date and source for the "Waarom?" explanation). */
  rules: MarketRule[];
}

export interface EligibilityResult {
  state: EligibilityState;
  /** Reason for the final verdict: the dimension/rule that decided. */
  reason: EligibilityReason;
  /** Dimension that decided; `null` when everything fits (`FIT`). */
  decidedBy: EligibilityDimension | null;
  findings: EligibilityFinding[];
  notes: EligibilityNote[];
  hints: EligibilityHint[];
  /** Every rule used, without repeats — the explanation required by §5 lists them. */
  rulesUsed: MarketRule[];
  /** Date (YYYY-MM-DD) the thresholds were read at: listing publication or evaluation. */
  rulesReadAt: string;
}

/**
 * Income bands as the profile stores them (`user.income_band`).
 * They mirror `ProfilePatch` in radar.ts — the assertion below fails at compile time if they diverge.
 * Map to the doc: lt_passend = A, lt_daeb = B, lt_midden = C, gt_midden = D, unknown = E.
 */
export const IncomeBand = z.enum(["lt_passend", "lt_daeb", "lt_midden", "gt_midden", "unknown"]);
export type IncomeBand = z.infer<typeof IncomeBand>;

type StoredIncomeBand = NonNullable<z.infer<typeof ProfilePatch>["incomeBand"]>;
type _BandsInSync = [IncomeBand] extends [StoredIncomeBand]
  ? [StoredIncomeBand] extends [IncomeBand]
    ? true
    : never
  : never;
const _bandsInSync: _BandsInSync = true;

/**
 * User profile, with exactly the fields the database stores
 * (`user` in packages/db/src/auth-schema.ts). Nothing else is collected or inferred.
 * `dateOfBirth` is NOT NULL in the database; we accept `null` to degrade instead of crashing.
 */
export interface EligibilityProfile {
  dateOfBirth: Date | string | null;
  householdSize: number | null;
  /** Free text in the database; anything that is not a known band is treated as absent. */
  incomeBand: string | null;
  isSocialTenant: boolean | null;
  keyProfession: boolean | null;
}

export interface EligibilityInput {
  listing: CanonicalListing;
  profile: EligibilityProfile;
  /** Evaluation date (default: now). Decides the freshness of the thresholds' verification. */
  at?: Date;
}

/** §6: a threshold verified more than 180 days ago no longer supports income/age verdicts. */
export const MAX_RULE_VERIFICATION_AGE_DAYS = 180;

const DAY_MS = 86_400_000;

/** A threshold only supports a verdict if we verified it and it is still fresh (§6). */
export function isMarketRuleUsable(rule: MarketRule, at: Date): boolean {
  if (!rule.verified || !rule.verifiedAt) return false;
  const verifiedAt = Date.parse(`${rule.verifiedAt}T00:00:00Z`);
  if (Number.isNaN(verifiedAt)) return false;
  return (at.getTime() - verifiedAt) / DAY_MS <= MAX_RULE_VERIFICATION_AGE_DAYS;
}

/**
 * Age in completed years on the given date, in UTC at both ends.
 * Birthday today ⇒ already has the new age. Returns `null` if the date is invalid or in the future.
 */
export function ageInYears(dateOfBirth: Date | string | null, at: Date): number | null {
  if (dateOfBirth === null) return null;
  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const monthDay = (d: Date) => (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  if (monthDay(at) < monthDay(dob)) age -= 1;
  return age < 0 ? null : age;
}

type ListingEligibility = NonNullable<CanonicalListing["eligibility"]>;

const EMPTY_ELIGIBILITY: ListingEligibility = {
  minIncome: null,
  maxIncome: null,
  minAge: null,
  maxAge: null,
  minHousehold: null,
  maxHousehold: null,
  localBindingPriority: null,
};

/** Annual income range compatible with the declared band. A superset: never excludes too much. */
interface IncomeInterval {
  min: number;
  /** `true` when the band starts above `min` (bands C and D). */
  minExclusive: boolean;
  max: number | null;
}

/** Collector of the rules used, for the §5 explanation and the freshness test. */
class RuleBag {
  readonly rules: MarketRule[] = [];
  private usable = true;

  constructor(
    /** Date the thresholds are read at (listing publication). */
    private readonly readAt: Date,
    /** Evaluation date, against which verification freshness is measured. */
    private readonly freshnessAt: Date,
  ) {}

  /** Reads the rule in force at the publication date; marks the bag unusable if missing/stale. */
  take(key: RuleKey): MarketRule | null {
    let rule: MarketRule;
    try {
      rule = getRule(key, this.readAt);
    } catch {
      this.usable = false;
      return null;
    }
    this.rules.push(rule);
    if (!isMarketRuleUsable(rule, this.freshnessAt)) this.usable = false;
    return rule;
  }

  /** `true` if every rule read exists, is verified and is fresh. */
  get ok(): boolean {
    return this.usable;
  }
}

function parseBand(value: string | null): IncomeBand | null {
  const parsed = IncomeBand.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function hasLabel(listing: CanonicalListing, label: ListingLabel): boolean {
  return listing.labels.includes(label);
}

/** Picks the single/multi threshold; without a known household returns `null` and the caller widens. */
function pickByHousehold(
  single: number,
  multi: number,
  householdSize: number | null,
): number | null {
  if (householdSize === null) return null;
  return householdSize <= 1 ? single : multi;
}

/**
 * Annual income range of the band. Without a known household it widens to the worst case
 * (lowest lower bound, highest upper bound) — so we only conclude "outside" when it is certain.
 */
function incomeInterval(
  band: Exclude<IncomeBand, "unknown">,
  householdSize: number | null,
  bag: RuleBag,
): IncomeInterval | null {
  const daebSingle = bag.take("daeb_income_single");
  const daebMulti = bag.take("daeb_income_multi");
  if (!daebSingle || !daebMulti) return null;
  const daebPick = pickByHousehold(daebSingle.value, daebMulti.value, householdSize);
  if (band === "lt_passend" || band === "lt_daeb") {
    // Bands A and B: up to the DAEB cap. The A↔B boundary (huurtoeslag) does not exist in
    // market-rules; widening to the DAEB cap keeps the range a superset.
    return {
      min: 0,
      minExclusive: false,
      max: daebPick ?? Math.max(daebSingle.value, daebMulti.value),
    };
  }
  const middenSingle = bag.take("midden_income_single_max");
  const middenMulti = bag.take("midden_income_multi_max");
  if (!middenSingle || !middenMulti) return null;
  const middenPick = pickByHousehold(middenSingle.value, middenMulti.value, householdSize);
  if (band === "lt_midden") {
    return {
      min: daebPick ?? Math.min(daebSingle.value, daebMulti.value),
      minExclusive: true,
      max: middenPick ?? Math.max(middenSingle.value, middenMulti.value),
    };
  }
  return {
    min: middenPick ?? Math.min(middenSingle.value, middenMulti.value),
    minExclusive: true,
    max: null,
  };
}

interface DimensionOutcome {
  status: DimensionStatus;
  reason: EligibilityReason;
  notes?: EligibilityNote[];
}

/** §4.1 — segment × income band, plus the income limits the listing itself publishes. */
function evaluateIncome(
  listing: CanonicalListing,
  eligibility: ListingEligibility,
  band: IncomeBand | null,
  householdSize: number | null,
  bag: RuleBag,
): DimensionOutcome {
  if (band === null) return { status: "unknown", reason: "income_band_missing" };
  if (band === "unknown") return { status: "unknown", reason: "income_band_not_declared" };
  // §6: without a separate kale huur we do not classify; never infer from the total.
  if (listing.priceNet === null) return { status: "unknown", reason: "listing_net_rent_missing" };
  if (listing.segment !== "social" && listing.segment !== "midden") {
    return { status: "unknown", reason: "listing_segment_not_regulated" };
  }

  const interval = incomeInterval(band, householdSize, bag);
  if (!bag.ok || !interval) return { status: "unknown", reason: "market_rule_unverified" };

  // Limits published by the listing: they only fail when the whole band falls outside.
  const { minIncome, maxIncome } = eligibility;
  if (
    maxIncome !== null &&
    (interval.minExclusive ? interval.min >= maxIncome : interval.min > maxIncome)
  ) {
    return { status: "no_fit", reason: "income_above_listing_max" };
  }
  if (minIncome !== null && interval.max !== null && interval.max < minIncome) {
    return { status: "no_fit", reason: "income_below_listing_min" };
  }

  if (listing.segment === "social") {
    if (band === "lt_passend" || band === "lt_daeb") {
      return { status: "fit", reason: "income_band_within_segment" };
    }
    // Vrije toewijzingsruimte: the exception exists, so the note always accompanies the "no".
    return {
      status: "no_fit",
      reason: "income_band_above_segment",
      notes: ["social_income_exception_possible"],
    };
  }
  if (band === "lt_midden") return { status: "fit", reason: "income_band_within_segment" };
  if (band === "gt_midden") {
    // §4.1 note 3: without the municipal middenhuur band we assert nothing.
    return { status: "unknown", reason: "municipal_midden_income_band_missing" };
  }
  return {
    status: "no_fit",
    reason: "income_band_below_segment",
    notes: ["income_maybe_too_low_for_landlord"],
  };
}

/**
 * §4.2 — kale huur against the applicable aftoppingsgrens. Only warns, never fails:
 * it matters to someone receiving huurtoeslag (band A) on a social listing.
 */
function evaluateAftoppingsgrens(
  listing: CanonicalListing,
  band: IncomeBand | null,
  householdSize: number | null,
  bag: RuleBag,
): DimensionOutcome {
  if (listing.segment !== "social" || band !== "lt_passend" || listing.priceNet === null) {
    return { status: "not_applicable", reason: "no_household_condition" };
  }
  // Never fails: not knowing the household must not change the verdict.
  if (householdSize === null) {
    return { status: "not_applicable", reason: "aftoppingsgrens_not_checked" };
  }
  const cap = bag.take(householdSize <= 2 ? "aftoppingsgrens_1" : "aftoppingsgrens_2");
  if (!cap || !bag.ok) {
    return { status: "not_applicable", reason: "aftoppingsgrens_not_checked" };
  }
  if (listing.priceNet > cap.value) {
    return {
      status: "warn",
      reason: "rent_above_aftoppingsgrens",
      notes: ["above_aftoppingsgrens_less_huurtoeslag"],
    };
  }
  return { status: "fit", reason: "rent_within_aftoppingsgrens" };
}

/**
 * §4.2 — the listing's household minimums/maximums (hard) and aftoppingsgrens (warning only).
 * They are independent checks: a listing that publishes household limits can still be
 * above the aftoppingsgrens, so both always run.
 */
function evaluateHousehold(
  listing: CanonicalListing,
  eligibility: ListingEligibility,
  band: IncomeBand | null,
  householdSize: number | null,
  bag: RuleBag,
): DimensionOutcome {
  const { minHousehold, maxHousehold } = eligibility;
  const hasListingBounds = minHousehold !== null || maxHousehold !== null;
  if (hasListingBounds) {
    if (householdSize === null) return { status: "unknown", reason: "household_size_missing" };
    if (minHousehold !== null && householdSize < minHousehold) {
      return { status: "no_fit", reason: "household_below_listing_min" };
    }
    if (maxHousehold !== null && householdSize > maxHousehold) {
      return { status: "no_fit", reason: "household_above_listing_max" };
    }
  } else if (hasLabel(listing, "grote_gezinnen")) {
    // Listing for large families WITHOUT a published minimum: `groot_gezin_min_personen` does not
    // exist in market-rules, so there is no way to decide (§3, keys to create). With a published
    // minimum the branch above has already decided, so this one only runs without listing limits —
    // otherwise a `grote_gezinnen` with `minHousehold` would drop from `fit` to `unknown`.
    return { status: "unknown", reason: "large_family_minimum_missing" };
  }

  const capped = evaluateAftoppingsgrens(listing, band, householdSize, bag);
  if (!hasListingBounds) return capped;
  // The household meets the listing's limits: that is the reason to show. The aftoppingsgrens
  // only replaces it when it warns — a dimension carries a single reason, and swapping a `fit`
  // for `rent_within_aftoppingsgrens`/`no_household_condition` would erase the fact that the
  // listing had a household condition that was met.
  return capped.status === "warn"
    ? capped
    : { status: "fit", reason: "household_within_listing_range" };
}

/** §4.3 — age: the listing's own limits first, the usual rule only as a fallback. */
function evaluateAge(
  listing: CanonicalListing,
  eligibility: ListingEligibility,
  age: number | null,
  bag: RuleBag,
): DimensionOutcome {
  const { minAge, maxAge } = eligibility;
  if (minAge !== null || maxAge !== null) {
    if (age === null) return { status: "unknown", reason: "date_of_birth_missing" };
    if (minAge !== null && age < minAge)
      return { status: "no_fit", reason: "age_below_listing_min" };
    if (maxAge !== null && age > maxAge)
      return { status: "no_fit", reason: "age_above_listing_max" };
    return { status: "fit", reason: "age_within_listing_range" };
  }

  const isYouth = hasLabel(listing, "jongeren");
  const isSenior = hasLabel(listing, "senioren");
  // `nultreden` is a preference, not a condition: it never goes in here.
  if (!isYouth && !isSenior) return { status: "not_applicable", reason: "no_age_condition" };
  if (age === null) return { status: "unknown", reason: "date_of_birth_missing" };

  const lower = isYouth ? bag.take("youth_age_min") : bag.take("senior_age_min_common");
  const upper = isYouth ? bag.take("youth_age_max") : null;
  if (!lower || (isYouth && !upper) || !bag.ok) {
    return { status: "unknown", reason: "market_rule_unverified" };
  }
  const outside = age < lower.value || (upper !== null && age > upper.value);
  return {
    status: outside ? "no_fit" : "fit",
    reason: outside ? "age_outside_usual_rule" : "age_within_usual_rule",
    notes: ["age_rule_is_the_usual_one"],
  };
}

/** §4.3 — student listing: the profile does not store student status, so we never assert. */
function evaluateTargetGroup(listing: CanonicalListing): DimensionOutcome {
  if (hasLabel(listing, "student")) {
    return { status: "unknown", reason: "student_status_not_collected" };
  }
  return { status: "not_applicable", reason: "no_target_group_condition" };
}

/** §4.4 — exclusive priority for doorstromers is a listing condition, not a tip. */
function evaluatePriority(
  listing: CanonicalListing,
  isSocialTenant: boolean | null,
): DimensionOutcome {
  if (!hasLabel(listing, "doorstromers")) {
    return { status: "not_applicable", reason: "no_priority_condition" };
  }
  if (isSocialTenant === null) return { status: "unknown", reason: "social_tenant_status_missing" };
  return isSocialTenant
    ? { status: "fit", reason: "doorstromer_required_met" }
    : { status: "no_fit", reason: "doorstromer_required_not_met" };
}

/**
 * Computes the "past bij jou" signal for a listing and a profile.
 * Composition (§4.5): hard no_fit → NO_FIT; income outside the band → UNLIKELY;
 * any unknown dimension → UNKNOWN; everything fits → FIT.
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const { listing, profile } = input;
  const at = input.at ?? new Date();
  // §3 rule 1: the threshold in force is the one at the listing's publication date.
  const readAt = listing.publishedAt ? new Date(listing.publishedAt) : at;
  const rulesReadAt = (Number.isNaN(readAt.getTime()) ? at : readAt).toISOString().slice(0, 10);

  const eligibility = listing.eligibility ?? EMPTY_ELIGIBILITY;
  const band = parseBand(profile.incomeBand);
  const householdSize =
    typeof profile.householdSize === "number" && profile.householdSize > 0
      ? profile.householdSize
      : null;
  const age = ageInYears(profile.dateOfBirth, at);

  const findings: EligibilityFinding[] = [];
  const notes: EligibilityNote[] = [];
  const rulesUsed: MarketRule[] = [];

  const record = (dimension: EligibilityDimension, outcome: DimensionOutcome, bag: RuleBag) => {
    findings.push({
      dimension,
      status: outcome.status,
      reason: outcome.reason,
      rules: bag.rules,
    });
    for (const note of outcome.notes ?? []) if (!notes.includes(note)) notes.push(note);
    for (const rule of bag.rules) if (!rulesUsed.includes(rule)) rulesUsed.push(rule);
  };

  const newBag = () => new RuleBag(Number.isNaN(readAt.getTime()) ? at : readAt, at);

  const incomeBag = newBag();
  record("income", evaluateIncome(listing, eligibility, band, householdSize, incomeBag), incomeBag);
  const householdBag = newBag();
  record(
    "household",
    evaluateHousehold(listing, eligibility, band, householdSize, householdBag),
    householdBag,
  );
  const ageBag = newBag();
  record("age", evaluateAge(listing, eligibility, age, ageBag), ageBag);
  const targetBag = newBag();
  record("target_group", evaluateTargetGroup(listing), targetBag);
  const priorityBag = newBag();
  record("priority", evaluatePriority(listing, profile.isSocialTenant), priorityBag);

  if (eligibility.localBindingPriority === true) notes.push("local_binding_priority");

  const hints: EligibilityHint[] = [];
  if (profile.isSocialTenant === true && listing.segment === "midden") {
    hints.push("mention_doorstromer");
  }
  if (profile.keyProfession === true && hasLabel(listing, "sleutelberoepen")) {
    hints.push("mention_key_profession");
  }

  // §4.5: only income is "soft"; the other dimensions fail hard.
  const hardNo = findings.find((f) => f.status === "no_fit" && f.dimension !== "income");
  const softNo = findings.find((f) => f.status === "no_fit" && f.dimension === "income");
  const unknown = findings.find((f) => f.status === "unknown");
  const decided = hardNo ?? softNo ?? unknown ?? null;
  const state: EligibilityState = hardNo
    ? "NO_FIT"
    : softNo
      ? "UNLIKELY"
      : unknown
        ? "UNKNOWN"
        : "FIT";

  return {
    state,
    reason: decided ? decided.reason : "all_conditions_match",
    decidedBy: decided ? decided.dimension : null,
    findings,
    notes,
    hints,
    rulesUsed,
    rulesReadAt,
  };
}
