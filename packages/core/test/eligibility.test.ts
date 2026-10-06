import { describe, expect, it } from "vitest";
import type { CanonicalListing, EligibilityProfile, ListingLabel } from "../src/index";
import {
  ageInYears,
  evaluateEligibility,
  getRule,
  IncomeBand,
  isMarketRuleUsable,
  MAX_RULE_VERIFICATION_AGE_DAYS,
  ProfilePatch,
} from "../src/index";

/** Fixed evaluation date: the 2026 rules are verified on 2026-09-06. */
const AT = new Date("2026-09-11T12:00:00Z");
const PUBLISHED = "2026-09-11T09:00:00.000Z";

type ListingOverrides = Partial<CanonicalListing> & {
  eligibility?: CanonicalListing["eligibility"];
};

function listing(over: ListingOverrides = {}): CanonicalListing {
  const base: CanonicalListing = {
    sourceSlug: "example-portal",
    sourceListingId: "1",
    canonicalKey: "5625NH-46",
    url: "https://portal-a.example.nl/aanbod/1",
    applyUrl: null,
    title: "Kerkstraat 1",
    segment: "social",
    segmentReason: "price<=social_rent_cap(932.93)",
    allocationModel: "inschrijfduur",
    closesAfterFirstReaction: false,
    priceNet: 700,
    priceTotal: 760,
    serviceCosts: 60,
    address: {
      street: "Kerkstraat",
      houseNumber: "1",
      houseNumberAddition: null,
      postcode: "5625NH",
      city: "Eindhoven",
      municipality: "Eindhoven",
      province: "Noord-Brabant",
      country: "NL",
    },
    location: null,
    rooms: 3,
    bedrooms: 2,
    areaM2: 70,
    dwellingType: "appartement",
    dwellingCategory: "apartment",
    energyLabel: "B",
    constructionYear: 1998,
    floor: 2,
    availableFrom: null,
    availableFromText: null,
    publishedAt: PUBLISHED,
    closesAt: null,
    labels: [],
    targetGroups: [],
    operator: { code: null, name: "Woonbedrijf" },
    registrationRequired: true,
    huurtoeslagPossible: true,
    photos: [],
    thumbnail: null,
    isNewBuild: false,
    isExchange: false,
    notices: [],
    eligibility: null,
    reactionsCount: null,
    description: null,
    rawHash: "hash",
  };
  return { ...base, ...over };
}

function profile(over: Partial<EligibilityProfile> = {}): EligibilityProfile {
  return {
    dateOfBirth: "1990-05-20T00:00:00.000Z",
    householdSize: 2,
    incomeBand: "lt_daeb",
    isSocialTenant: false,
    keyProfession: false,
    ...over,
  };
}

function evaluate(over: ListingOverrides = {}, prof: Partial<EligibilityProfile> = {}) {
  return evaluateEligibility({ listing: listing(over), profile: profile(prof), at: AT });
}

const labels = (...l: ListingLabel[]): ListingLabel[] => l;

describe("ageInYears", () => {
  it("counts the birthday itself as the new age", () => {
    expect(ageInYears("2000-09-11T00:00:00.000Z", new Date("2026-09-10T23:00:00Z"))).toBe(25);
    expect(ageInYears("2000-09-11T00:00:00.000Z", new Date("2026-09-11T00:00:00Z"))).toBe(26);
    expect(ageInYears("2000-09-12T00:00:00.000Z", new Date("2026-09-11T00:00:00Z"))).toBe(25);
  });
  it("handles a 29 February birth date", () => {
    expect(ageInYears("2000-02-29T00:00:00.000Z", new Date("2026-02-28T00:00:00Z"))).toBe(25);
    expect(ageInYears("2000-02-29T00:00:00.000Z", new Date("2026-03-01T00:00:00Z"))).toBe(26);
  });
  it("accepts Date objects and rejects what it cannot read", () => {
    expect(ageInYears(new Date("1990-01-01T00:00:00Z"), AT)).toBe(36);
    expect(ageInYears("not a date", AT)).toBeNull();
    expect(ageInYears(null, AT)).toBeNull();
    expect(ageInYears("2030-01-01T00:00:00.000Z", AT)).toBeNull();
  });
});

describe("income bands", () => {
  it("mirrors the bands the profile actually stores", () => {
    for (const band of IncomeBand.options) {
      expect(ProfilePatch.parse({ incomeBand: band }).incomeBand).toBe(band);
    }
  });
});

describe("market rule freshness", () => {
  const rule = getRule("social_rent_cap", new Date("2026-06-01"));
  it("accepts a rule verified within the window", () => {
    expect(isMarketRuleUsable(rule, AT)).toBe(true);
    expect(MAX_RULE_VERIFICATION_AGE_DAYS).toBe(180);
  });
  it("rejects a stale verification and an unverified rule", () => {
    const stale = new Date("2027-06-01T00:00:00Z");
    expect(isMarketRuleUsable(rule, stale)).toBe(false);
    expect(isMarketRuleUsable(getRule("youth_age_min", AT), AT)).toBe(false);
  });
});

describe("FIT state", () => {
  it("social listing plus a band below the DAEB ceiling", () => {
    const r = evaluate();
    expect(r.state).toBe("FIT");
    expect(r.reason).toBe("all_conditions_match");
    expect(r.decidedBy).toBeNull();
    expect(r.findings.find((f) => f.dimension === "income")?.reason).toBe(
      "income_band_within_segment",
    );
  });
  it("midden listing plus a middle income", () => {
    const r = evaluate({ segment: "midden", priceNet: 1100 }, { incomeBand: "lt_midden" });
    expect(r.state).toBe("FIT");
  });
  it("reports the rules behind the verdict, read at publication date", () => {
    const r = evaluate();
    expect(r.rulesReadAt).toBe("2026-09-11");
    expect(r.rulesUsed.map((x) => x.key)).toContain("daeb_income_single");
    expect(r.rulesUsed.every((x) => x.verified)).toBe(true);
  });
  it("reads the threshold valid at publication time, not today", () => {
    const r = evaluateEligibility({
      listing: listing({ publishedAt: "2025-06-01T10:00:00.000Z" }),
      profile: profile(),
      at: new Date("2025-06-02T00:00:00Z"),
    });
    expect(r.rulesReadAt).toBe("2025-06-01");
    // Without income rules in force in 2025 we invent nothing.
    expect(r.state).toBe("UNKNOWN");
    expect(r.reason).toBe("market_rule_unverified");
  });
});

describe("UNLIKELY state (income outside the segment band)", () => {
  it("social listing with an income above the ceiling keeps the exception note", () => {
    const r = evaluate({}, { incomeBand: "lt_midden" });
    expect(r.state).toBe("UNLIKELY");
    expect(r.reason).toBe("income_band_above_segment");
    expect(r.decidedBy).toBe("income");
    expect(r.notes).toContain("social_income_exception_possible");
  });
  it("midden listing with a low income fails on solvency, not on a legal cap", () => {
    const r = evaluate({ segment: "midden", priceNet: 1100 }, { incomeBand: "lt_passend" });
    expect(r.state).toBe("UNLIKELY");
    expect(r.reason).toBe("income_band_below_segment");
    expect(r.notes).toContain("income_maybe_too_low_for_landlord");
  });
  it("uses the income limits the listing publishes", () => {
    const daeb = getRule("daeb_income_multi", AT).value;
    const r = evaluate({
      eligibility: {
        minIncome: null,
        maxIncome: daeb + 1_000,
        minAge: null,
        maxAge: null,
        minHousehold: null,
        maxHousehold: null,
        localBindingPriority: null,
      },
      segment: "midden",
      priceNet: 1100,
    });
    // Band lt_daeb (≤ DAEB cap) against a maximum above the cap: the listing allows no conclusion,
    // the §4.1 table decides (income too low for middenhuur).
    expect(r.reason).toBe("income_band_below_segment");
    const above = evaluate(
      {
        eligibility: {
          minIncome: null,
          maxIncome: daeb,
          minAge: null,
          maxAge: null,
          minHousehold: null,
          maxHousehold: null,
          localBindingPriority: null,
        },
      },
      { incomeBand: "lt_midden" },
    );
    expect(above.state).toBe("UNLIKELY");
    expect(above.reason).toBe("income_above_listing_max");
  });
  it("flags an income wholly below the minimum the listing asks for", () => {
    const daeb = getRule("daeb_income_multi", AT).value;
    const r = evaluate({
      eligibility: {
        minIncome: daeb + 1,
        maxIncome: null,
        minAge: null,
        maxAge: null,
        minHousehold: null,
        maxHousehold: null,
        localBindingPriority: null,
      },
    });
    expect(r.state).toBe("UNLIKELY");
    expect(r.reason).toBe("income_below_listing_min");
  });
});

describe("NO_FIT state (hard listing conditions)", () => {
  it("age below the minimum the listing declares", () => {
    const r = evaluate({
      eligibility: {
        minIncome: null,
        maxIncome: null,
        minAge: 55,
        maxAge: null,
        minHousehold: null,
        maxHousehold: null,
        localBindingPriority: null,
      },
    });
    expect(r.state).toBe("NO_FIT");
    expect(r.reason).toBe("age_below_listing_min");
    expect(r.decidedBy).toBe("age");
  });
  it("age above the maximum the listing declares", () => {
    const r = evaluate({
      eligibility: {
        minIncome: null,
        maxIncome: null,
        minAge: null,
        maxAge: 27,
        minHousehold: null,
        maxHousehold: null,
        localBindingPriority: null,
      },
    });
    expect(r.state).toBe("NO_FIT");
    expect(r.reason).toBe("age_above_listing_max");
  });
  it("household outside the range the listing declares", () => {
    const bounds = {
      minIncome: null,
      maxIncome: null,
      minAge: null,
      maxAge: null,
      minHousehold: 4,
      maxHousehold: 6,
      localBindingPriority: null,
    };
    expect(evaluate({ eligibility: bounds }).reason).toBe("household_below_listing_min");
    expect(evaluate({ eligibility: bounds }).state).toBe("NO_FIT");
    const big = evaluate({ eligibility: bounds }, { householdSize: 7 });
    expect(big.reason).toBe("household_above_listing_max");
  });
  it("a doorstromers-only listing rejects who is not a social tenant", () => {
    const r = evaluate({ labels: labels("doorstromers") });
    expect(r.state).toBe("NO_FIT");
    expect(r.reason).toBe("doorstromer_required_not_met");
    expect(r.decidedBy).toBe("priority");
  });
  it("a hard no wins over a missing profile field", () => {
    const r = evaluate({ labels: labels("doorstromers") }, { incomeBand: null });
    expect(r.state).toBe("NO_FIT");
  });
});

describe("UNKNOWN state (degradation)", () => {
  it("no income band declared", () => {
    expect(evaluate({}, { incomeBand: null }).state).toBe("UNKNOWN");
    expect(evaluate({}, { incomeBand: null }).reason).toBe("income_band_missing");
    expect(evaluate({}, { incomeBand: "prefer_not_to_say" }).reason).toBe("income_band_missing");
    expect(evaluate({}, { incomeBand: "unknown" }).reason).toBe("income_band_not_declared");
  });
  it("listing without kale huur separated from the total", () => {
    const r = evaluate({ priceNet: null });
    expect(r.state).toBe("UNKNOWN");
    expect(r.reason).toBe("listing_net_rent_missing");
  });
  it("listing outside the regulated segments", () => {
    expect(evaluate({ segment: "free", priceNet: 1500 }).reason).toBe(
      "listing_segment_not_regulated",
    );
    expect(evaluate({ segment: "unknown" }).reason).toBe("listing_segment_not_regulated");
  });
  it("income above the municipal midden band, which we do not have", () => {
    const r = evaluate({ segment: "midden", priceNet: 1100 }, { incomeBand: "gt_midden" });
    expect(r.state).toBe("UNKNOWN");
    expect(r.reason).toBe("municipal_midden_income_band_missing");
  });
  it("age label without a threshold from the listing: the usual rule is not verified", () => {
    const r = evaluate({ labels: labels("jongeren") });
    expect(r.state).toBe("UNKNOWN");
    expect(r.reason).toBe("market_rule_unverified");
    expect(r.decidedBy).toBe("age");
    expect(evaluate({ labels: labels("senioren") }).reason).toBe("market_rule_unverified");
  });
  it("student listing: we never ask for student status", () => {
    const r = evaluate({ labels: labels("student") });
    expect(r.state).toBe("UNKNOWN");
    expect(r.reason).toBe("student_status_not_collected");
    expect(r.decidedBy).toBe("target_group");
  });
  it("large family listing without a published minimum", () => {
    const r = evaluate({ labels: labels("grote_gezinnen") });
    expect(r.state).toBe("UNKNOWN");
    expect(r.reason).toBe("large_family_minimum_missing");
  });
  it("age condition without a date of birth", () => {
    const r = evaluate(
      {
        eligibility: {
          minIncome: null,
          maxIncome: null,
          minAge: 18,
          maxAge: null,
          minHousehold: null,
          maxHousehold: null,
          localBindingPriority: null,
        },
      },
      { dateOfBirth: null },
    );
    expect(r.state).toBe("UNKNOWN");
    expect(r.reason).toBe("date_of_birth_missing");
  });
  it("household condition without a household size", () => {
    const r = evaluate(
      {
        eligibility: {
          minIncome: null,
          maxIncome: null,
          minAge: null,
          maxAge: null,
          minHousehold: 3,
          maxHousehold: null,
          localBindingPriority: null,
        },
      },
      { householdSize: null },
    );
    expect(r.state).toBe("UNKNOWN");
    expect(r.reason).toBe("household_size_missing");
  });
  it("doorstromers listing without a declared social tenancy", () => {
    const r = evaluate({ labels: labels("doorstromers") }, { isSocialTenant: null });
    expect(r.state).toBe("UNKNOWN");
    expect(r.reason).toBe("social_tenant_status_missing");
  });
  it("a stale verification stops income verdicts", () => {
    const r = evaluateEligibility({
      listing: listing({ publishedAt: "2026-09-11T09:00:00.000Z" }),
      profile: profile(),
      // More than 180 days after the thresholds were last verified.
      at: new Date("2027-06-01T00:00:00Z"),
    });
    expect(r.state).toBe("UNKNOWN");
    expect(r.reason).toBe("market_rule_unverified");
  });
});

describe("boundaries", () => {
  it("age exactly at the listing minimum and maximum", () => {
    const bounds = (minAge: number | null, maxAge: number | null) => ({
      minIncome: null,
      maxIncome: null,
      minAge,
      maxAge,
      minHousehold: null,
      maxHousehold: null,
      localBindingPriority: null,
    });
    // Born 1990-05-20; on 2026-09-11 is 36 full years old.
    expect(evaluate({ eligibility: bounds(36, null) }).state).toBe("FIT");
    expect(evaluate({ eligibility: bounds(37, null) }).state).toBe("NO_FIT");
    expect(evaluate({ eligibility: bounds(null, 36) }).state).toBe("FIT");
    expect(evaluate({ eligibility: bounds(null, 35) }).state).toBe("NO_FIT");
  });
  it("turning the minimum age on the very day of evaluation", () => {
    const dob = "2008-09-11T00:00:00.000Z"; // turns 18 on 2026-09-11
    const bounds = {
      minIncome: null,
      maxIncome: null,
      minAge: 18,
      maxAge: null,
      minHousehold: null,
      maxHousehold: null,
      localBindingPriority: null,
    };
    expect(evaluate({ eligibility: bounds }, { dateOfBirth: dob }).state).toBe("FIT");
    const dayBefore = evaluateEligibility({
      listing: listing({ eligibility: bounds }),
      profile: profile({ dateOfBirth: dob }),
      at: new Date("2026-09-10T23:59:59Z"),
    });
    expect(dayBefore.state).toBe("NO_FIT");
    expect(dayBefore.reason).toBe("age_below_listing_min");
  });
  it("household exactly at the listing limits", () => {
    const bounds = {
      minIncome: null,
      maxIncome: null,
      minAge: null,
      maxAge: null,
      minHousehold: 2,
      maxHousehold: 4,
      localBindingPriority: null,
    };
    expect(evaluate({ eligibility: bounds }, { householdSize: 2 }).state).toBe("FIT");
    expect(evaluate({ eligibility: bounds }, { householdSize: 1 }).state).toBe("NO_FIT");
    expect(evaluate({ eligibility: bounds }, { householdSize: 4 }).state).toBe("FIT");
    expect(evaluate({ eligibility: bounds }, { householdSize: 5 }).state).toBe("NO_FIT");
  });
  it("income exactly at the ceiling the listing publishes", () => {
    const daeb = getRule("daeb_income_multi", AT).value;
    const at = (maxIncome: number) => ({
      minIncome: null,
      maxIncome,
      minAge: null,
      maxAge: null,
      minHousehold: null,
      maxHousehold: null,
      localBindingPriority: null,
    });
    // Band lt_midden starts above the DAEB cap: a maximum equal to the cap excludes it.
    expect(evaluate({ eligibility: at(daeb) }, { incomeBand: "lt_midden" }).reason).toBe(
      "income_above_listing_max",
    );
    // One euro more no longer allows a conclusion from the listing limit.
    expect(evaluate({ eligibility: at(daeb + 1) }, { incomeBand: "lt_midden" }).reason).toBe(
      "income_band_above_segment",
    );
    // Band up to the DAEB cap against a maximum equal to the cap: compatible.
    expect(evaluate({ eligibility: at(daeb) }, { incomeBand: "lt_daeb" }).state).toBe("FIT");
  });
  it("rent exactly at the aftoppingsgrens only warns, never rejects", () => {
    const cap = getRule("aftoppingsgrens_1", AT).value;
    const atCap = evaluate({ priceNet: cap }, { incomeBand: "lt_passend", householdSize: 2 });
    expect(atCap.state).toBe("FIT");
    expect(atCap.findings.find((f) => f.dimension === "household")?.reason).toBe(
      "rent_within_aftoppingsgrens",
    );
    const above = evaluate(
      { priceNet: cap + 0.01 },
      { incomeBand: "lt_passend", householdSize: 2 },
    );
    expect(above.state).toBe("FIT");
    expect(above.findings.find((f) => f.dimension === "household")?.status).toBe("warn");
    expect(above.notes).toContain("above_aftoppingsgrens_less_huurtoeslag");
  });
  it("household of three uses the higher aftoppingsgrens", () => {
    const low = getRule("aftoppingsgrens_1", AT).value;
    const high = getRule("aftoppingsgrens_2", AT).value;
    const between = (low + high) / 2;
    const couple = evaluate({ priceNet: between }, { incomeBand: "lt_passend", householdSize: 2 });
    expect(couple.findings.find((f) => f.dimension === "household")?.status).toBe("warn");
    const family = evaluate({ priceNet: between }, { incomeBand: "lt_passend", householdSize: 3 });
    expect(family.findings.find((f) => f.dimension === "household")?.status).toBe("fit");
  });
  it("a missing household size never blocks a verdict that does not need it", () => {
    const r = evaluate({}, { householdSize: null });
    expect(r.state).toBe("FIT");
    expect(r.findings.find((f) => f.dimension === "household")?.status).toBe("not_applicable");
  });
  it("still warns above the aftoppingsgrens when the listing publishes household limits", () => {
    const cap = getRule("aftoppingsgrens_1", AT).value;
    const bounds = {
      minIncome: null,
      maxIncome: null,
      minAge: null,
      maxAge: null,
      minHousehold: 1,
      maxHousehold: 2,
      localBindingPriority: null,
    };
    const r = evaluate(
      { priceNet: cap + 1, eligibility: bounds },
      { incomeBand: "lt_passend", householdSize: 2 },
    );
    const household = r.findings.find((f) => f.dimension === "household");
    expect(household?.status).toBe("warn");
    expect(household?.reason).toBe("rent_above_aftoppingsgrens");
    expect(r.notes).toContain("above_aftoppingsgrens_less_huurtoeslag");
    expect(r.state).toBe("FIT");
  });
  it("keeps the listing-range reason when the aftoppingsgrens adds nothing", () => {
    const cap = getRule("aftoppingsgrens_1", AT).value;
    const bounds = {
      minIncome: null,
      maxIncome: null,
      minAge: null,
      maxAge: null,
      minHousehold: 1,
      maxHousehold: 2,
      localBindingPriority: null,
    };
    // Below the aftoppingsgrens: nothing to add, the reason stays the listing's.
    const under = evaluate(
      { priceNet: cap - 1, eligibility: bounds },
      { incomeBand: "lt_passend", householdSize: 2 },
    );
    expect(under.findings.find((f) => f.dimension === "household")?.status).toBe("fit");
    expect(under.findings.find((f) => f.dimension === "household")?.reason).toBe(
      "household_within_listing_range",
    );
    expect(under.notes).not.toContain("above_aftoppingsgrens_less_huurtoeslag");
    // Band without huurtoeslag: the aftoppingsgrens does not apply and the reason does not become not_applicable.
    const otherBand = evaluate(
      { priceNet: cap + 1, eligibility: bounds },
      { incomeBand: "lt_daeb", householdSize: 2 },
    );
    const household = otherBand.findings.find((f) => f.dimension === "household");
    expect(household?.status).toBe("fit");
    expect(household?.reason).toBe("household_within_listing_range");
    expect(otherBand.state).toBe("FIT");
  });
  it("a grote_gezinnen listing that publishes its own minimum stays decidable", () => {
    const r = evaluate(
      {
        labels: labels("grote_gezinnen"),
        eligibility: {
          minIncome: null,
          maxIncome: null,
          minAge: null,
          maxAge: null,
          minHousehold: 3,
          maxHousehold: null,
          localBindingPriority: null,
        },
      },
      { householdSize: 4 },
    );
    const household = r.findings.find((f) => f.dimension === "household");
    expect(household?.status).toBe("fit");
    expect(household?.reason).toBe("household_within_listing_range");
    expect(r.state).toBe("FIT");
  });
});

describe("tips and notes", () => {
  it("suggests mentioning the social home you are leaving on middenhuur", () => {
    const r = evaluate(
      { segment: "midden", priceNet: 1100 },
      { incomeBand: "lt_midden", isSocialTenant: true },
    );
    expect(r.hints).toContain("mention_doorstromer");
    expect(r.state).toBe("FIT");
  });
  it("suggests mentioning a key profession only where the listing has a quota", () => {
    const withLabel = evaluate({ labels: labels("sleutelberoepen") }, { keyProfession: true });
    expect(withLabel.hints).toContain("mention_key_profession");
    expect(withLabel.state).toBe("FIT");
    expect(evaluate({}, { keyProfession: true }).hints).toEqual([]);
  });
  it("nultreden is a preference, never a rejection", () => {
    expect(evaluate({ labels: labels("nultreden") }).state).toBe("FIT");
  });
  it("local binding shows as a note and does not change the state", () => {
    const r = evaluate({
      eligibility: {
        minIncome: null,
        maxIncome: null,
        minAge: null,
        maxAge: null,
        minHousehold: null,
        maxHousehold: null,
        localBindingPriority: true,
      },
    });
    expect(r.state).toBe("FIT");
    expect(r.notes).toContain("local_binding_priority");
  });
  it("evaluates every dimension, always", () => {
    const r = evaluate();
    expect(r.findings.map((f) => f.dimension)).toEqual([
      "income",
      "household",
      "age",
      "target_group",
      "priority",
    ]);
  });
});
