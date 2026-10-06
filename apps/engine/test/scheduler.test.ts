import type { FetchPlan, SourceAdapter } from "@papa/adapters";
import type { CanonicalListing, RegistrySource } from "@papa/core";
import { listings } from "@papa/db";
import { createTestDb } from "@papa/db/test-db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { Geocoder } from "../src/geocode";
import type { Http } from "../src/http";
import { MAX_BACKOFF_MS, nextPollDelayMs, pollBaseMs, Scheduler } from "../src/scheduler";
import { syncSources } from "../src/store";

const source: RegistrySource = {
  slug: "fake",
  name: "Fake",
  kind: "consortium",
  stack: "bespoke",
  tier: "A",
  status: "live",
  urls: { home: "https://fake.test/", listings: null, data: null, robots: null, terms: null },
  regions: [],
  provinces: [],
  municipalities: [],
  segments: ["midden"],
  registration: null,
  allocation_models: [],
  interval_seconds: 60,
  adapter: "fake",
  research_ref: null,
  fingerprint: null,
  legal: null,
  notes: null,
};

function listing(i: number): CanonicalListing {
  return {
    sourceSlug: "fake",
    sourceListingId: `L${i}`,
    canonicalKey: `1000AA:${i}`,
    url: `https://fake.test/l/${i}`,
    applyUrl: `https://fake.test/l/${i}/reageren`,
    title: `Woning ${i}`,
    segment: "midden",
    segmentReason: "test",
    allocationModel: "direct",
    closesAfterFirstReaction: false,
    priceNet: 1000 + i,
    priceTotal: null,
    serviceCosts: null,
    address: {
      street: "Teststraat",
      houseNumber: String(i),
      houseNumberAddition: null,
      postcode: "1000AA",
      city: "Amsterdam",
      municipality: null,
      province: null,
      country: "NL",
    },
    location: null,
    rooms: null,
    bedrooms: 2,
    areaM2: null,
    dwellingType: null,
    dwellingCategory: "apartment",
    energyLabel: null,
    constructionYear: null,
    floor: null,
    availableFrom: null,
    availableFromText: null,
    publishedAt: "2026-09-06T10:00:00.000Z",
    closesAt: null,
    labels: [],
    targetGroups: [],
    operator: { code: null, name: null },
    registrationRequired: null,
    huurtoeslagPossible: null,
    photos: [],
    thumbnail: null,
    isNewBuild: false,
    isExchange: false,
    notices: [],
    eligibility: null,
    reactionsCount: null,
    description: null,
    rawHash: `h${i}`,
  };
}

describe("scheduler decouples enrichment from detection", () => {
  it("finishes the poll before any detail fetch, then enriches in the background", async () => {
    const { db, close } = await createTestDb();
    const log = pino({ level: "silent" });
    const cfg = { ...loadConfig({}), concurrency: 2, minGapPerHostMs: 0, enrichGapMs: 5 };
    const calls: string[] = [];
    const pdok = JSON.stringify({
      response: {
        docs: [
          {
            gemeentenaam: "Amsterdam",
            provincienaam: "Noord-Holland",
            centroide_ll: "POINT(4.9 52.37)",
          },
        ],
      },
    });
    const http = {
      async get(plan: FetchPlan) {
        calls.push(plan.url);
        const detail = plan.url.includes("/detail/");
        const geo = plan.url.includes("api.pdok.nl");
        return {
          url: plan.url,
          status: plan.url.endsWith("robots.txt") ? 404 : 200,
          headers: {} as Record<string, string>,
          text: geo ? pdok : detail ? JSON.stringify({ reactions: 7 }) : JSON.stringify({ n: 3 }),
          fetchedAt: new Date().toISOString(),
          durationMs: 1,
        };
      },
      async close() {},
    } as unknown as Http;
    const adapter: SourceAdapter = {
      id: "fake",
      plan: () => [{ url: "https://fake.test/feed.json" }],
      // second round discovered in the body of the first (e.g. pagination)
      planMore: (_s, bodies) =>
        bodies.length === 1 ? [{ url: "https://fake.test/feed.json?page=2" }] : [],
      parse: (_s, bodies) => ({
        listings: bodies.length === 2 ? [listing(1), listing(2), listing(3)] : [],
        skipped: [],
        warnings: bodies.length === 2 ? [] : [`expected 2 bodies, got ${bodies.length}`],
      }),
      enrich: {
        plan: (_s, l) => ({ url: `https://fake.test/detail/${l.sourceListingId}` }),
        parse: (_s, _l, body) => ({
          patch: { reactionsCount: (JSON.parse(body.text) as { reactions: number }).reactions },
          warnings: [],
        }),
      },
    };
    try {
      await syncSources(db, [source]);
      const geocoder = new Geocoder(http, log, 0);
      const sched = new Scheduler([source], {
        db,
        http,
        log,
        cfg,
        resolveAdapter: () => adapter,
        geocoder,
      });
      sched.start();
      // wait for the first poll (immediate start for source 0)
      await waitFor(() => calls.includes("https://fake.test/feed.json"));
      const feedIdx = calls.indexOf("https://fake.test/feed.json");
      const firstDetail = calls.findIndex((u) => u.includes("/detail/"));
      expect(firstDetail === -1 || firstDetail > feedIdx).toBe(true);
      // listings are already stored before any detail finishes
      await waitFor(async () => (await db.select().from(listings)).length === 3);
      // enrichment arrives later, in the background
      await waitFor(async () => {
        const rows = await db.select().from(listings).where(eq(listings.sourceSlug, "fake"));
        return rows.every((r) => r.reactionsCount === 7 && r.enrichedAt !== null);
      });
      expect(calls.filter((u) => u.includes("/detail/")).length).toBe(3);
      // background geocoding: municipality/province/coordinates filled, 1 request (cache per postcode)
      await waitFor(async () => {
        const rows = await db.select().from(listings).where(eq(listings.sourceSlug, "fake"));
        return rows.every((r) => r.municipality === "Amsterdam" && r.lat !== null);
      });
      expect(calls.filter((u) => u.includes("api.pdok.nl")).length).toBe(1);
      expect(calls.filter((u) => u.includes("feed.json?page=2")).length).toBeGreaterThan(0);
      expect(sched.enrichBacklog()).toBe(0);
      sched.stop();
    } finally {
      await close();
    }
  });
});

async function waitFor(pred: () => boolean | Promise<boolean>, ms = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timeout waiting for condition");
}

/**
 * The load floor is the project's source policy ("visitor-like load") and lived in an
 * expression with no test at all. These tests pin it: never below the registry interval, never
 * below the per-request budget, and backoff never speeds up an expensive source.
 */
describe("load budget and backoff", () => {
  it("never drops below the registry interval", () => {
    expect(pollBaseMs(60, 1, 60_000)).toBe(60_000);
    expect(pollBaseMs(300, 1, 1_000)).toBe(300_000);
    // with no declared interval, the engine default is 5 min
    expect(pollBaseMs(null, 1, 1_000)).toBe(300_000);
    expect(pollBaseMs(undefined, 1, 1_000)).toBe(300_000);
  });

  it("each request of the poll pushes the next one back", () => {
    // 6 pages × 60 s: the source is read again only 6 min later, even with interval_seconds=60
    expect(pollBaseMs(60, 6, 60_000)).toBe(360_000);
    expect(pollBaseMs(60, 12, 60_000)).toBe(720_000);
    // a poll that never got to request anything (robots_disallow) counts as one request
    expect(pollBaseMs(60, 0, 60_000)).toBe(60_000);
  });

  it("jitter spreads sources but only above the floor", () => {
    const base = 60_000;
    expect(nextPollDelayMs(base, 0, () => 0)).toBe(base);
    expect(nextPollDelayMs(base, 0, () => 1)).toBe(base * 1.2);
    for (let i = 0; i < 200; i++) {
      const d = nextPollDelayMs(base, 0);
      expect(d).toBeGreaterThanOrEqual(base);
      expect(d).toBeLessThanOrEqual(base * 1.2);
    }
  });

  it("backoff is exponential, capped and never below the floor", () => {
    const base = 60_000;
    expect(nextPollDelayMs(base, 1)).toBe(120_000);
    expect(nextPollDelayMs(base, 2)).toBe(240_000);
    expect(nextPollDelayMs(base, 3)).toBe(480_000);
    expect(nextPollDelayMs(base, 4)).toBe(MAX_BACKOFF_MS);
    expect(nextPollDelayMs(base, 99)).toBe(MAX_BACKOFF_MS);
    // expensive source (12 requests = 12 min of budget): the 15 min ceiling cannot speed it up
    const expensive = pollBaseMs(60, 12, 60_000);
    for (const n of [1, 2, 5, 40])
      expect(nextPollDelayMs(expensive, n)).toBeGreaterThanOrEqual(expensive);
  });
});

describe("the scheduler enforces the budget between polls", () => {
  const budgetSource: RegistrySource = { ...source, slug: "budget", interval_seconds: 0 };
  const BUDGET_MS = 250;

  function fakeHttp(feed: () => { status: number; text: string }) {
    const at: number[] = [];
    const http = {
      async get(plan: FetchPlan) {
        if (plan.url.endsWith("robots.txt"))
          return {
            url: plan.url,
            status: 200,
            headers: {},
            text: "User-agent: *\nDisallow:",
            fetchedAt: new Date().toISOString(),
            durationMs: 1,
          };
        at.push(Date.now());
        const r = feed();
        return {
          url: plan.url,
          status: r.status,
          headers: {},
          text: r.text,
          fetchedAt: new Date().toISOString(),
          durationMs: 1,
        };
      },
      async waitTurn() {},
      async close() {},
    } as unknown as Http;
    return { http, at };
  }

  const adapter = (): SourceAdapter => ({
    id: "fake",
    plan: () => [{ url: "https://budget.test/feed.json" }],
    parse: () => ({ listings: [listing(1)], skipped: [], warnings: [] }),
  });

  it("waits the per-request budget between two polls of the same source", async () => {
    const { db, close } = await createTestDb();
    const { http, at } = fakeHttp(() => ({ status: 200, text: `{"t":${Date.now()}}` }));
    const cfg = {
      ...loadConfig({}),
      concurrency: 1,
      minGapPerHostMs: 0,
      perRequestBudgetMs: BUDGET_MS,
    };
    const sched = new Scheduler([budgetSource], {
      db,
      http,
      log: pino({ level: "silent" }),
      cfg,
      resolveAdapter: () => adapter(),
    });
    try {
      await syncSources(db, [budgetSource]);
      sched.start();
      await waitFor(() => at.length >= 2);
      expect((at[1] as number) - (at[0] as number)).toBeGreaterThanOrEqual(BUDGET_MS - 10);
    } finally {
      sched.stop();
      await close();
    }
  });

  it("a failed poll pushes the next one further away (backoff), never closer", async () => {
    const { db, close } = await createTestDb();
    const { http, at } = fakeHttp(() => ({ status: 500, text: "" }));
    const cfg = {
      ...loadConfig({}),
      concurrency: 1,
      minGapPerHostMs: 0,
      perRequestBudgetMs: BUDGET_MS,
    };
    const sched = new Scheduler([budgetSource], {
      db,
      http,
      log: pino({ level: "silent" }),
      cfg,
      resolveAdapter: () => adapter(),
    });
    try {
      await syncSources(db, [budgetSource]);
      sched.start();
      await waitFor(() => at.length >= 3);
      // 1st failure → 2× the floor; 2nd failure → 4×
      expect((at[1] as number) - (at[0] as number)).toBeGreaterThanOrEqual(BUDGET_MS * 2 - 10);
      expect((at[2] as number) - (at[1] as number)).toBeGreaterThanOrEqual(BUDGET_MS * 4 - 10);
    } finally {
      sched.stop();
      await close();
    }
  });
});
