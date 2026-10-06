import { readFileSync } from "node:fs";
import { zig365Adapter } from "@papa/adapters";
import type { RegistrySource } from "@papa/core";
import {
  listingEvents,
  listings,
  notifications,
  radars,
  sourceRuns,
  sources,
  user,
} from "@papa/db";
import { createTestDb } from "@papa/db/test-db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { matchNewEvents } from "../src/notify/matcher";
import {
  classifySource,
  DEFAULT_HEALTH_THRESHOLDS,
  type SourceHealthFacts,
  silenceBudgetS,
  sourceHealth,
} from "../src/report";
import {
  applyEnrichment,
  applyListingPatch,
  applyListings,
  recordRun,
  syncSources,
} from "../src/store";

const source: RegistrySource = {
  slug: "example-portal",
  name: "Example Portal",
  kind: "consortium",
  stack: "zig365",
  tier: "A",
  status: "live",
  urls: {
    home: "https://portal-a.example.nl/",
    listings: null,
    data: null,
    robots: null,
    terms: null,
  },
  regions: [],
  provinces: ["Noord-Brabant"],
  municipalities: [],
  segments: ["social"],
  registration: null,
  allocation_models: [],
  interval_seconds: 60,
  adapter: "zig365",
  research_ref: null,
  fingerprint: null,
  legal: null,
  notes: null,
};
const feed = () =>
  JSON.parse(
    readFileSync(
      new URL("../../../packages/adapters/fixtures/zig365/example-portal.json", import.meta.url),
      "utf8",
    ),
  );
const parse = (json: unknown) =>
  zig365Adapter.parse(
    source,
    [
      {
        url: "x",
        status: 200,
        contentType: null,
        text: JSON.stringify(json),
        fetchedAt: "2026-09-06T12:00:00Z",
      },
    ],
    new Date("2026-09-06T12:00:00Z"),
  ).listings;

describe("store lifecycle new → changed → removed → reappeared", () => {
  it("emits the right events and counts", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      const t0 = new Date(Date.now() - 1000).toISOString();
      const first = parse(feed());
      const s1 = await applyListings(db, "example-portal", first, new Map(), t0);
      expect(s1.newItems).toBe(first.length);
      expect(s1.removedItems).toBe(0);

      // price change on one item, one item disappears
      const f2 = feed();
      f2.result[0].netRent = 900;
      const dropped = f2.result.pop().id;
      await new Promise((r) => setTimeout(r, 5));
      const t1 = new Date().toISOString();
      const second = parse(f2);
      const s2 = await applyListings(db, "example-portal", second, new Map(), t1);
      expect(s2.newItems).toBe(0);
      expect(s2.changedItems).toBeGreaterThanOrEqual(1);
      expect(s2.removedItems).toBe(
        first.some((l) => l.sourceListingId === String(dropped)) ? 1 : 0,
      );

      // reappears
      await new Promise((r) => setTimeout(r, 5));
      const s3 = await applyListings(
        db,
        "example-portal",
        first,
        new Map(),
        new Date().toISOString(),
      );
      expect(s3.newItems).toBe(s2.removedItems);

      const types = (await db.select({ type: listingEvents.type }).from(listingEvents)).map(
        (e) => e.type,
      );
      expect(types.filter((t) => t === "new").length).toBe(first.length + s2.removedItems);
      expect(types).toContain("price_changed");
      if (s2.removedItems) expect(types).toContain("removed");
      const active = await db.select({ id: listings.id }).from(listings);
      expect(active).toHaveLength(first.length);

      await recordRun(db, { sourceSlug: "example-portal", startedAt: t1, ok: true, stats: s2 });
      await recordRun(db, {
        sourceSlug: "example-portal",
        startedAt: t1,
        ok: false,
        error: "http_500",
      });
      const runs = await db.select().from(sourceRuns);
      expect(runs).toHaveLength(2);
      expect(runs[1]?.error).toBe("http_500");
    } finally {
      await close();
    }
  });
});

describe("presentIds: large catalogue with the source's id index", () => {
  /**
   * The real case: a source with 1000+ listings that publishes a sitemap of everything that exists.
   * The adapter reads only the first page in depth and passes the rest as `presentIds`. Whoever is in
   * the index stays alive; whoever left the index is removed — without re-reading the whole catalogue.
   */
  it("keeps index ids alive and removes only those that left it", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      const all = parse(feed());
      expect(all.length).toBeGreaterThanOrEqual(4);
      const t0 = new Date(Date.now() - 1000).toISOString();
      await applyListings(db, "example-portal", all, new Map(), t0);

      // Next poll: only the first 2 are read in full; the index confirms all but
      // the last one, which left the source.
      const readInFull = all.slice(0, 2);
      const stillPublished = all.slice(0, -1).map((l) => l.sourceListingId);
      const goneId = all[all.length - 1]?.sourceListingId;
      await new Promise((r) => setTimeout(r, 5));
      const stats = await applyListings(
        db,
        "example-portal",
        readInFull,
        new Map(),
        new Date().toISOString(),
        { markRemoved: true, presentIds: stillPublished },
      );

      expect(stats.removedItems).toBe(1);
      const removed = await db.select().from(listings);
      const byId = new Map(removed.map((r) => [r.sourceListingId, r]));
      expect(byId.get(goneId ?? "")?.removedAt).not.toBeNull();
      for (const id of stillPublished) expect(byId.get(id)?.removedAt).toBeNull();
    } finally {
      await close();
    }
  });

  it("an empty index removes nothing (the engine treats it as absent)", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      const all = parse(feed());
      const t0 = new Date(Date.now() - 1000).toISOString();
      await applyListings(db, "example-portal", all, new Map(), t0);
      await new Promise((r) => setTimeout(r, 5));
      const stats = await applyListings(
        db,
        "example-portal",
        [],
        new Map(),
        new Date().toISOString(),
        {
          markRemoved: false,
          presentIds: [],
        },
      );
      expect(stats.removedItems).toBe(0);
      const rows = await db.select().from(listings);
      expect(rows.every((r) => r.removedAt === null)).toBe(true);
    } finally {
      await close();
    }
  });
});

/**
 * A poll returning zero listings without warnings is stored as `ok: true`, resets failures to zero
 * and updates `last_ok_at`: seen through polls, a source that dried up looks like a healthy one.
 * These tests pin the "mute" criterion — and, above all, the cases where NO alarm must be raised.
 */
describe("source health: who is mute", () => {
  const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
  const MIN = 60;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  const src = (slug: string, status = "live"): RegistrySource => ({
    ...source,
    slug,
    name: slug,
    status: status as RegistrySource["status"],
    interval_seconds: 60,
  });

  async function addRun(
    db: Awaited<ReturnType<typeof createTestDb>>["db"],
    slug: string,
    o: { at: string; ok?: boolean; items?: number; newItems?: number; notModified?: boolean },
  ) {
    await db.insert(sourceRuns).values({
      sourceSlug: slug,
      startedAt: o.at,
      finishedAt: o.at,
      ok: o.ok ?? true,
      notModified: o.notModified ?? false,
      items: o.items ?? 0,
      newItems: o.newItems ?? 0,
      durationMs: 10,
    });
    if (o.ok ?? true)
      await db
        .update(sources)
        .set({ lastOkAt: o.at, consecutiveFailures: 0 })
        .where(eq(sources.slug, slug));
  }

  async function addListing(
    db: Awaited<ReturnType<typeof createTestDb>>["db"],
    slug: string,
    id: string,
    o: { seenAt: string; removed?: boolean },
  ) {
    await db.insert(listings).values({
      sourceSlug: slug,
      sourceListingId: id,
      canonicalKey: `${slug}:${id}`,
      url: `https://${slug}.test/${id}`,
      title: `Woning ${id}`,
      segment: "social",
      segmentReason: "test",
      allocationModel: "direct",
      dwellingCategory: "apartment",
      rawHash: `h-${slug}-${id}`,
      firstSeenAt: o.seenAt,
      lastSeenAt: o.seenAt,
      removedAt: o.removed ? o.seenAt : null,
    });
  }

  /**
   * Measured cadence: `n` detections spaced `gapS` apart, the last one `silenceS` ago. Each detection
   * comes from the poll that produced it — that is how a real source behaves and where cadence comes from.
   */
  async function addCadence(
    db: Awaited<ReturnType<typeof createTestDb>>["db"],
    slug: string,
    o: { n: number; gapS: number; silenceS: number; removed?: boolean; perBatch?: number },
  ) {
    const perBatch = o.perBatch ?? 1;
    for (let i = 0; i < o.n; i++) {
      const at = ago(o.silenceS + (o.n - 1 - i) * o.gapS);
      for (let k = 0; k < perBatch; k++)
        await addListing(db, slug, `c${i}-${k}`, {
          seenAt: at,
          ...(o.removed ? { removed: true } : {}),
        });
      await addRun(db, slug, { at, items: perBatch * (i + 1), newItems: perBatch });
    }
  }

  it("tells apart a healthy source, a dried-up source, a stalled source and a stopped engine", async () => {
    const { db, close } = await createTestDb();
    try {
      const all = [
        src("healthy"),
        src("dried-up"),
        src("one-empty-run"),
        src("slow-source"),
        src("frozen"),
        src("snapshot-only"),
        src("engine-was-off"),
        src("broken"),
        src("brand-new"),
        src("paused-source", "paused"),
      ];
      await syncSources(db, all);

      // healthy: publishes every 10 min, last detection 10 min ago
      await addRun(db, "healthy", { at: ago(4 * HOUR), items: 1 });
      await addCadence(db, "healthy", { n: 10, gapS: 10 * MIN, silenceS: 10 * MIN });
      await addRun(db, "healthy", { at: ago(30), items: 10 });

      // dried up: had stock, went to zero, and a second poll confirmed it
      await addRun(db, "dried-up", { at: ago(3 * DAY), items: 3 });
      await addCadence(db, "dried-up", { n: 3, gapS: HOUR, silenceS: 2 * DAY, removed: true });
      await addRun(db, "dried-up", { at: ago(2 * MIN), items: 0 });
      await addRun(db, "dried-up", { at: ago(30), items: 0 });

      // a single empty poll is not a signal (same rule as deferred removal)
      await addRun(db, "one-empty-run", { at: ago(3 * DAY), items: 3 });
      await addCadence(db, "one-empty-run", { n: 3, gapS: HOUR, silenceS: 2 * DAY, removed: true });
      await addRun(db, "one-empty-run", { at: ago(2 * MIN), items: 3 });
      await addRun(db, "one-empty-run", { at: ago(30), items: 0 });

      // small, slow source: 3 days of nothing is normal for it, not an alarm
      await addRun(db, "slow-source", { at: ago(30 * DAY), items: 1 });
      await addCadence(db, "slow-source", { n: 3, gapS: 5 * DAY, silenceS: 3 * DAY });
      await addRun(db, "slow-source", { at: ago(30), items: 2 });

      // stalled: published every 10 min, silent for 2 days and still being read
      await addRun(db, "frozen", { at: ago(5 * DAY), items: 1 });
      await addCadence(db, "frozen", { n: 12, gapS: 10 * MIN, silenceS: 2 * DAY });
      await addRun(db, "frozen", { at: ago(30), items: 12 });

      // only the initial snapshot: without measured cadence, 2 days of silence are not enough to flag
      const t0 = ago(2 * DAY);
      await addRun(db, "snapshot-only", { at: t0, items: 12 });
      for (let i = 0; i < 12; i++) await addListing(db, "snapshot-only", `s${i}`, { seenAt: t0 });
      await addRun(db, "snapshot-only", { at: ago(30), items: 12 });

      // engine stopped: the silence is ours, not the source's
      await addRun(db, "engine-was-off", { at: ago(5 * DAY), items: 1 });
      await addCadence(db, "engine-was-off", { n: 12, gapS: 10 * MIN, silenceS: 2 * DAY });
      await addRun(db, "engine-was-off", { at: ago(3 * HOUR), items: 12 });

      // failing: the error is already recorded, it is not a mute source
      await addRun(db, "broken", { at: ago(2 * DAY), items: 5 });
      await addCadence(db, "broken", { n: 12, gapS: 10 * MIN, silenceS: 2 * DAY });
      await db.insert(sourceRuns).values({
        sourceSlug: "broken",
        startedAt: ago(30),
        finishedAt: ago(30),
        ok: false,
        notModified: false,
        items: 0,
        durationMs: 10,
        error: "http_503",
      });
      await db
        .update(sources)
        .set({ consecutiveFailures: 3, lastError: "http_503", lastErrorAt: ago(30) })
        .where(eq(sources.slug, "broken"));

      // source just added to the registry: never ran

      const report = await sourceHealth(db);
      const by = new Map(report.sources.map((s) => [s.sourceSlug, s]));
      const status = (slug: string) => by.get(slug)?.status;
      const reason = (slug: string) => by.get(slug)?.reason;

      expect(status("healthy")).toBe("ok");
      expect(status("dried-up")).toBe("empty");
      expect(reason("dried-up")).toBe("went_to_zero");
      expect(status("one-empty-run")).not.toBe("empty");
      expect(status("slow-source")).toBe("ok");
      expect(status("frozen")).toBe("stale");
      expect(reason("frozen")).toBe("no_new_listings");
      expect(status("snapshot-only")).toBe("ok");
      expect(status("engine-was-off")).toBe("idle");
      expect(reason("engine-was-off")).toBe("not_polled");
      expect(status("broken")).toBe("failing");
      expect(by.get("broken")?.lastError).toBe("http_503");
      expect(status("brand-new")).toBe("never_ran");
      // sources that are not `live` in the registry are left out of the report
      expect(by.has("paused-source")).toBe(false);

      expect(report.summary.mute.sort()).toEqual(["dried-up", "frozen"]);
      expect(report.summary.total).toBe(9);
      expect(report.summary.stale).toBe(1);
      expect(report.summary.empty).toBe(1);
      expect(report.summary.failing).toBe(1);
      expect(report.summary.idle).toBe(1);
      expect(report.summary.neverRan).toBe(1);

      // the facts the report shows must add up
      const frozen = by.get("frozen");
      expect(frozen?.activeListings).toBe(12);
      expect(frozen?.gaps).toBe(11);
      expect(frozen?.p90GapS).toBeCloseTo(10 * MIN, 0);
      expect(frozen?.silenceS ?? 0).toBeGreaterThan(2 * DAY - 60);
      expect(frozen?.silenceBudgetS).toBe(6 * HOUR);
      const dried = by.get("dried-up");
      expect(dried?.activeListings).toBe(0);
      expect(dried?.everListings).toBe(3);
      expect(dried?.emptyRuns).toBe(2);
    } finally {
      await close();
    }
  });

  it("a live source that never published anything is also mute, with a different reason", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [src("never-published")]);
      await addRun(db, "never-published", { at: ago(2 * MIN), items: 0 });
      await addRun(db, "never-published", { at: ago(30), items: 0 });
      const report = await sourceHealth(db);
      expect(report.sources[0]?.status).toBe("empty");
      expect(report.sources[0]?.reason).toBe("never_published");
      expect(report.summary.mute).toEqual(["never-published"]);
    } finally {
      await close();
    }
  });

  /**
   * How every real source publishes: a whole batch appears at once and is detected in the SAME
   * poll, with `first_seen_at` milliseconds apart. Measuring cadence between listings gives
   * p90 ≈ 0 s and the silence budget collapses to the floor — a healthy daily source would be
   * flagged mute every night. Cadence must come from the intervals between POLLS that
   * brought news.
   */
  it("a source publishing a daily batch is not flagged mute mid-day", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [src("batchy")]);
      await addRun(db, "batchy", { at: ago(12 * DAY), items: 0 });
      await addCadence(db, "batchy", { n: 10, gapS: DAY, perBatch: 12, silenceS: 8 * HOUR });
      await addRun(db, "batchy", { at: ago(30), items: 120 });
      const s = (await sourceHealth(db)).sources[0];
      expect(s?.activeListings).toBe(120);
      expect(s?.gaps).toBe(9);
      expect(s?.p90GapS ?? 0).toBeCloseTo(DAY, 0);
      expect(s?.silenceBudgetS).toBe(3 * DAY);
      expect(s?.status).toBe("ok");
    } finally {
      await close();
    }
  });

  /**
   * The reverse: a dead source whose empty feed is byte-stable applies ONE poll at zero and every
   * later one exits via 304/same-hash. If only applied polls count, the streak gets stuck at 1
   * and the source is counted as `ok` — the very question this report exists to answer.
   */
  it("a byte-stable empty feed is mute: 304 polls after an empty poll confirm it", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [src("empty-stable")]);
      await addRun(db, "empty-stable", { at: ago(60 * DAY), items: 0 });
      for (let i = 20; i >= 1; i--)
        await addRun(db, "empty-stable", { at: ago(i * 5 * MIN), notModified: true });
      await addRun(db, "empty-stable", { at: ago(30), notModified: true });
      const report = await sourceHealth(db);
      const s = report.sources[0];
      expect(s?.emptyRuns).toBeGreaterThanOrEqual(DEFAULT_HEALTH_THRESHOLDS.emptyRuns);
      expect(s?.status).toBe("empty");
      expect(s?.reason).toBe("never_published");
      expect(report.summary.mute).toEqual(["empty-stable"]);
    } finally {
      await close();
    }
  });

  it("304 polls do not count as empty polls", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [src("not-modified")]);
      await addRun(db, "not-modified", { at: ago(3 * DAY), items: 4 });
      await addCadence(db, "not-modified", { n: 4, gapS: HOUR, silenceS: 10 * MIN });
      await addRun(db, "not-modified", { at: ago(2 * MIN), items: 0, notModified: true });
      await addRun(db, "not-modified", { at: ago(30), items: 0, notModified: true });
      const report = await sourceHealth(db);
      expect(report.sources[0]?.emptyRuns).toBe(0);
      expect(report.sources[0]?.status).toBe("ok");
    } finally {
      await close();
    }
  });
});

/**
 * Listing↔radar matching happens only once, on the detection's `new` event. Sources that only give
 * coordinates (or bedrooms, or labels) in the detail — some portals return `location:
 * null` in the list — were matched with `lat` NULL, and `matchingRadarsCondition` requires `lat is not null`
 * for the radius branch: a radius radar's alert never went out. The detail (and geocoding)
 * must send the listing back to the matcher.
 */
describe("enrichment: send back to the matcher what changed in the predicate", () => {
  const bare = async (
    db: Awaited<ReturnType<typeof createTestDb>>["db"],
    over: Record<string, unknown> = {},
  ) => {
    const [ins] = await db
      .insert(listings)
      .values({
        sourceSlug: "example-portal",
        sourceListingId: `W${Math.random()}`,
        canonicalKey: "src:example-portal:W1",
        url: "https://example-portal.test/w1",
        title: "Woning zonder coördinaten",
        segment: "social",
        segmentReason: "test",
        allocationModel: "loting",
        dwellingCategory: "apartment",
        municipality: "Hoorn",
        rawHash: "h1",
        ...over,
      })
      .returning({ id: listings.id });
    return (ins as { id: number }).id;
  };
  /** What the matcher does with the detection event: matches it and marks it handled. */
  const detected = async (db: Awaited<ReturnType<typeof createTestDb>>["db"], id: number) => {
    await db
      .insert(listingEvents)
      .values({ listingId: id, type: "new", processedAt: new Date().toISOString() });
  };
  const unprocessedNew = async (db: Awaited<ReturnType<typeof createTestDb>>["db"], id: number) => {
    const rows = (await db
      .select({ id: listingEvents.id, type: listingEvents.type, at: listingEvents.processedAt })
      .from(listingEvents)
      .where(eq(listingEvents.listingId, id))) as Array<{ type: string; at: string | null }>;
    return rows.filter((r) => r.type === "new" && r.at === null);
  };

  it("a detail that brings coordinates puts the listing back in the matcher queue", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      const id = await bare(db);
      await detected(db, id);
      await applyEnrichment(db, id, { location: { lat: 52.643, lng: 5.06 }, bedrooms: 2 });
      expect(await unprocessedNew(db, id)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("geocoding that fills coordinates does the same", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      const id = await bare(db, { municipality: null, postcode: "1621AB" });
      await detected(db, id);
      await applyListingPatch(db, id, { municipality: "Hoorn", lat: 52.643, lng: 5.06 });
      expect(await unprocessedNew(db, id)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("a detail that does not touch the predicate emits no event", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      const id = await bare(db);
      await detected(db, id);
      await applyEnrichment(db, id, { reactionsCount: 7, description: "Mooi appartement" });
      expect(await unprocessedNew(db, id)).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("no duplicates: with the detection event still unhandled, the matcher will read the new row", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      const id = await bare(db);
      await db.insert(listingEvents).values({ listingId: id, type: "new" });
      await applyEnrichment(db, id, { location: { lat: 52.643, lng: 5.06 } });
      expect(await unprocessedNew(db, id)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("no invented news: an old listing (detail backfill) does not go back to the matcher", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      const id = await bare(db, {
        firstSeenAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      });
      await detected(db, id);
      await applyEnrichment(db, id, { location: { lat: 52.643, lng: 5.06 } });
      expect(await unprocessedNew(db, id)).toHaveLength(0);
    } finally {
      await close();
    }
  });

  /**
   * The user case: a 10 km radius radar around Hoorn and a listing from a source that
   * only gives coordinates in the detail. Before, the alert simply did not exist.
   */
  it("end to end: the radius radar gets the alert after the detail, and only once", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      await db.insert(user).values({
        id: "u1",
        name: "Ana",
        email: "ana@x.nl",
        dateOfBirth: new Date("1990-01-01"),
        consentVersion: "v1",
        locale: "nl",
      });
      await db.insert(radars).values({
        userId: "u1",
        name: "Hoorn 10 km",
        areaType: "radius",
        centerLat: 52.6425,
        centerLng: 5.0597,
        radiusKm: 10,
        emailMode: "off",
      });
      const id = await bare(db);
      await db.insert(listingEvents).values({ listingId: id, type: "new" });

      // as today: the list has no coordinates, no radius radar matches
      expect((await matchNewEvents(db)).notifications).toBe(0);

      await applyEnrichment(db, id, { location: { lat: 52.643, lng: 5.06 } });
      const second = await matchNewEvents(db);
      expect(second.matchedListings).toBe(1);
      expect(second.notifications).toBeGreaterThan(0);

      // a third pass duplicates nothing (and there are no more events to handle)
      const before = await db.select({ id: notifications.id }).from(notifications);
      expect((await matchNewEvents(db)).notifications).toBe(0);
      expect(await db.select({ id: notifications.id }).from(notifications)).toHaveLength(
        before.length,
      );
    } finally {
      await close();
    }
  });

  it("an already removed listing does not go back to the matcher", async () => {
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      const id = await bare(db, { removedAt: new Date().toISOString() });
      await detected(db, id);
      await applyEnrichment(db, id, { location: { lat: 52.643, lng: 5.06 } });
      expect(await unprocessedNew(db, id)).toHaveLength(0);
    } finally {
      await close();
    }
  });
});

describe("health classification (pure)", () => {
  const th = DEFAULT_HEALTH_THRESHOLDS;
  const facts = (over: Partial<SourceHealthFacts> = {}): SourceHealthFacts => ({
    sourceSlug: "x",
    name: "X",
    intervalSeconds: 60,
    activeListings: 10,
    everListings: 10,
    lastNewAt: new Date().toISOString(),
    silenceS: 60,
    sinceRunS: 30,
    lastRunAt: new Date().toISOString(),
    lastOkAt: new Date().toISOString(),
    lastError: null,
    consecutiveFailures: 0,
    emptyRuns: 0,
    gaps: 0,
    p90GapS: null,
    ...over,
  });

  it("without measured cadence, the tolerated silence is the long one", () => {
    expect(silenceBudgetS(facts({ gaps: 3, p90GapS: 60 }), th)).toBe(th.unknownCadenceSilenceS);
    expect(silenceBudgetS(facts({ gaps: 20, p90GapS: null }), th)).toBe(th.unknownCadenceSilenceS);
  });

  it("with measured cadence, it follows the source's own pace, never below the floor", () => {
    expect(silenceBudgetS(facts({ gaps: 8, p90GapS: 4 * 3600 }), th)).toBe(12 * 3600);
    // fast source: the floor protects against an alarm for a lunch break
    expect(silenceBudgetS(facts({ gaps: 50, p90GapS: 120 }), th)).toBe(th.minSilenceS);
  });

  it("the silence boundary is strict", () => {
    const f = facts({ gaps: 10, p90GapS: 4 * 3600, silenceS: 12 * 3600 });
    expect(classifySource(f, th).status).toBe("ok");
    expect(classifySource({ ...f, silenceS: 12 * 3600 + 1 }, th).status).toBe("stale");
  });

  it("failing, never ran and never succeeded come before any judgement on silence", () => {
    expect(classifySource(facts({ lastRunAt: null, lastOkAt: null }), th).status).toBe("never_ran");
    expect(classifySource(facts({ lastOkAt: null, consecutiveFailures: 1 }), th).reason).toBe(
      "never_succeeded",
    );
    expect(classifySource(facts({ consecutiveFailures: 3 }), th).status).toBe("failing");
    expect(classifySource(facts({ consecutiveFailures: 2 }), th).status).toBe("ok");
  });

  it("the inactivity limit follows the source interval", () => {
    // slow source (1 h interval): 31 min without a poll is still normal
    const slow = facts({ intervalSeconds: 3600, sinceRunS: 31 * 60 });
    expect(classifySource(slow, th).status).toBe("ok");
    expect(classifySource({ ...slow, sinceRunS: 3 * 3600 + 1 }, th).status).toBe("idle");
    // fast source: 31 min without a poll means the engine has stopped
    expect(classifySource(facts({ intervalSeconds: 60, sinceRunS: 31 * 60 }), th).status).toBe(
      "idle",
    );
  });
});
