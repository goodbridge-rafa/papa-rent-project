import { getConnInfo } from "@hono/node-server/conninfo";
import {
  type CanonicalListing,
  DeviceInput,
  type EligibilityProfile,
  type EligibilityResult,
  evaluateEligibility,
  type MarketRule,
  ProfilePatch,
  RadarInput,
  RadarPatch,
} from "@papa/core";
import type { Db, ListingRow } from "@papa/db";
import {
  activeListingCondition,
  devices,
  listings,
  normalizeMunicipality,
  notifications,
  radarMatchCondition,
  radars,
  sourceRuns,
  sources,
  user,
} from "@papa/db";
import { and, desc, eq, gt, gte, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { type Auth, createAuth } from "./auth";

type SessionData = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
type Env = { Variables: { user: SessionData["user"]; session: SessionData["session"] } };

const ListQuery = z.object({
  segment: z.enum(["social", "midden", "free", "unknown"]).optional(),
  municipality: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  maxRent: z.coerce.number().positive().optional(),
  minRooms: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.coerce.number().int().positive().optional(),
});
const Cursor = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.coerce.number().int().positive().optional(),
});

/** Shape of a uuid (what a Postgres `uuid` column accepts), without requiring version or variant. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const publicListing = <T extends { raw?: unknown }>(row: T) => {
  const { raw: _raw, ...rest } = row;
  return rest;
};

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Sliding-window limits. Public → per IP; authenticated → per user (a mobile carrier's or an
 * office's IP is shared by many people, an account is not).
 */
export interface RateLimitOptions {
  windowMs: number;
  /** Requests per window per IP on `/v1` routes (includes authenticated ones: first line of defence). */
  publicPerWindow: number;
  /** Requests per window per authenticated user. */
  userPerWindow: number;
  /** Radar estimates per window per user: the most expensive route we serve. */
  estimatePerWindow: number;
  /**
   * `/health` probes per window per IP. Generous on purpose (monitoring and the Docker
   * healthcheck probe constantly), but no longer a route without any ceiling.
   */
  healthPerWindow: number;
  /** Ceiling on stored keys; above it the oldest are dropped (upper bound on memory). */
  maxKeys: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitOptions = {
  windowMs: 60_000,
  publicPerWindow: 120,
  userPerWindow: 240,
  estimatePerWindow: 20,
  healthPerWindow: 600,
  maxKeys: 10_000,
};

interface LimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until there is room again (sliding window: when the oldest request expires). */
  resetS: number;
}

/**
 * In-memory sliding window (a list of timestamps per key).
 *
 * LIMITATION, stated in full so nobody is misled: the state lives in this process.
 *  • It does not survive restarts: after a deploy every counter starts at zero.
 *  • It is not shared between instances: with N processes behind the same domain the effective
 *    limit is N× the configured one, and a client hopping between instances is never stopped.
 * It fits the current design (one API instance behind Caddy, `infra/docker-compose.yml`).
 * Going beyond one instance requires a shared store (Redis) or limiting in Caddy.
 * This is not protection against a distributed attack; it stops a single script from
 * crawling the public feed at network speed.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys: number,
  ) {}

  /** Records a request and says whether it passes. Consumes no quota when already blocked. */
  take(key: string, limit: number, nowMs: number): LimitDecision {
    const cutoff = nowMs - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? nowMs;
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetS: Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000)),
      };
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.evict(cutoff);
    return {
      allowed: true,
      limit,
      remaining: limit - recent.length,
      resetS: Math.ceil(this.windowMs / 1000),
    };
  }

  /** Stored keys; for diagnostics and tests only. */
  get size(): number {
    return this.hits.size;
  }

  private evict(cutoff: number): void {
    for (const [k, v] of this.hits) {
      const last = v[v.length - 1];
      if (last === undefined || last <= cutoff) this.hits.delete(k);
    }
    if (this.hits.size <= this.maxKeys) return;
    const byAge = [...this.hits.entries()].sort(
      (a, b) => (a[1][a[1].length - 1] ?? 0) - (b[1][b[1].length - 1] ?? 0),
    );
    for (const [k] of byAge.slice(0, this.hits.size - this.maxKeys)) this.hits.delete(k);
  }
}

/**
 * Client IP. Caddy appends the real IP at the END of `X-Forwarded-For`, so the last hop is the
 * one that counts: anything before it may have been forged by the client, and using it would
 * give anyone a fresh quota per request. Without a proxy in front (dev, test) it falls back to
 * the connection address; `unknown` only remains when even that is missing.
 */
function clientIp(c: Context<Env>): string {
  const hops = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const last = hops[hops.length - 1];
  if (last) return last;
  const real = c.req.header("x-real-ip");
  if (real) return real;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

function setLimitHeaders(c: Context<Env>, d: LimitDecision): void {
  c.header("RateLimit-Limit", String(d.limit));
  c.header("RateLimit-Remaining", String(d.remaining));
  c.header("RateLimit-Reset", String(d.resetS));
}

// ---------------------------------------------------------------------------
// Eligibility ("past bij jou")
// ---------------------------------------------------------------------------

/**
 * `EligibilityResult` carries `findings` (five dimensions, each with state, reason and rules).
 * That is what debugging needs and too much for the wire: the feed returns 30 listings per page.
 * The choice:
 *  • list (radar feed, combined feed): `state` + `reason`, which is all the card shows
 *    (a badge and one line of text);
 *  • detail: adds `decidedBy`, `notes`, `hints`, `rulesReadAt` and the market rules used,
 *    reduced to (key, value, unit, valid-from, source), which the "Waarom?" screen cites.
 * `findings` never leaves this file. Codes are stable; the NL/EN translation lives in the app.
 */
const fitSummary = (r: EligibilityResult) => ({ state: r.state, reason: r.reason });

const fitDetail = (r: EligibilityResult) => ({
  ...fitSummary(r),
  decidedBy: r.decidedBy,
  notes: r.notes,
  hints: r.hints,
  rulesReadAt: r.rulesReadAt,
  rules: r.rulesUsed.map((m: MarketRule) => ({
    key: m.key,
    value: m.value,
    unit: m.unit,
    validFrom: m.validFrom,
    source: m.source,
  })),
});

/** Blank profile: without data the verdict is UNKNOWN, never a guess. */
const EMPTY_PROFILE: EligibilityProfile = {
  dateOfBirth: null,
  householdSize: null,
  incomeBand: null,
  isSocialTenant: null,
  keyProfession: null,
};

/**
 * DB row → canonical listing, only for the eligibility evaluator (a pure function that needs the
 * whole canonical schema). It is the inverse of the engine's `toRow`; while it lives in both
 * places, changing a column means changing both (see `needs_outside`).
 */
function rowToCanonical(r: ListingRow): CanonicalListing {
  const iso = (v: string | null) => (v === null ? null : new Date(v).toISOString());
  return {
    sourceSlug: r.sourceSlug,
    sourceListingId: r.sourceListingId,
    canonicalKey: r.canonicalKey,
    url: r.url,
    applyUrl: r.applyUrl,
    title: r.title,
    segment: r.segment as CanonicalListing["segment"],
    segmentReason: r.segmentReason,
    allocationModel: r.allocationModel as CanonicalListing["allocationModel"],
    closesAfterFirstReaction: r.closesAfterFirstReaction,
    priceNet: r.priceNet,
    priceTotal: r.priceTotal,
    serviceCosts: r.serviceCosts,
    address: {
      street: r.street,
      houseNumber: r.houseNumber,
      houseNumberAddition: r.houseNumberAddition,
      postcode: r.postcode,
      city: r.city,
      municipality: r.municipality,
      province: r.province,
      country: r.country,
    },
    location: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
    rooms: r.rooms,
    bedrooms: r.bedrooms,
    areaM2: r.areaM2,
    dwellingType: r.dwellingType,
    dwellingCategory: r.dwellingCategory as CanonicalListing["dwellingCategory"],
    energyLabel: r.energyLabel,
    constructionYear: r.constructionYear,
    floor: r.floor,
    availableFrom: r.availableFrom,
    availableFromText: r.availableFromText,
    publishedAt: iso(r.publishedAt),
    closesAt: iso(r.closesAt),
    labels: r.labels as CanonicalListing["labels"],
    targetGroups: r.targetGroups,
    operator: { code: r.operatorCode, name: r.operatorName },
    registrationRequired: r.registrationRequired,
    huurtoeslagPossible: r.huurtoeslagPossible,
    photos: r.photos,
    thumbnail: r.thumbnail,
    isNewBuild: r.isNewBuild,
    isExchange: r.isExchange,
    notices: r.notices,
    eligibility: (r.eligibility as CanonicalListing["eligibility"]) ?? null,
    reactionsCount: r.reactionsCount,
    description: r.description,
    rawHash: r.rawHash,
  };
}

// ---------------------------------------------------------------------------
// Radar volume estimate
// ---------------------------------------------------------------------------

/** Estimate window: "≈ N woningen per week (estimate over the last 28 days)" (ux-flows §3). */
const ESTIMATE_WINDOW_DAYS = 28;
/** Below this much history there is no honest weekly rate to give. */
const ESTIMATE_MIN_OBSERVED_DAYS = 1;
/** ux-flows §3: above 100/week, warn about fatigue and suggest a daily digest. */
const ESTIMATE_BUSY_PER_WEEK = 100;
/** Radius slider steps (ux-flows §1, step 6). */
const RADIUS_STEPS_KM = [5, 10, 25, 50];
/** ux-flows §3: "+€100 rent" as a widening suggestion. */
const RENT_STEP_EUR = 100;
const DAY_MS = 86_400_000;

type MatchableRadar = Parameters<typeof radarMatchCondition>[0];

/** Wizard definition → the shape the shared matcher consumes (normalized municipalities). */
function toMatchable(r: RadarInput): MatchableRadar {
  return {
    segments: r.segments,
    areaType: r.areaType,
    municipalities: r.municipalities.map(normalizeMunicipality),
    provinces: r.provinces.map(normalizeMunicipality),
    centerLat: r.centerLat,
    centerLng: r.centerLng,
    radiusKm: r.radiusKm,
    maxRent: r.maxRent,
    minBedrooms: r.minBedrooms,
    dwellingCategories: r.dwellingCategories,
    includeLabels: r.includeLabels,
    excludeLabels: r.excludeLabels,
    allocationModels: r.allocationModels,
  };
}

type SuggestionCode = "widen_radius" | "raise_max_rent" | "add_segment" | "daily_digest";

/**
 * Widenings named by the spec (ux-flows §3), each with the exact patch the button applies.
 * The patch is the one that was measured: the number next to the button cannot come from another search.
 */
function wideningVariants(
  r: RadarInput,
): Array<{ code: SuggestionCode; patch: Partial<RadarInput> }> {
  const out: Array<{ code: SuggestionCode; patch: Partial<RadarInput> }> = [];
  if (r.areaType === "radius" && r.radiusKm !== null) {
    const next = RADIUS_STEPS_KM.find((km) => km > (r.radiusKm ?? 0));
    if (next !== undefined) out.push({ code: "widen_radius", patch: { radiusKm: next } });
  }
  if (r.maxRent !== null) {
    out.push({ code: "raise_max_rent", patch: { maxRent: r.maxRent + RENT_STEP_EUR } });
  }
  if (r.segments.length < 2)
    out.push({ code: "add_segment", patch: { segments: ["social", "midden"] } });
  return out;
}

// ---------------------------------------------------------------------------
// Source health (cheap, for `/health`)
// ---------------------------------------------------------------------------

export type SourceHealthStatus = "ok" | "idle" | "failing" | "never_ran";

/**
 * `/health` is what monitoring probes every 10 seconds: one cheap aggregate query, no
 * percentiles and no `listings` scans. It answers "is the engine collecting?" (never collected,
 * failing, or not read for too long) using only `sources` and `source_runs`.
 *
 * The more expensive question, "has this source gone silent?" (the source's own cadence, streak
 * of empty runs, sources that dried up), stays in the engine: `pnpm engine report:health`.
 * Duplicating that logic here would make the probe heavy and the two copies would drift.
 */
const HEALTH = {
  /** Consecutive failures from which a source counts as failing (same as the engine). */
  failingAfter: 3,
  /** No run for longer than this (or 3× the source interval) → `idle` (same as the engine). */
  idleAfterS: 30 * 60,
  /** Interval assumed when the registry does not set one. */
  fallbackIntervalS: 300,
};

function classifyHealth(s: {
  intervalSeconds: number | null;
  consecutiveFailures: number;
  sinceOkS: number | null;
  sinceRunS: number | null;
}): SourceHealthStatus {
  if (s.sinceRunS === null) return "never_ran";
  if (s.sinceOkS === null || s.consecutiveFailures >= HEALTH.failingAfter) return "failing";
  const idleAfter = Math.max(
    HEALTH.idleAfterS,
    3 * (s.intervalSeconds ?? HEALTH.fallbackIntervalS),
  );
  return s.sinceRunS > idleAfter ? "idle" : "ok";
}

// ---------------------------------------------------------------------------

export interface AppOptions {
  auth?: Auth;
  webOrigins?: string[];
  rateLimit?: Partial<RateLimitOptions>;
  /** Injectable clock: tests advance the limiter window without waiting for it. */
  now?: () => Date;
}

export function createApp(db: Db, opts: AppOptions = {}) {
  const auth = opts.auth ?? createAuth(db);
  const now = opts.now ?? (() => new Date());
  const rl: RateLimitOptions = { ...DEFAULT_RATE_LIMIT, ...opts.rateLimit };
  const origins =
    opts.webOrigins ??
    (process.env.WEB_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const app = new Hono<Env>();
  app.use(
    "*",
    cors({
      origin: (origin) => (origins.length === 0 || origins.includes(origin) ? origin : ""),
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "Cookie"],
    }),
  );
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  const limiter = new SlidingWindowLimiter(rl.windowMs, rl.maxKeys);
  const limit = (prefix: string, max: number, keyOf: (c: Context<Env>) => string) =>
    createMiddleware<Env>(async (c, next) => {
      const d = limiter.take(`${prefix}:${keyOf(c)}`, max, now().getTime());
      if (!d.allowed) {
        setLimitHeaders(c, d);
        c.header("Retry-After", String(d.resetS));
        return c.json({ error: "rate_limited", retryAfter: d.resetS }, 429);
      }
      await next();
      setLimitHeaders(c, d);
    });

  /**
   * Per IP across `/v1`: the only key that exists before there is a session, and what stops a
   * crawl of the public feed or hammering the login. `/health` is left out on purpose
   * (monitoring probes it constantly) and `/api/auth/*` has Better Auth's own limiter.
   */
  app.use("/v1/*", limit("ip", rl.publicPerWindow, clientIp));

  // ---------- public
  app.get("/health", limit("health", rl.healthPerWindow, clientIp), async (c) => {
    try {
      const rows = await db
        .select({
          slug: sources.slug,
          intervalSeconds: sources.intervalSeconds,
          consecutiveFailures: sources.consecutiveFailures,
          sinceOkS: sql<
            number | null
          >`round(extract(epoch from (now() - ${sources.lastOkAt})))::int`,
          // "last run" comes from `sources`, not from a `max(started_at)` over `source_runs`:
          // `recordRun` writes `last_ok_at` or `last_error_at` in the same transaction that inserts
          // the run, and `greatest` ignores the null. `source_runs` grows unpruned (tens of millions
          // of rows per year) and Postgres has no loose index scan, so the aggregate would be a
          // full scan on every probe, on a public route, in the same pool the engine uses.
          sinceRunS: sql<
            number | null
          >`round(extract(epoch from (now() - greatest(${sources.lastOkAt}, ${sources.lastErrorAt}))))::int`,
        })
        .from(sources)
        .where(eq(sources.status, "live"));
      const classified = rows.map((r) => ({ slug: r.slug, status: classifyHealth(r) }));
      const count = (s: SourceHealthStatus) => classified.filter((x) => x.status === s).length;
      const degraded = classified.filter((x) => x.status !== "ok");
      return c.json({
        // `ok` is about the API: DB reachable. A failing source does not return 503: the probe
        // would restart a healthy process and the error page would point at the wrong place.
        ok: true,
        time: now().toISOString(),
        sources: {
          status: classified.length === 0 ? "unknown" : degraded.length ? "degraded" : "ok",
          total: classified.length,
          ok: count("ok"),
          idle: count("idle"),
          failing: count("failing"),
          neverRan: count("never_ran"),
          degraded: degraded.map((x) => ({ slug: x.slug, status: x.status })),
        },
      });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 503);
    }
  });
  app.get("/v1/sources", async (c) => {
    const rows = await db
      .select({
        slug: sources.slug,
        name: sources.name,
        kind: sources.kind,
        stack: sources.stack,
        tier: sources.tier,
        status: sources.status,
        lastOkAt: sources.lastOkAt,
        lastErrorAt: sources.lastErrorAt,
        consecutiveFailures: sources.consecutiveFailures,
      })
      .from(sources)
      .orderBy(sources.slug);
    return c.json({ sources: rows });
  });
  /** Public catalogue: without a session there is no profile, so it never carries eligibility. */
  app.get("/v1/listings", async (c) => {
    const parsed = ListQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const q = parsed.data;
    const conditions = [activeListingCondition()];
    if (q.segment) conditions.push(eq(listings.segment, q.segment));
    if (q.municipality)
      conditions.push(
        eq(sql`lower(${listings.municipality})`, normalizeMunicipality(q.municipality)),
      );
    if (q.city) conditions.push(eq(sql`lower(${listings.city})`, q.city.toLowerCase()));
    if (q.maxRent !== undefined) conditions.push(lt(listings.priceNet, q.maxRent + 0.005));
    if (q.minRooms !== undefined) conditions.push(gt(listings.bedrooms, q.minRooms - 1));
    if (q.cursor !== undefined) conditions.push(lt(listings.id, q.cursor));
    const rows = await db
      .select()
      .from(listings)
      .where(and(...conditions))
      .orderBy(desc(listings.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit).map(publicListing);
    return c.json({
      listings: page,
      nextCursor: rows.length > q.limit ? (page[page.length - 1]?.id ?? null) : null,
    });
  });

  /** The user's eligibility profile; missing or incomplete ⇒ the evaluator returns UNKNOWN. */
  const loadProfile = async (userId: string): Promise<EligibilityProfile> => {
    const [p] = await db
      .select({
        dateOfBirth: user.dateOfBirth,
        householdSize: user.householdSize,
        incomeBand: user.incomeBand,
        isSocialTenant: user.isSocialTenant,
        keyProfession: user.keyProfession,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return p ?? EMPTY_PROFILE;
  };
  const evaluate = (row: ListingRow, profile: EligibilityProfile) =>
    evaluateEligibility({ listing: rowToCanonical(row), profile, at: now() });

  /**
   * Detail. With a valid session it carries the full verdict; without one `fit` is `null`. The key
   * is always present so the client never has to guess whether the field or the profile is missing.
   */
  app.get("/v1/listings/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    const [row] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!row) return c.json({ error: "not found" }, 404);
    // only worth looking up the session when the request carries credentials
    const authed = c.req.header("cookie") || c.req.header("authorization");
    const session = authed ? await auth.api.getSession({ headers: c.req.raw.headers }) : null;
    const fit = session ? fitDetail(evaluate(row, await loadProfile(session.user.id))) : null;
    return c.json({ listing: publicListing(row), fit });
  });

  // ---------- authenticated
  /**
   * Session + user for the authenticated `/v1` routes.
   *
   * `auth.ts` enables `session.cookieCache` (5 min): `getSession` then returns a signed snapshot
   * stored in the client's cookie, which knows nothing of a `PATCH /v1/me` made since or of a
   * deleted account. We re-read the user row (one primary-key read) so every route sees the
   * profile actually stored (the eligibility chips and the "complete your profile" prompt read
   * from here) and so an account that no longer exists stops getting through.
   */
  const requireUser = createMiddleware<Env>(async (c, next) => {
    const s = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!s) return c.json({ error: "unauthorized" }, 401);
    const [row] = await db.select().from(user).where(eq(user.id, s.user.id)).limit(1);
    if (!row) return c.json({ error: "unauthorized" }, 401);
    c.set("user", { ...s.user, ...row });
    c.set("session", s.session);
    await next();
  });
  const me = new Hono<Env>();
  me.use("*", requireUser);
  /** Second line, now keyed by account: the shared IP is no longer the criterion. */
  me.use(
    "*",
    limit("user", rl.userPerWindow, (c) => c.get("user").id),
  );

  /** The user comes from `requireUser`, which re-reads it from the DB: never the cookie-cache snapshot. */
  me.get("/me", async (c) => {
    const u = c.get("user");
    const [cnt] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(radars)
      .where(eq(radars.userId, u.id));
    return c.json({ user: u, radarCount: cnt?.count ?? 0, consentVersion: u.consentVersion });
  });
  me.patch("/me", async (c) => {
    const parsed = ProfilePatch.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const patch = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(patch).length)
      await db
        .update(user)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(user.id, c.get("user").id));
    const [row] = await db
      .select()
      .from(user)
      .where(eq(user.id, c.get("user").id))
      .limit(1);
    return c.json({ user: row });
  });

  me.get("/radars", async (c) => {
    const rows = await db
      .select()
      .from(radars)
      .where(eq(radars.userId, c.get("user").id))
      .orderBy(radars.createdAt);
    return c.json({ radars: rows });
  });
  me.post("/radars", async (c) => {
    const parsed = RadarInput.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const r = parsed.data;
    const [row] = await db
      .insert(radars)
      .values({
        ...r,
        userId: c.get("user").id,
        municipalities: r.municipalities.map(normalizeMunicipality),
        provinces: r.provinces.map(normalizeMunicipality),
      })
      .returning();
    return c.json({ radar: row }, 201);
  });

  /**
   * The wizard's "≈ N woningen per week" (ux-flows §3), for a radar that has not been saved yet.
   *
   * Counts with `radarMatchCondition` (the same predicate as the feed and the engine's matcher)
   * so the estimate cannot drift from what the user will actually receive. Counts listings by
   * first detection (`first_seen_at`), removed ones included: the question is how many pass by
   * per week, not how many are still open.
   *
   * The rate is measured over the history that exists, not over 28 days by decree: a source
   * enabled three days ago would give "≈ 0/week" if we always divided by 28. With no runs or less
   * than a day of history there is no rate to give and the level is `unknown`.
   */
  me.post(
    "/radars/estimate",
    limit("estimate", rl.estimatePerWindow, (c) => c.get("user").id),
    async (c) => {
      const parsed = RadarInput.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
      const at = now();
      const since = new Date(at.getTime() - ESTIMATE_WINDOW_DAYS * DAY_MS).toISOString();
      const countMatching = async (cond: SQL): Promise<number> => {
        const [row] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(listings)
          .where(and(gte(listings.firstSeenAt, since), cond));
        return row?.n ?? 0;
      };
      const [runs] = await db
        .select({
          collectingS: sql<
            number | null
          >`round(extract(epoch from (now() - min(${sourceRuns.startedAt}))))::int`,
        })
        .from(sourceRuns)
        .where(eq(sourceRuns.ok, true));
      const collectingS = runs?.collectingS ?? null;
      const observedDays =
        collectingS === null
          ? null
          : Math.min(ESTIMATE_WINDOW_DAYS, Math.round((collectingS / 86_400) * 10) / 10);
      const perWeek = (n: number): number | null =>
        observedDays === null || observedDays < ESTIMATE_MIN_OBSERVED_DAYS
          ? null
          : Math.round((n / observedDays) * 7);

      const radar = parsed.data;
      const matched = await countMatching(radarMatchCondition(toMatchable(radar)));
      const rate = perWeek(matched);
      const level =
        rate === null
          ? "unknown"
          : matched === 0
            ? "none"
            : rate > ESTIMATE_BUSY_PER_WEEK
              ? "high"
              : "normal";

      const suggestions: Array<{
        code: SuggestionCode;
        patch: Partial<RadarInput>;
        matched?: number;
        perWeek?: number | null;
      }> = [];
      if (level === "none") {
        for (const v of wideningVariants(radar)) {
          const widened = { ...radar, ...v.patch };
          const n = await countMatching(radarMatchCondition(toMatchable(widened)));
          if (n > matched) suggestions.push({ ...v, matched: n, perWeek: perWeek(n) });
        }
      } else if (level === "high") {
        // ux-flows §3: alert fatigue → daily digest instead of instant push.
        suggestions.push({
          code: "daily_digest",
          patch: { emailMode: "daily", pushEnabled: false },
        });
      }

      return c.json({
        windowDays: ESTIMATE_WINDOW_DAYS,
        /** Days of history the rate was measured over; `null` = the engine never collected. */
        observedDays,
        matched,
        perWeek: rate,
        level,
        suggestions,
      });
    },
  );

  /**
   * `radars.id` is a `uuid` column: a malformed id made Postgres fail with 22P02 and the route
   * answered 500. An id that cannot exist is "not found", like on any other route.
   */
  const radarId = (c: Context<Env>): string | null => {
    const id = c.req.param("id") ?? "";
    return UUID_RE.test(id) ? id : null;
  };

  me.get("/radars/:id", async (c) => {
    const id = radarId(c);
    if (!id) return c.json({ error: "not found" }, 404);
    const [row] = await db
      .select()
      .from(radars)
      .where(and(eq(radars.id, id), eq(radars.userId, c.get("user").id)))
      .limit(1);
    return row ? c.json({ radar: row }) : c.json({ error: "not found" }, 404);
  });
  /**
   * Partial edit. Writes ONLY the keys the client sent (`undefined` = "leave this alone", as in
   * `PATCH /v1/me`) and validates the merged result with `RadarInput`: a PATCH cannot leave the
   * radar in a state the wizard would never accept (no area, or `radius` without a centre),
   * because a radar without an area matches every listing in the country and pushes everything.
   */
  me.patch("/radars/:id", async (c) => {
    const id = radarId(c);
    if (!id) return c.json({ error: "not found" }, 404);
    const parsed = RadarPatch.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const patch = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as RadarPatch;
    const [current] = await db
      .select()
      .from(radars)
      .where(and(eq(radars.id, id), eq(radars.userId, c.get("user").id)))
      .limit(1);
    if (!current) return c.json({ error: "not found" }, 404);
    const after = RadarInput.safeParse({ ...current, ...patch });
    // Only refuse if it is this PATCH that breaks the radar: radars saved by the version that
    // reset defaults may already be invalid, and blocking them here would leave their owner
    // unable even to pause them or fix them field by field.
    if (!after.success && RadarInput.safeParse(current).success)
      return c.json({ error: after.error.flatten() }, 400);
    const set: Record<string, unknown> = { ...patch, updatedAt: sql`now()` };
    if (patch.municipalities) set.municipalities = patch.municipalities.map(normalizeMunicipality);
    if (patch.provinces) set.provinces = patch.provinces.map(normalizeMunicipality);
    const [row] = await db
      .update(radars)
      .set(set)
      .where(and(eq(radars.id, id), eq(radars.userId, c.get("user").id)))
      .returning();
    return row ? c.json({ radar: row }) : c.json({ error: "not found" }, 404);
  });
  me.delete("/radars/:id", async (c) => {
    const id = radarId(c);
    if (!id) return c.json({ error: "not found" }, 404);
    const rows = await db
      .delete(radars)
      .where(and(eq(radars.id, id), eq(radars.userId, c.get("user").id)))
      .returning({ id: radars.id });
    return rows.length ? c.body(null, 204) : c.json({ error: "not found" }, 404);
  });
  /** A radar's feed: exactly what generates alerts, newest first. */
  me.get("/radars/:id/feed", async (c) => {
    const id = radarId(c);
    if (!id) return c.json({ error: "not found" }, 404);
    const q = Cursor.safeParse(c.req.query());
    if (!q.success) return c.json({ error: q.error.flatten() }, 400);
    const [r] = await db
      .select()
      .from(radars)
      .where(and(eq(radars.id, id), eq(radars.userId, c.get("user").id)))
      .limit(1);
    if (!r) return c.json({ error: "not found" }, 404);
    const conds = [activeListingCondition(), radarMatchCondition(r)];
    if (q.data.cursor !== undefined) conds.push(lt(listings.id, q.data.cursor));
    const rows = await db
      .select()
      .from(listings)
      .where(and(...conds))
      .orderBy(desc(listings.id))
      .limit(q.data.limit + 1);
    const profile = await loadProfile(c.get("user").id);
    const page = rows
      .slice(0, q.data.limit)
      .map((row) => ({ ...publicListing(row), fit: fitSummary(evaluate(row, profile)) }));
    return c.json({
      listings: page,
      nextCursor: rows.length > q.data.limit ? (page[page.length - 1]?.id ?? null) : null,
    });
  });
  /** Combined feed of all the user's active radars. */
  me.get("/feed", async (c) => {
    const q = Cursor.safeParse(c.req.query());
    if (!q.success) return c.json({ error: q.error.flatten() }, 400);
    const mine = await db
      .select()
      .from(radars)
      .where(and(eq(radars.userId, c.get("user").id), eq(radars.active, true)));
    if (!mine.length) return c.json({ listings: [], nextCursor: null });
    const conds = [activeListingCondition(), or(...mine.map((r) => radarMatchCondition(r)))];
    if (q.data.cursor !== undefined) conds.push(lt(listings.id, q.data.cursor));
    const rows = await db
      .select()
      .from(listings)
      .where(and(...conds))
      .orderBy(desc(listings.id))
      .limit(q.data.limit + 1);
    const profile = await loadProfile(c.get("user").id);
    const page = rows
      .slice(0, q.data.limit)
      .map((row) => ({ ...publicListing(row), fit: fitSummary(evaluate(row, profile)) }));
    return c.json({
      listings: page,
      nextCursor: rows.length > q.data.limit ? (page[page.length - 1]?.id ?? null) : null,
    });
  });

  me.post("/devices", async (c) => {
    const parsed = DeviceInput.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const d = parsed.data;
    const [row] = await db
      .insert(devices)
      .values({
        userId: c.get("user").id,
        expoPushToken: d.expoPushToken,
        platform: d.platform,
        locale: d.locale ?? null,
      })
      .onConflictDoUpdate({
        target: devices.expoPushToken,
        set: {
          userId: c.get("user").id,
          platform: d.platform,
          locale: d.locale ?? null,
          lastSeenAt: sql`now()`,
          disabledAt: null,
        },
      })
      .returning();
    return c.json({ device: row }, 201);
  });
  me.delete("/devices/:token", async (c) => {
    await db
      .delete(devices)
      .where(
        and(eq(devices.expoPushToken, c.req.param("token")), eq(devices.userId, c.get("user").id)),
      );
    return c.body(null, 204);
  });

  /** Inbox: the user's alerts with the listing summary. */
  me.get("/notifications", async (c) => {
    const q = Cursor.safeParse(c.req.query());
    if (!q.success) return c.json({ error: q.error.flatten() }, 400);
    const conds = [eq(notifications.userId, c.get("user").id), eq(notifications.channel, "inbox")];
    if (q.data.cursor !== undefined) conds.push(lt(notifications.id, q.data.cursor));
    const rows = await db
      .select({
        id: notifications.id,
        radarId: notifications.radarId,
        createdAt: notifications.createdAt,
        openedAt: notifications.openedAt,
        listing: {
          id: listings.id,
          title: listings.title,
          priceNet: listings.priceNet,
          segment: listings.segment,
          allocationModel: listings.allocationModel,
          city: listings.city,
          thumbnail: listings.thumbnail,
          closesAt: listings.closesAt,
          publishedAt: listings.publishedAt,
          removedAt: listings.removedAt,
        },
      })
      .from(notifications)
      .innerJoin(listings, eq(listings.id, notifications.listingId))
      .where(and(...conds))
      .orderBy(desc(notifications.id))
      .limit(q.data.limit + 1);
    const page = rows.slice(0, q.data.limit);
    return c.json({
      notifications: page,
      nextCursor: rows.length > q.data.limit ? (page[page.length - 1]?.id ?? null) : null,
    });
  });
  me.post("/notifications/:id/open", async (c) => {
    const id = Number(c.req.param("id"));
    // `notifications.id` is `bigserial`: a `NaN` would reach Postgres and come back as 500
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    await db
      .update(notifications)
      .set({ openedAt: sql`now()` })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, c.get("user").id),
          isNull(notifications.openedAt),
        ),
      );
    return c.body(null, 204);
  });

  /** AVG (GDPR): export and deletion. Deleting the user cascades to radars, devices and notifications. */
  me.get("/account/export", async (c) => {
    const uid = c.get("user").id;
    const [u] = await db.select().from(user).where(eq(user.id, uid)).limit(1);
    const myRadars = await db.select().from(radars).where(eq(radars.userId, uid));
    const myDevices = await db
      .select({ platform: devices.platform, createdAt: devices.createdAt })
      .from(devices)
      .where(eq(devices.userId, uid));
    const myNotifications = await db
      .select({
        listingId: notifications.listingId,
        channel: notifications.channel,
        status: notifications.status,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, uid));
    return c.json({
      exportedAt: new Date().toISOString(),
      user: u,
      radars: myRadars,
      devices: myDevices,
      notifications: myNotifications,
    });
  });
  me.delete("/account", async (c) => {
    const uid = c.get("user").id;
    await db.delete(user).where(eq(user.id, uid));
    return c.body(null, 204);
  });

  app.route("/v1", me);
  return app;
}

export { inArray };
