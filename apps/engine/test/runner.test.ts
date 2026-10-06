import type { FetchPlan, SourceAdapter } from "@papa/adapters";
import type { CanonicalListing, RegistrySource } from "@papa/core";
import { listings } from "@papa/db";
import { createTestDb } from "@papa/db/test-db";
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import type { ConditionalState, Http, HttpResponse } from "../src/http";
import { clearRobotsCache, enrichOne, runSourceOnce } from "../src/runner";
import { applyListings, syncSources } from "../src/store";

/**
 * The project's source policy runs through here: what `robots.txt` disallows is not fetched,
 * not in the feed, not in pagination, not in the detail. The parser has its own tests (`robots.test.ts`);
 * this tests the *enforcement* — which is what stops the engine reading against a source's will.
 */

let host = 0;
/** Each test uses a fresh origin: the robots cache is per origin and lasts 24 h. */
function nextOrigin() {
  host++;
  return `https://source${host}.test`;
}

function makeSource(origin: string, over: Partial<RegistrySource> = {}): RegistrySource {
  return {
    slug: `source${host}`,
    name: "Test source",
    kind: "corporation",
    stack: "bespoke",
    tier: "A",
    status: "live",
    urls: { home: `${origin}/`, listings: null, data: null, robots: null, terms: null },
    regions: [],
    provinces: [],
    municipalities: [],
    segments: ["social"],
    registration: null,
    allocation_models: [],
    interval_seconds: 60,
    adapter: "fake",
    research_ref: null,
    fingerprint: null,
    legal: null,
    notes: null,
    ...over,
  };
}

function listing(slug: string, i: number, over: Partial<CanonicalListing> = {}): CanonicalListing {
  return {
    sourceSlug: slug,
    sourceListingId: `L${i}`,
    canonicalKey: `1000AA:${i}`,
    url: `https://source.test/l/${i}`,
    applyUrl: null,
    title: `Woning ${i}`,
    segment: "social",
    segmentReason: "test",
    allocationModel: "direct",
    closesAfterFirstReaction: false,
    priceNet: 700 + i,
    priceTotal: null,
    serviceCosts: null,
    address: {
      street: "Teststraat",
      houseNumber: String(i),
      houseNumberAddition: null,
      postcode: "1000AA",
      city: "Amsterdam",
      municipality: "Amsterdam",
      province: "Noord-Holland",
      country: "NL",
    },
    location: { lat: 52.37, lng: 4.9 },
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
    publishedAt: null,
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
    ...over,
  };
}

interface Reply {
  status?: number;
  text?: string;
  headers?: Record<string, string>;
}

/** Fake Http: returns whatever the route says and records every requested URL, in order. */
function makeHttp(route: (url: string, plan: FetchPlan, cond: ConditionalState) => Reply) {
  const calls: string[] = [];
  const http = {
    async get(plan: FetchPlan, cond: ConditionalState = {}): Promise<HttpResponse> {
      calls.push(plan.url);
      const r = route(plan.url, plan, cond);
      return {
        url: plan.url,
        status: r.status ?? 200,
        headers: r.headers ?? {},
        text: r.text ?? "",
        fetchedAt: new Date().toISOString(),
        durationMs: 1,
      };
    },
    async waitTurn() {},
    async close() {},
  } as unknown as Http;
  return { http, calls };
}

function makeLog() {
  const lines: Array<Record<string, unknown>> = [];
  const log = pino(
    { level: "debug" },
    { write: (s: string) => lines.push(JSON.parse(s) as Record<string, unknown>) },
  );
  return { log, lines, msgs: () => lines.map((l) => String(l.msg)) };
}

const feedAdapter = (over: Partial<SourceAdapter> = {}): SourceAdapter => ({
  id: "fake",
  plan: (s) => [{ url: `${s.urls.home}aanbod.json` }],
  parse: (s) => ({ listings: [listing(s.slug, 1), listing(s.slug, 2)], skipped: [], warnings: [] }),
  ...over,
});

beforeEach(() => clearRobotsCache());

describe("runner: robots.txt enforcement", () => {
  it("refuses the poll when robots disallows the feed path", async () => {
    const origin = nextOrigin();
    const source = makeSource(origin);
    const { http, calls } = makeHttp((url) =>
      url.endsWith("robots.txt")
        ? { text: "User-agent: *\nDisallow: /aanbod" }
        : { text: '{"never":"read"}' },
    );
    const { log } = makeLog();
    const out = await runSourceOnce(source, {
      db: null,
      http,
      adapter: feedAdapter(),
      log,
      userAgent: "PapaRentBot/0.1",
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("robots_disallow");
    expect(out.requests).toBe(0);
    expect(calls).toEqual([`${origin}/robots.txt`]);
  });

  it("honours an Allow more specific than the Disallow", async () => {
    const origin = nextOrigin();
    const source = makeSource(origin);
    const { http, calls } = makeHttp((url) =>
      url.endsWith("robots.txt")
        ? { text: "User-agent: *\nDisallow: /aanbod\nAllow: /aanbod.json" }
        : { text: "{}" },
    );
    const { log } = makeLog();
    const out = await runSourceOnce(source, {
      db: null,
      http,
      adapter: feedAdapter(),
      log,
      userAgent: "PapaRentBot/0.1",
    });
    expect(out.ok).toBe(true);
    expect(out.items).toBe(2);
    expect(calls).toContain(`${origin}/aanbod.json`);
  });

  it("a rule addressed to our own agent beats the * group", async () => {
    const origin = nextOrigin();
    const source = makeSource(origin);
    const { http } = makeHttp((url) =>
      url.endsWith("robots.txt")
        ? { text: "User-agent: *\nAllow: /\n\nUser-agent: paparentbot\nDisallow: /" }
        : { text: "{}" },
    );
    const { log } = makeLog();
    const out = await runSourceOnce(source, {
      db: null,
      http,
      adapter: feedAdapter(),
      log,
      userAgent: "PapaRentBot/0.1 (+https://example.com/bot)",
    });
    expect(out.error).toBe("robots_disallow");
  });

  it("a malformed robots.txt lets the poll through but is logged as a signal", async () => {
    // the DĀK case: the file answers "Ga weg." — not a rule, but not consent either
    const origin = nextOrigin();
    const source = makeSource(origin);
    const { http } = makeHttp((url) =>
      url.endsWith("robots.txt") ? { text: "Ga weg." } : { text: "{}" },
    );
    const { log, lines, msgs } = makeLog();
    const out = await runSourceOnce(source, {
      db: null,
      http,
      adapter: feedAdapter(),
      log,
      userAgent: "PapaRentBot/0.1",
    });
    expect(out.ok).toBe(true);
    expect(msgs().some((m) => m.includes("robots.txt malformed"))).toBe(true);
    expect(lines.some((l) => l.level === 40)).toBe(true);
  });

  it("an HTML soft-404 is not robots (not even when it contains 'Disallow: /')", async () => {
    const origin = nextOrigin();
    const source = makeSource(origin);
    const { http } = makeHttp((url) =>
      url.endsWith("robots.txt")
        ? { text: "<!DOCTYPE html><html><body>Disallow: /</body></html>" }
        : { text: "{}" },
    );
    const { log, msgs } = makeLog();
    const out = await runSourceOnce(source, {
      db: null,
      http,
      adapter: feedAdapter(),
      log,
      userAgent: "PapaRentBot/0.1",
    });
    expect(out.ok).toBe(true);
    expect(msgs().some((m) => m.includes("robots.txt malformed"))).toBe(false);
  });

  it("an unreachable robots.txt (404, network error) does not block", async () => {
    const origin = nextOrigin();
    const source = makeSource(origin);
    const { http } = makeHttp((url) => {
      if (url.endsWith("robots.txt")) throw new Error("ECONNRESET");
      return { text: "{}" };
    });
    const { log } = makeLog();
    const out = await runSourceOnce(source, {
      db: null,
      http,
      adapter: feedAdapter(),
      log,
      userAgent: "PapaRentBot/0.1",
    });
    expect(out.ok).toBe(true);
    expect(out.items).toBe(2);
  });

  it("robots is read once per origin and reused by later polls", async () => {
    const origin = nextOrigin();
    const other = nextOrigin();
    const source = makeSource(origin);
    const { http, calls } = makeHttp((url) =>
      url.endsWith("robots.txt") ? { text: "User-agent: *\nDisallow:" } : { text: "{}" },
    );
    const { log } = makeLog();
    const deps = {
      db: null,
      http,
      adapter: feedAdapter({
        // second plan on another origin (portal on its own subdomain): that origin's robots too
        plan: (s: RegistrySource) => [{ url: `${s.urls.home}aanbod.json` }, { url: `${other}/p2` }],
        parse: (s: RegistrySource) => ({
          listings: [listing(s.slug, 1)],
          skipped: [],
          warnings: [],
        }),
      }),
      log,
      userAgent: "PapaRentBot/0.1",
    };
    await runSourceOnce(source, deps);
    await runSourceOnce(source, deps);
    expect(calls.filter((u) => u === `${origin}/robots.txt`)).toHaveLength(1);
    expect(calls.filter((u) => u === `${other}/robots.txt`)).toHaveLength(1);
  });

  it("a disallowed planMore request is skipped, the others proceed", async () => {
    const origin = nextOrigin();
    const source = makeSource(origin);
    const { http, calls } = makeHttp((url) =>
      url.endsWith("robots.txt")
        ? { text: "User-agent: *\nDisallow: /*page=2*" }
        : { text: `body:${url}` },
    );
    const { log, msgs } = makeLog();
    const out = await runSourceOnce(source, {
      db: null,
      http,
      adapter: feedAdapter({
        planMore: (_s, bodies) =>
          bodies.length === 1
            ? [{ url: `${origin}/aanbod.json?page=2` }, { url: `${origin}/aanbod.json?page=3` }]
            : [],
        parse: (s, bodies) => ({
          listings: bodies.map((_b, i) => listing(s.slug, i + 1)),
          skipped: [],
          warnings: [],
        }),
      }),
      log,
      userAgent: "PapaRentBot/0.1",
    });
    expect(out.ok).toBe(true);
    expect(calls).not.toContain(`${origin}/aanbod.json?page=2`);
    expect(calls).toContain(`${origin}/aanbod.json?page=3`);
    // the disallowed body never reaches parse: 2 bodies (feed + page 3), not 3
    expect(out.items).toBe(2);
    expect(out.requests).toBe(2);
    expect(msgs().some((m) => m.includes("planMore: robots disallow"))).toBe(true);
  });

  it("planMore over the per-poll request limit is cut", async () => {
    const origin = nextOrigin();
    const source = makeSource(origin);
    const { http, calls } = makeHttp((url) =>
      url.endsWith("robots.txt") ? { text: "User-agent: *\nDisallow:" } : { text: "{}" },
    );
    const { log, msgs } = makeLog();
    const out = await runSourceOnce(source, {
      db: null,
      http,
      adapter: feedAdapter({
        planMore: (_s, bodies) =>
          bodies.length === 1
            ? Array.from({ length: 30 }, (_v, i) => ({ url: `${origin}/p${i}` }))
            : [],
        parse: (s) => ({ listings: [listing(s.slug, 1)], skipped: [], warnings: [] }),
      }),
      log,
      userAgent: "PapaRentBot/0.1",
    });
    expect(calls.filter((u) => u.includes("/p")).length).toBe(12);
    expect(out.requests).toBe(13);
    expect(msgs().some((m) => m.includes("planMore over the limit"))).toBe(true);
  });

  it("the detail also obeys robots (and is not fetched when disallowed)", async () => {
    const origin = nextOrigin();
    const source = makeSource(origin);
    const { http, calls } = makeHttp((url) =>
      url.endsWith("robots.txt")
        ? { text: "User-agent: *\nDisallow: /*?id=*" }
        : { text: '{"reactions":3}' },
    );
    const { log } = makeLog();
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      const l = listing(source.slug, 1);
      await applyListings(
        db,
        source.slug,
        [l],
        new Map(),
        new Date(Date.now() - 1000).toISOString(),
      );
      const patch = await enrichOne(
        source,
        {
          db,
          http,
          adapter: feedAdapter({
            enrich: {
              plan: (s, item) => ({ url: `${s.urls.home}detail?id=${item.sourceListingId}` }),
              parse: () => ({ patch: { reactionsCount: 3 }, warnings: [] }),
            },
          }),
          log,
          userAgent: "PapaRentBot/0.1",
        },
        { rowId: 1, listing: l },
      );
      expect(patch).toBeNull();
      expect(calls).toEqual([`${origin}/robots.txt`]);
    } finally {
      await close();
    }
  });
});

describe("runner: poll guards", () => {
  it("304 ends the poll without touching the listings", async () => {
    const origin = nextOrigin();
    const source = makeSource(origin);
    const seen: ConditionalState[] = [];
    const { http } = makeHttp((url, _plan, cond) => {
      if (url.endsWith("robots.txt")) return { text: "User-agent: *\nDisallow:" };
      seen.push(cond);
      return { status: 304, headers: { etag: '"v1"' } };
    });
    const { log } = makeLog();
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      const out = await runSourceOnce(source, {
        db,
        http,
        adapter: feedAdapter({
          plan: (s) => [{ url: `${s.urls.home}aanbod.json`, conditional: true }],
        }),
        log,
        userAgent: "PapaRentBot/0.1",
      });
      expect(out.ok).toBe(true);
      expect(out.notModified).toBe(true);
      expect(out.httpStatus).toBe(304);
      expect(seen).toHaveLength(1);
      expect(await db.select().from(listings)).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("zero listings with warnings on a source that had stock is a parse failure, not an empty poll", async () => {
    const origin = nextOrigin();
    const source = makeSource(origin);
    const { http } = makeHttp((url) =>
      url.endsWith("robots.txt")
        ? { text: "User-agent: *\nDisallow:" }
        : { text: "<html>drift</html>" },
    );
    const { log } = makeLog();
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      await applyListings(
        db,
        source.slug,
        [listing(source.slug, 1)],
        new Map(),
        new Date(Date.now() - 1000).toISOString(),
      );
      const out = await runSourceOnce(source, {
        db,
        http,
        adapter: feedAdapter({
          parse: () => ({ listings: [], skipped: [], warnings: ["campo aanbod desapareceu"] }),
        }),
        log,
        userAgent: "PapaRentBot/0.1",
      });
      expect(out.ok).toBe(false);
      expect(out.error).toContain("parse_failed");
      // nothing was removed: the poll never got to apply
      const rows = await db.select().from(listings);
      expect(rows.every((r) => r.removedAt === null)).toBe(true);
    } finally {
      await close();
    }
  });

  it("an empty feed seen once defers removal until the second empty poll", async () => {
    const origin = nextOrigin();
    const source = makeSource(origin);
    const { http } = makeHttp((url) =>
      url.endsWith("robots.txt")
        ? { text: "User-agent: *\nDisallow:" }
        : { text: `{"t":${Date.now()}}` },
    );
    const { log, msgs } = makeLog();
    const { db, close } = await createTestDb();
    try {
      await syncSources(db, [source]);
      const full = feedAdapter();
      const first = await runSourceOnce(source, {
        db,
        http,
        adapter: full,
        log,
        userAgent: "PapaRentBot/0.1",
      });
      expect(first.newItems).toBe(2);

      const empty = feedAdapter({ parse: () => ({ listings: [], skipped: [], warnings: [] }) });
      const second = await runSourceOnce(source, {
        db,
        http,
        adapter: empty,
        log,
        userAgent: "PapaRentBot/0.1",
      });
      expect(second.ok).toBe(true);
      expect(second.removedItems).toBe(0);
      expect(msgs().some((m) => m.includes("removal deferred"))).toBe(true);
      expect((await db.select().from(listings)).every((r) => r.removedAt === null)).toBe(true);

      const third = await runSourceOnce(source, {
        db,
        http,
        adapter: empty,
        log,
        userAgent: "PapaRentBot/0.1",
      });
      expect(third.removedItems).toBe(2);
      expect((await db.select().from(listings)).every((r) => r.removedAt !== null)).toBe(true);
    } finally {
      await close();
    }
  });

  /**
   * The second empty poll is, by definition, byte-for-byte equal to the first: an empty aanbod feed
   * (`{"result":[]}`) or a "geen aanbod" page does not change between polls. If the poll that defers
   * removal stored conditional state, every later one would exit via 304 (ETag) or via the
   * hash short-circuit BEFORE the removal logic — and the listings would stay active forever,
   * with the app deep-linking to homes already rented. Both paths must be tested: the
   * hash alone does not cover sources with an ETag, which exit even earlier.
   */
  describe("byte-stable empty feed: the deferred removal must really happen", () => {
    /** Adapter that really parses the body (the aanbod comes from the feed, not from a constant). */
    const bodyAdapter = (over: Partial<SourceAdapter> = {}) =>
      feedAdapter({
        plan: (s) => [{ url: `${s.urls.home}aanbod.json`, conditional: true }],
        parse: (s, bodies) => {
          const json = JSON.parse(bodies[0]?.text ?? '{"result":[]}') as {
            result: Array<{ id: string }>;
          };
          return {
            listings: json.result.map((r) => listing(s.slug, Number(r.id.slice(1)))),
            skipped: [],
            warnings: [],
          };
        },
        ...over,
      });

    const FULL = '{"result":[{"id":"L1"},{"id":"L2"}]}';
    const EMPTY = '{"result":[]}';

    it("with ETag: the next poll does not exit via 304 and confirms the removal", async () => {
      const origin = nextOrigin();
      const source = makeSource(origin);
      let body = FULL;
      const etagOf = (t: string) => `"${t.length}-${t.replace(/\W/g, "").slice(0, 8)}"`;
      const { http } = makeHttp((url, _plan, cond) => {
        if (url.endsWith("robots.txt")) return { text: "User-agent: *\nDisallow:" };
        const etag = etagOf(body);
        if (cond.etag === etag) return { status: 304, headers: { etag } };
        return { text: body, headers: { etag } };
      });
      const { log } = makeLog();
      const { db, close } = await createTestDb();
      try {
        await syncSources(db, [source]);
        const deps = { db, http, adapter: bodyAdapter(), log, userAgent: "PapaRentBot/0.1" };
        expect((await runSourceOnce(source, deps)).newItems).toBe(2);

        body = EMPTY;
        const second = await runSourceOnce(source, deps);
        expect(second.removedItems).toBe(0);

        const third = await runSourceOnce(source, deps);
        expect(third.notModified).toBe(false);
        expect(third.removedItems).toBe(2);
        expect((await db.select().from(listings)).every((r) => r.removedAt !== null)).toBe(true);
      } finally {
        await close();
      }
    });

    it("without ETag: the next poll does not exit via the body hash and confirms the removal", async () => {
      const origin = nextOrigin();
      const source = makeSource(origin);
      let body = FULL;
      const { http } = makeHttp((url) =>
        url.endsWith("robots.txt") ? { text: "User-agent: *\nDisallow:" } : { text: body },
      );
      const { log } = makeLog();
      const { db, close } = await createTestDb();
      try {
        await syncSources(db, [source]);
        const deps = { db, http, adapter: bodyAdapter(), log, userAgent: "PapaRentBot/0.1" };
        expect((await runSourceOnce(source, deps)).newItems).toBe(2);

        body = EMPTY;
        const second = await runSourceOnce(source, deps);
        expect(second.removedItems).toBe(0);

        const third = await runSourceOnce(source, deps);
        expect(third.notModified).toBe(false);
        expect(third.removedItems).toBe(2);
        expect((await db.select().from(listings)).every((r) => r.removedAt !== null)).toBe(true);

        // removal confirmed, the short-circuit applies again: the empty feed no longer costs a parse
        const fourth = await runSourceOnce(source, deps);
        expect(fourth.notModified).toBe(true);
      } finally {
        await close();
      }
    });
  });
});
