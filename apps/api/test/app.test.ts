import { listings, sourceRuns, sources } from "@papa/db";
import { createTestDb, type TestDb } from "@papa/db/test-db";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { type Auth, CONSENT_VERSION, createAuth } from "../src/auth";

// biome-ignore lint/suspicious/noExplicitAny: test JSON responses
const json = async (r: Response): Promise<any> => r.json();

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type ListingOverrides = Partial<typeof listings.$inferInsert>;

function listingValues(i: number, over: ListingOverrides = {}): typeof listings.$inferInsert {
  return {
    sourceSlug: "example-portal",
    sourceListingId: String(i),
    canonicalKey: `k${i}`,
    url: `https://www.portal-a.example.nl/${i}`,
    title: `Woning ${i}`,
    segment: i === 3 ? "midden" : "social",
    segmentReason: "test",
    allocationModel: "loting",
    priceNet: 700 + i,
    bedrooms: i,
    municipality: "Eindhoven",
    dwellingCategory: "apartment",
    rawHash: `h${i}`,
    ...over,
  };
}

async function seed(db: TestDb) {
  await db.insert(sources).values({
    slug: "example-portal",
    name: "Example Portal",
    kind: "consortium",
    stack: "zig365",
    tier: "A",
    status: "live",
  });
  for (let i = 1; i <= 3; i++) await db.insert(listings).values(listingValues(i));
}

/** Successful run recorded `msAgo` ago: what gives the estimate its history and `/health` its health. */
async function addRun(db: TestDb, msAgo: number, ok = true) {
  await db.insert(sourceRuns).values({
    sourceSlug: "example-portal",
    startedAt: ago(msAgo),
    finishedAt: ago(msAgo - 1000),
    ok,
    items: 3,
    durationMs: 1000,
  });
  if (ok) await db.update(sources).set({ lastOkAt: ago(msAgo), consecutiveFailures: 0 });
}

/**
 * Creates an account and returns the session headers.
 *
 * Keeps ALL cookies (not just the first): Better Auth also sets `session_data`, the signed session
 * snapshot the cookie cache uses. A real client sends it (the browser with
 * `credentials: "include"`, native with `authClient.getCookie()`) and it is exactly with it that a
 * session read stops touching the DB. Keeping only the token would hide that path.
 */
async function signUp(auth: Auth, email: string) {
  const res = await auth.api.signUpEmail({
    returnHeaders: true,
    body: {
      name: "Ana",
      email,
      password: "geheim-wachtwoord",
      dateOfBirth: new Date("1994-05-01"),
      consentVersion: CONSENT_VERSION,
      locale: "nl",
    } as never,
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
  return { Cookie: cookie, "Content-Type": "application/json" };
}

describe("api", () => {
  it("public endpoints: health, sources, paginated listings", async () => {
    const { db, close } = await createTestDb();
    try {
      await seed(db);
      const app = createApp(db as never);
      const health = await app.request("/health");
      expect(health.status).toBe(200);
      const body = await json(health);
      expect(body.ok).toBe(true);
      // the source is in the registry but the engine never collected it
      expect(body.sources).toMatchObject({ status: "degraded", total: 1, neverRan: 1, ok: 0 });
      expect(body.sources.degraded).toEqual([{ slug: "example-portal", status: "never_ran" }]);

      expect((await json(await app.request("/v1/sources"))).sources[0].slug).toBe("example-portal");
      const all = await json(await app.request("/v1/listings?limit=2"));
      expect(all.listings.map((l: { id: number }) => l.id)).toEqual([3, 2]);
      expect(all.nextCursor).toBe(2);
      // public route: without a session there is no profile, so never a verdict
      expect(all.listings.every((l: Record<string, unknown>) => !("fit" in l))).toBe(true);
      expect(
        (await json(await app.request(`/v1/listings?limit=2&cursor=2`))).listings.map(
          (l: { id: number }) => l.id,
        ),
      ).toEqual([1]);
      expect((await app.request("/v1/listings?limit=0")).status).toBe(400);
      expect((await app.request("/v1/listings/999")).status).toBe(404);
      expect((await json(await app.request("/v1/listings/1"))).fit).toBeNull();
      expect((await app.request("/v1/me")).status).toBe(401);
    } finally {
      await close();
    }
  });

  it("auth flow: sign up, session, radars, feed, devices, export, delete", async () => {
    const { db, close } = await createTestDb();
    try {
      await seed(db);
      const auth = createAuth(db, { NODE_ENV: "development" });
      const app = createApp(db as never, { auth });
      const h = await signUp(auth, "ana@example.com");
      expect(h.Cookie).toContain("better-auth");
      const me = await json(await app.request("/v1/me", { headers: h }));
      expect(me.user.email).toBe("ana@example.com");
      expect(me.user.consentVersion).toBe(CONSENT_VERSION);

      const bad = await app.request("/v1/radars", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ name: "x", municipalities: [] }),
      });
      expect(bad.status).toBe(400);
      const created = await json(
        await app.request("/v1/radars", {
          method: "POST",
          headers: h,
          body: JSON.stringify({
            name: "Eindhoven",
            segments: ["social"],
            municipalities: ["Eindhoven"],
            maxRent: 702,
          }),
        }),
      );
      expect(created.radar.municipalities).toEqual(["eindhoven"]);
      const feed = await json(
        await app.request(`/v1/radars/${created.radar.id}/feed`, { headers: h }),
      );
      expect(feed.listings.map((l: { id: number }) => l.id)).toEqual([2, 1]);
      const combined = await json(await app.request("/v1/feed", { headers: h }));
      expect(combined.listings).toHaveLength(2);
      const patched = await json(
        await app.request(`/v1/radars/${created.radar.id}`, {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({ maxRent: 701 }),
        }),
      );
      expect(patched.radar.maxRent).toBe(701);
      expect(
        (await json(await app.request(`/v1/radars/${created.radar.id}/feed`, { headers: h })))
          .listings,
      ).toHaveLength(1);

      const dev = await app.request("/v1/devices", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ expoPushToken: "ExponentPushToken[abc123]", platform: "ios" }),
      });
      expect(dev.status).toBe(201);
      const profile = await json(
        await app.request("/v1/me", {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({ householdSize: 2, incomeBand: "lt_daeb" }),
        }),
      );
      expect(profile.user.householdSize).toBe(2);
      const exp = await json(await app.request("/v1/account/export", { headers: h }));
      expect(exp.radars).toHaveLength(1);
      expect(exp.devices).toHaveLength(1);

      expect((await app.request("/v1/account", { method: "DELETE", headers: h })).status).toBe(204);
      expect((await app.request("/v1/me", { headers: h })).status).toBe(401);
    } finally {
      await close();
    }
  });

  it("rate limit: per IP on public routes, reset at the end of the window", async () => {
    const { db, close } = await createTestDb();
    try {
      await seed(db);
      let clock = new Date("2026-09-15T12:00:00Z");
      const app = createApp(db as never, {
        now: () => clock,
        rateLimit: { windowMs: 60_000, publicPerWindow: 2 },
      });
      const from = (ip: string) => ({ headers: { "X-Forwarded-For": ip } });

      const first = await app.request("/v1/listings", from("1.1.1.1"));
      expect(first.status).toBe(200);
      expect(first.headers.get("RateLimit-Limit")).toBe("2");
      expect(first.headers.get("RateLimit-Remaining")).toBe("1");
      expect((await app.request("/v1/listings", from("1.1.1.1"))).status).toBe(200);

      const blocked = await app.request("/v1/listings", from("1.1.1.1"));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("60");
      expect(blocked.headers.get("RateLimit-Remaining")).toBe("0");
      expect((await json(blocked)).error).toBe("rate_limited");
      // blocks the rest of `/v1`, including the detail and the sources
      expect((await app.request("/v1/sources", from("1.1.1.1"))).status).toBe(429);
      expect((await app.request("/v1/listings/1", from("1.1.1.1"))).status).toBe(429);

      // another IP has its own budget
      expect((await app.request("/v1/listings", from("2.2.2.2"))).status).toBe(200);

      // the last X-Forwarded-For hop is the one Caddy wrote; whatever the client forges before it does not count
      expect(
        (await app.request("/v1/listings", { headers: { "X-Forwarded-For": "9.9.9.9, 1.1.1.1" } }))
          .status,
      ).toBe(429);

      // `/health` is left out: monitoring probes it constantly
      for (let i = 0; i < 5; i++) expect((await app.request("/health")).status).toBe(200);

      // sliding window: once the minute has passed, the budget comes back
      clock = new Date(clock.getTime() + 61_000);
      expect((await app.request("/v1/listings", from("1.1.1.1"))).status).toBe(200);
    } finally {
      await close();
    }
  });

  it("rate limit: per user on authenticated routes, regardless of IP", async () => {
    const { db, close } = await createTestDb();
    try {
      await seed(db);
      const auth = createAuth(db, { NODE_ENV: "development" });
      const clock = new Date("2026-09-15T12:00:00Z");
      const app = createApp(db as never, {
        auth,
        now: () => clock,
        rateLimit: { windowMs: 60_000, publicPerWindow: 1000, userPerWindow: 2 },
      });
      const ana = await signUp(auth, "ana@example.com");
      const bram = await signUp(auth, "bram@example.com");
      const from = (h: Record<string, string>, ip: string) => ({
        headers: { ...h, "X-Forwarded-For": ip },
      });

      expect((await app.request("/v1/me", from(ana, "1.1.1.1"))).status).toBe(200);
      expect((await app.request("/v1/me", from(ana, "1.1.1.1"))).status).toBe(200);
      // switching IP gives no new budget: the key is the account
      const blocked = await app.request("/v1/me", from(ana, "5.5.5.5"));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("60");
      // another account, from the same IP, is not affected
      expect((await app.request("/v1/me", from(bram, "1.1.1.1"))).status).toBe(200);
      // without a session it is still 401 (the per-user limit only exists once there is a user)
      expect(
        (await app.request("/v1/me", { headers: { "X-Forwarded-For": "1.1.1.1" } })).status,
      ).toBe(401);
    } finally {
      await close();
    }
  });

  it("eligibility: shows up in the authenticated feed, never in the public list", async () => {
    const { db, close } = await createTestDb();
    try {
      await seed(db);
      // social listing that requires a one-person household: a hard condition of the listing itself
      await db.insert(listings).values(
        listingValues(4, {
          priceNet: 650,
          eligibility: {
            minIncome: null,
            maxIncome: null,
            minAge: null,
            maxAge: null,
            minHousehold: null,
            maxHousehold: 1,
            localBindingPriority: null,
          },
        }),
      );
      const auth = createAuth(db, { NODE_ENV: "development" });
      // fixed clock: market thresholds are read (and freshness measured) at this date
      const app = createApp(db as never, { auth, now: () => new Date("2026-09-15T12:00:00Z") });
      const h = await signUp(auth, "ana@example.com");
      await app.request("/v1/radars", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ name: "Alles", segments: ["social", "midden"], areaType: "all" }),
      });

      // profile not filled in yet: UNKNOWN, never a guess
      const blind = await json(await app.request("/v1/feed", { headers: h }));
      expect(blind.listings).toHaveLength(4);
      expect(blind.listings.map((l: { fit: { state: string } }) => l.fit.state)).toEqual([
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
      ]);
      expect(blind.listings[0].fit.reason).toBe("income_band_missing");

      await app.request("/v1/me", {
        method: "PATCH",
        headers: h,
        body: JSON.stringify({ householdSize: 2, incomeBand: "lt_daeb" }),
      });
      const feed = await json(await app.request("/v1/feed", { headers: h }));
      const byId = new Map<number, { state: string; reason: string }>(
        feed.listings.map((l: { id: number; fit: { state: string; reason: string } }) => [
          l.id,
          l.fit,
        ]),
      );
      // social + DAEB band: fits
      expect(byId.get(1)).toEqual({ state: "FIT", reason: "all_conditions_match" });
      // middenhuur with a social income: income is the only soft "no"
      expect(byId.get(3)).toEqual({ state: "UNLIKELY", reason: "income_band_below_segment" });
      // the listing's hard condition (household) fails even with the right income
      expect(byId.get(4)).toEqual({ state: "NO_FIT", reason: "household_above_listing_max" });
      // the list summary really is just the badge and the reason
      expect(Object.keys(feed.listings[0].fit).sort()).toEqual(["reason", "state"]);

      // a specific radar's feed carries the same verdict
      const radars = await json(await app.request("/v1/radars", { headers: h }));
      const own = await json(
        await app.request(`/v1/radars/${radars.radars[0].id}/feed`, { headers: h }),
      );
      expect(own.listings.find((l: { id: number }) => l.id === 1).fit.state).toBe("FIT");

      // authenticated detail: adds what the "Waarom?" screen needs to cite
      const detail = await json(await app.request("/v1/listings/1", { headers: h }));
      expect(detail.fit.state).toBe("FIT");
      expect(detail.fit.decidedBy).toBeNull();
      expect(detail.fit.rulesReadAt).toBe("2026-09-15");
      expect(detail.fit.rules.map((r: { key: string }) => r.key)).toContain("daeb_income_single");
      expect(detail.fit.rules[0]).toHaveProperty("source");
      // `findings` is for debugging, not for the wire
      expect(detail.fit).not.toHaveProperty("findings");

      // without a session: neither in the list nor in the detail
      const anon = await json(await app.request("/v1/listings"));
      expect(anon.listings.every((l: Record<string, unknown>) => !("fit" in l))).toBe(true);
      expect((await json(await app.request("/v1/listings/1"))).fit).toBeNull();
    } finally {
      await close();
    }
  });

  it("radar estimate: agrees with real matching, suggests widening when it yields zero", async () => {
    const { db, close } = await createTestDb();
    try {
      await seed(db);
      await addRun(db, 7 * DAY);
      const auth = createAuth(db, { NODE_ENV: "development" });
      const app = createApp(db as never, { auth });
      const h = await signUp(auth, "ana@example.com");
      const definition = {
        name: "Eindhoven",
        segments: ["social"],
        areaType: "municipalities",
        municipalities: ["Eindhoven"],
        maxRent: 702,
      };
      const estimate = await json(
        await app.request("/v1/radars/estimate", {
          method: "POST",
          headers: h,
          body: JSON.stringify(definition),
        }),
      );
      expect(estimate).toMatchObject({
        windowDays: 28,
        observedDays: 7,
        matched: 2,
        perWeek: 2,
        level: "normal",
        suggestions: [],
      });

      // the number must equal the feed's: it is the same matching predicate
      const created = await json(
        await app.request("/v1/radars", {
          method: "POST",
          headers: h,
          body: JSON.stringify(definition),
        }),
      );
      const feed = await json(
        await app.request(`/v1/radars/${created.radar.id}/feed`, { headers: h }),
      );
      expect(feed.listings).toHaveLength(estimate.matched);

      // zero: suggest the widening the spec names, measured with the same matching
      const empty = await json(
        await app.request("/v1/radars/estimate", {
          method: "POST",
          headers: h,
          body: JSON.stringify({ ...definition, maxRent: 650 }),
        }),
      );
      expect(empty).toMatchObject({ matched: 0, perWeek: 0, level: "none" });
      expect(empty.suggestions).toEqual([
        // the measured widening keeps the rest of the radar: still only `social`, so 2 and not 3
        { code: "raise_max_rent", patch: { maxRent: 750 }, matched: 2, perWeek: 2 },
      ]);

      // a radar outside the area has no useful widening: we do not invent suggestions
      const elsewhere = await json(
        await app.request("/v1/radars/estimate", {
          method: "POST",
          headers: h,
          body: JSON.stringify({ ...definition, municipalities: ["Rotterdam"], maxRent: null }),
        }),
      );
      expect(elsewhere).toMatchObject({ matched: 0, level: "none", suggestions: [] });

      expect(
        (
          await app.request("/v1/radars/estimate", {
            method: "POST",
            headers: h,
            body: JSON.stringify({ ...definition, municipalities: [] }),
          })
        ).status,
      ).toBe(400);
      expect((await app.request("/v1/radars/estimate", { method: "POST" })).status).toBe(401);
    } finally {
      await close();
    }
  });

  it("radar estimate: excessive volume warns, no history means no invented rate", async () => {
    const { db, close } = await createTestDb();
    try {
      await seed(db);
      const auth = createAuth(db, { NODE_ENV: "development" });
      const app = createApp(db as never, { auth });
      const h = await signUp(auth, "ana@example.com");
      const body = JSON.stringify({
        name: "Alles",
        segments: ["social", "midden"],
        areaType: "all",
      });
      const ask = async () =>
        json(await app.request("/v1/radars/estimate", { method: "POST", headers: h, body }));

      // the engine never collected: no basis for a weekly rate
      expect(await ask()).toMatchObject({
        observedDays: null,
        perWeek: null,
        level: "unknown",
        suggestions: [],
      });

      await addRun(db, DAY);
      for (let i = 10; i < 30; i++) await db.insert(listings).values(listingValues(i));
      const busy = await ask();
      expect(busy.matched).toBe(23);
      expect(busy.observedDays).toBe(1);
      expect(busy.perWeek).toBe(161);
      expect(busy.level).toBe("high");
      expect(busy.suggestions).toEqual([
        { code: "daily_digest", patch: { emailMode: "daily", pushEnabled: false } },
      ]);
    } finally {
      await close();
    }
  });

  it("/health: changes state when the engine stops collecting the source", async () => {
    const { db, close } = await createTestDb();
    try {
      await seed(db);
      const app = createApp(db as never);
      const health = async () => (await json(await app.request("/health"))).sources;

      await addRun(db, 60_000);
      expect(await health()).toMatchObject({ status: "ok", total: 1, ok: 1, degraded: [] });

      // last run three hours ago: the engine is not reading this source
      await db.update(sourceRuns).set({ startedAt: ago(3 * HOUR) });
      await db.update(sources).set({ lastOkAt: ago(3 * HOUR) });
      expect(await health()).toMatchObject({
        status: "degraded",
        idle: 1,
        degraded: [{ slug: "example-portal", status: "idle" }],
      });

      // collecting again, but failing repeatedly
      await db.update(sourceRuns).set({ startedAt: ago(60_000) });
      await db.update(sources).set({ consecutiveFailures: 3 });
      expect(await health()).toMatchObject({
        status: "degraded",
        failing: 1,
        degraded: [{ slug: "example-portal", status: "failing" }],
      });

      // sources that are off (`status` != live) are not judged: the engine is not supposed to read them
      await db.update(sources).set({ status: "paused" });
      expect(await health()).toMatchObject({ status: "unknown", total: 0, degraded: [] });
      expect((await json(await app.request("/health"))).ok).toBe(true);
    } finally {
      await close();
    }
  });
  it("PATCH /v1/radars/:id only touches what the client sent", async () => {
    const { db, close } = await createTestDb();
    try {
      await seed(db);
      const auth = createAuth(db, { NODE_ENV: "development" });
      const app = createApp(db as never, { auth });
      const h = await signUp(auth, "ana@example.com");
      const created = await json(
        await app.request("/v1/radars", {
          method: "POST",
          headers: h,
          body: JSON.stringify({
            name: "Eindhoven sociaal",
            segments: ["social"],
            areaType: "municipalities",
            municipalities: ["Eindhoven"],
            maxRent: 702,
            quietStart: "23:00",
            quietEnd: "07:00",
          }),
        }),
      );
      const id = created.radar.id as string;
      const feedSize = async () =>
        (await json(await app.request(`/v1/radars/${id}/feed`, { headers: h }))).listings.length;
      expect(await feedSize()).toBe(2);

      // the app's pause switch sends exactly this, and nothing else
      const paused = await json(
        await app.request(`/v1/radars/${id}`, {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({ active: false }),
        }),
      );
      expect(paused.radar).toMatchObject({
        active: false,
        segments: ["social"],
        municipalities: ["eindhoven"],
        maxRent: 702,
        quietStart: "23:00",
        quietEnd: "07:00",
      });
      const resumed = await json(
        await app.request(`/v1/radars/${id}`, {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({ active: true }),
        }),
      );
      expect(resumed.radar).toMatchObject({
        active: true,
        segments: ["social"],
        municipalities: ["eindhoven"],
        maxRent: 702,
      });
      // the radar is still the same: a radar without an area would match the whole country
      expect(await feedSize()).toBe(2);

      // a partial edit cannot leave the radar in a state the wizard would never accept
      const halfRadius = await app.request(`/v1/radars/${id}`, {
        method: "PATCH",
        headers: h,
        body: JSON.stringify({ areaType: "radius" }),
      });
      expect(halfRadius.status).toBe(400);
      expect(
        (await json(await app.request(`/v1/radars/${id}`, { headers: h }))).radar.areaType,
      ).toBe("municipalities");

      // what the client sends is still saved (and normalized)
      const moved = await json(
        await app.request(`/v1/radars/${id}`, {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({ municipalities: ["Rotterdam"], maxRent: 900 }),
        }),
      );
      expect(moved.radar.municipalities).toEqual(["rotterdam"]);
      expect(moved.radar.maxRent).toBe(900);
      expect(moved.radar.segments).toEqual(["social"]);
    } finally {
      await close();
    }
  });

  it("GET /v1/me reads the profile from the DB, not the session snapshot", async () => {
    const { db, close } = await createTestDb();
    try {
      await seed(db);
      const auth = createAuth(db, { NODE_ENV: "development" });
      const app = createApp(db as never, { auth });
      const h = await signUp(auth, "ana@example.com");
      expect(
        (await json(await app.request("/v1/me", { headers: h }))).user.householdSize,
      ).toBeNull();

      await app.request("/v1/me", {
        method: "PATCH",
        headers: h,
        body: JSON.stringify({ householdSize: 3, incomeBand: "lt_daeb" }),
      });
      // the profile screen chips and the "complete your profile" card read from here
      const me = await json(await app.request("/v1/me", { headers: h }));
      expect(me.user.householdSize).toBe(3);
      expect(me.user.incomeBand).toBe("lt_daeb");
      expect(me.user.email).toBe("ana@example.com");
      expect(me.consentVersion).toBe(CONSENT_VERSION);
    } finally {
      await close();
    }
  });

  it("/health: does not depend on source_runs and has its own limit", async () => {
    const { db, close } = await createTestDb();
    try {
      await seed(db);
      const app = createApp(db as never, { rateLimit: { windowMs: 60_000, healthPerWindow: 1 } });
      // source collected a minute ago, but with no stored run history (retention pruning):
      // the probe answers from `sources`, not from an aggregate over the runs table
      await db.update(sources).set({ lastOkAt: ago(60_000), consecutiveFailures: 0 });
      expect((await json(await app.request("/health"))).sources).toMatchObject({
        status: "ok",
        total: 1,
        ok: 1,
        degraded: [],
      });

      // still outside the `/v1` limit, but no longer a request without any ceiling
      const blocked = await app.request("/health");
      expect(blocked.status).toBe(429);
      expect((await json(blocked)).error).toBe("rate_limited");
    } finally {
      await close();
    }
  });

  it("invalid path parameters: 404/400, never 500", async () => {
    const { db, close } = await createTestDb();
    try {
      await seed(db);
      const auth = createAuth(db, { NODE_ENV: "development" });
      const app = createApp(db as never, { auth });
      const h = await signUp(auth, "ana@example.com");
      const status = (r: Response) => r.status;
      expect(status(await app.request("/v1/radars/not-a-uuid", { headers: h }))).toBe(404);
      expect(status(await app.request("/v1/radars/not-a-uuid/feed", { headers: h }))).toBe(404);
      expect(
        status(await app.request("/v1/radars/not-a-uuid", { method: "DELETE", headers: h })),
      ).toBe(404);
      expect(
        status(
          await app.request("/v1/radars/not-a-uuid", {
            method: "PATCH",
            headers: h,
            body: JSON.stringify({ active: false }),
          }),
        ),
      ).toBe(404);
      expect(
        status(await app.request("/v1/notifications/abc/open", { method: "POST", headers: h })),
      ).toBe(400);
      // a well-formed id that is not the user's is still 404
      expect(
        status(
          await app.request("/v1/radars/00000000-0000-4000-8000-000000000000", { headers: h }),
        ),
      ).toBe(404);
    } finally {
      await close();
    }
  });
});
