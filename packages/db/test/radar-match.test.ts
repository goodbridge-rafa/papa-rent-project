import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listings, radars, sources, user } from "../src/index";
import { activeListingCondition, radarMatchCondition } from "../src/queries/radar-match";
import { createTestDb } from "../src/test-db";

describe("radar match", () => {
  it("matches by segment, municipality, rent, bedrooms, labels and radius", async () => {
    const { db, close } = await createTestDb();
    try {
      await db.insert(sources).values({
        slug: "s",
        name: "S",
        kind: "consortium",
        stack: "zig365",
        tier: "A",
        status: "live",
      });
      await db.insert(user).values({
        id: "u1",
        name: "Ana",
        email: "a@x.nl",
        dateOfBirth: new Date("1990-01-01"),
        consentVersion: "v1",
      });
      const base = {
        sourceSlug: "s",
        url: "https://x/1",
        segmentReason: "t",
        rawHash: "h",
        dwellingCategory: "apartment",
        allocationModel: "loting",
      };
      await db.insert(listings).values([
        {
          ...base,
          sourceListingId: "1",
          canonicalKey: "k1",
          title: "A",
          segment: "social",
          priceNet: 700,
          bedrooms: 2,
          municipality: "Eindhoven",
          lat: 51.44,
          lng: 5.47,
          labels: ["senioren"],
        },
        {
          ...base,
          sourceListingId: "2",
          canonicalKey: "k2",
          title: "B",
          segment: "midden",
          priceNet: 1100,
          bedrooms: 3,
          municipality: "Eindhoven",
          lat: 51.44,
          lng: 5.47,
          labels: [],
        },
        {
          ...base,
          sourceListingId: "3",
          canonicalKey: "k3",
          title: "C",
          segment: "social",
          priceNet: 650,
          bedrooms: 1,
          municipality: "Helmond",
          lat: 51.48,
          lng: 5.66,
          labels: [],
        },
        {
          ...base,
          sourceListingId: "4",
          canonicalKey: "k4",
          title: "D",
          segment: "social",
          priceNet: 600,
          bedrooms: 2,
          municipality: "Groningen",
          lat: 53.22,
          lng: 6.57,
          labels: [],
          removedAt: new Date().toISOString(),
        },
      ]);
      const [r1] = await db
        .insert(radars)
        .values({
          userId: "u1",
          name: "Eindhoven sociaal",
          segments: ["social"],
          municipalities: ["eindhoven", "helmond"],
          maxRent: 720,
          minBedrooms: 2,
          excludeLabels: ["senioren"],
        })
        .returning();
      const [r2] = await db
        .insert(radars)
        .values({
          userId: "u1",
          name: "Rondom",
          areaType: "radius",
          centerLat: 51.44,
          centerLng: 5.47,
          radiusKm: 5,
          segments: ["social", "midden"],
        })
        .returning();
      if (!r1 || !r2) throw new Error("no radar");
      const titles = async (r: typeof r1) =>
        (
          await db
            .select({ t: listings.title })
            .from(listings)
            .where(and(activeListingCondition(), radarMatchCondition(r)))
        )
          .map((x) => x.t)
          .sort();
      expect(await titles(r1)).toEqual([]); // A excluded by label, B is midden, C has 1 bedroom
      expect(await titles({ ...r1, excludeLabels: [] })).toEqual(["A"]);
      expect(await titles({ ...r1, excludeLabels: [], minBedrooms: null })).toEqual(["A", "C"]);
      expect(await titles(r2)).toEqual(["A", "B"]); // Helmond is ~13 km away; D removed
    } finally {
      await close();
    }
  });
});

describe("matchingRadarsCondition mirrors radarMatchCondition", () => {
  it("agrees on every (radar, listing) pair", async () => {
    const { db, close } = await createTestDb();
    try {
      const { matchingRadarsCondition } = await import("../src/queries/radar-match");
      await db.insert(sources).values({
        slug: "s",
        name: "S",
        kind: "consortium",
        stack: "zig365",
        tier: "A",
        status: "live",
      });
      await db.insert(user).values({
        id: "u1",
        name: "Ana",
        email: "a@x.nl",
        dateOfBirth: new Date("1990-01-01"),
        consentVersion: "v1",
      });
      const base = { sourceSlug: "s", url: "https://x/1", segmentReason: "t", rawHash: "h" };
      const rows = await db
        .insert(listings)
        .values([
          {
            ...base,
            sourceListingId: "1",
            canonicalKey: "k1",
            title: "A",
            segment: "social",
            priceNet: 700,
            bedrooms: 2,
            municipality: "Eindhoven",
            province: "Noord-Brabant",
            lat: 51.44,
            lng: 5.47,
            labels: ["senioren"],
            dwellingCategory: "apartment",
            allocationModel: "loting",
          },
          {
            ...base,
            sourceListingId: "2",
            canonicalKey: "k2",
            title: "B",
            segment: "midden",
            priceNet: 1100,
            bedrooms: 3,
            municipality: "Eindhoven",
            province: "Noord-Brabant",
            lat: 51.44,
            lng: 5.47,
            labels: [],
            dwellingCategory: "house",
            allocationModel: "direct",
          },
          {
            ...base,
            sourceListingId: "3",
            canonicalKey: "k3",
            title: "C",
            segment: "social",
            priceNet: 650,
            bedrooms: 1,
            municipality: "Helmond",
            province: "Noord-Brabant",
            lat: 51.48,
            lng: 5.66,
            labels: ["nultreden"],
            dwellingCategory: "apartment",
            allocationModel: "inschrijfduur",
          },
          {
            ...base,
            sourceListingId: "5",
            canonicalKey: "k5",
            title: "E",
            segment: "social",
            priceNet: 500,
            bedrooms: null,
            municipality: null,
            province: null,
            lat: null,
            lng: null,
            labels: [],
            dwellingCategory: "other",
            allocationModel: "unknown",
          },
        ])
        .returning();
      const radarRows = await db
        .insert(radars)
        .values([
          {
            userId: "u1",
            name: "1",
            segments: ["social"],
            municipalities: ["eindhoven", "helmond"],
            maxRent: 720,
            minBedrooms: 2,
            excludeLabels: ["senioren"],
          },
          {
            userId: "u1",
            name: "2",
            areaType: "radius",
            centerLat: 51.44,
            centerLng: 5.47,
            radiusKm: 5,
            segments: ["social", "midden"],
          },
          {
            userId: "u1",
            name: "3",
            areaType: "all",
            segments: ["social", "midden"],
            includeLabels: ["nultreden", "senioren"],
          },
          {
            userId: "u1",
            name: "4",
            provinces: ["noord-brabant"],
            segments: ["midden"],
            dwellingCategories: ["house"],
            allocationModels: ["direct"],
          },
          { userId: "u1", name: "5", areaType: "all", segments: ["social"], active: false },
          // Radars in a degenerate state: area declared but not filled in. They must match ZERO on
          // both sides (see `hasUsableArea` in radar-match.ts) — an unfinished radar is not nationwide.
          {
            userId: "u1",
            name: "6-muni-empty",
            areaType: "municipalities",
            municipalities: [],
            provinces: [],
            segments: ["social"],
          },
          {
            userId: "u1",
            name: "7-radius-no-centre",
            areaType: "radius",
            centerLat: null,
            centerLng: null,
            radiusKm: null,
            segments: ["social"],
          },
          {
            userId: "u1",
            name: "8-radius-no-km",
            areaType: "radius",
            centerLat: 51.44,
            centerLng: 5.47,
            radiusKm: null,
            segments: ["social"],
          },
          {
            userId: "u1",
            name: "9-radius-no-lng",
            areaType: "radius",
            centerLat: 51.44,
            centerLng: null,
            radiusKm: 5,
            segments: ["social"],
          },
          // `area_type` is free text in the table: a value outside the enum must not become a nationwide radar.
          {
            userId: "u1",
            name: "10-unknown-areatype",
            areaType: "gemeente",
            municipalities: ["eindhoven"],
            segments: ["social"],
          },
        ])
        .returning();
      const degenerate = new Set([
        "6-muni-empty",
        "7-radius-no-centre",
        "8-radius-no-km",
        "9-radius-no-lng",
        "10-unknown-areatype",
      ]);
      // Collect everything before comparing: the output then shows ALL diverging radars instead
      // of aborting on the first.
      const feedSide: Record<string, number[]> = {};
      const matcherSide: Record<string, number[]> = {};
      const expected: Record<string, number[]> = {};
      for (const r of radarRows) {
        const viaFeed = (
          await db.select({ id: listings.id }).from(listings).where(radarMatchCondition(r))
        )
          .map((x) => x.id)
          .sort();
        const viaMatcher: number[] = [];
        for (const l of rows) {
          const hit = await db
            .select({ id: radars.id })
            .from(radars)
            .where(and(eq(radars.id, r.id), matchingRadarsCondition(l)));
          if (hit.length) viaMatcher.push(l.id);
        }
        feedSide[r.name] = viaFeed;
        matcherSide[r.name] = viaMatcher.sort();
        // Parity alone would be satisfied if both sides matched the whole country: for the
        // degenerate radars the chosen meaning (zero) is pinned here.
        expected[r.name] = degenerate.has(r.name) ? [] : viaFeed;
      }
      expect(feedSide).toEqual(expected);
      // `matchingRadarsCondition` also filters `active = true`; radar "5" is inactive.
      expect(matcherSide).toEqual(
        Object.fromEntries(radarRows.map((r) => [r.name, r.active ? expected[r.name] : []])),
      );
    } finally {
      await close();
    }
  });
});
