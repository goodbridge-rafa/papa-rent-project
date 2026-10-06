import { describe, expect, it } from "vitest";
import { listings, sources } from "../src/schema";
import { createTestDb } from "../src/test-db";

describe("db schema", () => {
  it("applies migrations and round-trips a listing (PGlite)", async () => {
    const { db, close } = await createTestDb();
    try {
      await db.insert(sources).values({
        slug: "example-portal",
        name: "Example Portal",
        kind: "consortium",
        stack: "zig365",
        tier: "A",
        status: "live",
      });
      await db.insert(listings).values({
        sourceSlug: "example-portal",
        sourceListingId: "154356",
        canonicalKey: "5625NH-46",
        url: "https://portal-a.example.nl/x",
        title: "Garnichweg 46, Eindhoven",
        segment: "social",
        segmentReason: "price<=social_rent_cap(932.93)",
        allocationModel: "inschrijfduur",
        priceNet: 932.93,
        dwellingCategory: "apartment",
        labels: ["senioren"],
        rawHash: "abc",
      });
      const rows = await db.select().from(listings);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.priceNet).toBe(932.93);
      expect(rows[0]?.labels).toEqual(["senioren"]);
      expect(rows[0]?.serviceCosts).toBeNull();
    } finally {
      await close();
    }
  });
});
