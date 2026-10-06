import { describe, expect, it } from "vitest";
import {
  amsterdamLocalToIso,
  canonicalKey,
  classifySegment,
  getRule,
  isoDateOnly,
  normalizePostcode,
  parseRegistry,
  pollableSources,
  stableHash,
  unverifiedRules,
} from "../src/index";

describe("classifySegment", () => {
  it("prefers WWS points over the asking price", () => {
    const at = new Date("2026-09-06T00:00:00Z");
    // 212 points with rent below the middenhuur cap: free regime because of the points
    expect(classifySegment({ priceNet: 1211, wwsPoints: 212, at }).segment).toBe("free");
    expect(classifySegment({ priceNet: 1500, wwsPoints: 150, at }).segment).toBe("midden");
    expect(classifySegment({ priceNet: 1500, wwsPoints: 120, at }).segment).toBe("social");
    expect(classifySegment({ priceNet: 1500, wwsPoints: 0, at }).segment).toBe("free");
    expect(
      classifySegment({ priceNet: 900, sourceHint: "midden", wwsPoints: 212, at }).segment,
    ).toBe("midden");
  });

  const at = new Date("2026-09-06T10:00:00Z");
  it("uses thresholds from market rules", () => {
    expect(classifySegment({ priceNet: 932.93, at }).segment).toBe("social");
    expect(classifySegment({ priceNet: 932.94, at }).segment).toBe("midden");
    expect(classifySegment({ priceNet: 1228.07, at }).segment).toBe("midden");
    expect(classifySegment({ priceNet: 1228.08, at }).segment).toBe("free");
  });
  it("prefers the source hint", () => {
    expect(classifySegment({ priceNet: 500, sourceHint: "midden", at })).toEqual({
      segment: "midden",
      reason: "source_hint",
    });
  });
  it("returns unknown without price", () => {
    expect(classifySegment({ priceNet: null, at }).segment).toBe("unknown");
    expect(classifySegment({ priceNet: 0, at }).segment).toBe("unknown");
  });
});

describe("market rules", () => {
  it("resolves the rule valid at a date", () => {
    expect(getRule("social_rent_cap", new Date("2026-03-01")).value).toBe(932.93);
    expect(() => getRule("social_rent_cap", new Date("2020-01-01"))).toThrow();
  });
  it("tracks unverified values so nobody forgets", () => {
    expect(unverifiedRules().every((r) => !r.verified)).toBe(true);
  });
  it("selects the historical youth rent cap by date", () => {
    expect(getRule("huurtoeslag_youth_max_rent", new Date("2025-06-01")).value).toBe(454.47);
    expect(getRule("huurtoeslag_youth_max_rent", new Date("2026-06-01")).value).toBe(498.2);
    expect(getRule("huurtoeslag_youth_age_max", new Date("2026-06-01")).value).toBe(21);
  });
});

describe("normalize", () => {
  it("postcode", () => {
    expect(normalizePostcode("5625 nh")).toBe("5625NH");
    expect(normalizePostcode("abc")).toBeNull();
  });
  it("canonical key from address, with fallback", () => {
    expect(
      canonicalKey({
        postcode: "5625 NH",
        houseNumber: "46",
        houseNumberAddition: "",
        fallback: "x",
      }),
    ).toBe("5625NH-46");
    expect(
      canonicalKey({
        postcode: "5625 NH",
        houseNumber: "46",
        houseNumberAddition: "A-2",
        fallback: "x",
      }),
    ).toBe("5625NH-46-a2");
    expect(canonicalKey({ postcode: null, houseNumber: "46", fallback: "example-portal:1" })).toBe(
      "src:example-portal:1",
    );
  });
  it("converts Amsterdam local time to UTC across DST", () => {
    expect(amsterdamLocalToIso("2026-09-04 17:41:00")).toBe("2026-09-04T15:41:00.000Z"); // CEST +2
    expect(amsterdamLocalToIso("2026-01-15 09:00:00")).toBe("2026-01-15T08:00:00.000Z"); // CET +1
    expect(amsterdamLocalToIso("0000-00-00 00:00:00")).toBeNull();
    expect(amsterdamLocalToIso("")).toBeNull();
    expect(isoDateOnly("2026-09-06")).toBe("2026-09-06");
  });
  it("stable hash ignores key order", () => {
    expect(stableHash({ a: 1, b: [1, 2] })).toBe(stableHash({ b: [1, 2], a: 1 }));
  });
});

describe("registry", () => {
  const yaml = `
version: 1
updated_at: "2026-09-06"
sources:
  - slug: example-portal
    name: Example Portal
    kind: consortium
    stack: zig365
    tier: A
    status: live
    urls: { home: https://portal-a.example.nl/, listings: null, data: https://portal-a.example.nl/portal/object/frontend/getallobjects/format/json, robots: null, terms: null }
    regions: []
    provinces: [Noord-Brabant]
    municipalities: []
    segments: [social, midden]
    registration: { fee_eur: 0, renewal_eur_per_year: 0, required_to_react: true, confidence: C }
    allocation_models: [inschrijfduur, loting, direct]
    interval_seconds: 60
    adapter: zig365
    research_ref: "research-note-1"
    fingerprint: null
    legal: null
    notes: null
  - slug: example-dak
    name: Example DAK
    kind: consortium
    stack: dak
    tier: B
    status: live
    urls: { home: https://portal-dak.example.nl/, listings: null, data: null, robots: null, terms: null }
    segments: [social, midden]
    registration: null
    allocation_models: [punten]
    interval_seconds: 180
    adapter: dak
    research_ref: null
    fingerprint: null
    legal: null
    notes: null
`;
  it("parses and filters pollable sources (tier B needs a recorded decision)", () => {
    const reg = parseRegistry(yaml);
    expect(reg.sources).toHaveLength(2);
    expect(pollableSources(reg).map((s) => s.slug)).toEqual(["example-portal"]);
  });
  it("rejects duplicate slugs", () => {
    expect(() =>
      parseRegistry(
        `${yaml}\n  - slug: example-portal\n    name: dup\n    kind: consortium\n    stack: zig365\n    tier: A\n    status: live\n    urls: { home: https://x.nl/, listings: null, data: null, robots: null, terms: null }\n    registration: null\n    interval_seconds: 60\n    adapter: zig365\n    research_ref: null\n    fingerprint: null\n    legal: null\n    notes: null\n`,
      ),
    ).toThrow(/Duplicate/);
  });
});
