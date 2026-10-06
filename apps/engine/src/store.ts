import type { EnrichPatch } from "@papa/adapters";
import { type CanonicalListing, canonicalKey, type RegistrySource } from "@papa/core";
import type { Db } from "@papa/db";
import { listingEvents, listings, sourceRuns, sources } from "@papa/db";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

/** Batch size when refreshing `last_seen_at` of known ids (avoids giant IN lists). */
const PRESENT_BATCH = 500;

/** Any Drizzle-Postgres instance (postgres-js in prod, PGlite in tests). */
// biome-ignore lint/suspicious/noExplicitAny: PGlite and postgres-js have different driver types but the same query API
export type AnyDb = Db | any;

export interface ApplyStats {
  items: number;
  newItems: number;
  changedItems: number;
  removedItems: number;
  /** New (or reappeared) listings in this poll, with the row id: they feed enrichment. */
  newListings: Array<{ id: number; sourceListingId: string }>;
}

function toRow(l: CanonicalListing, raw: unknown) {
  return {
    sourceSlug: l.sourceSlug,
    sourceListingId: l.sourceListingId,
    canonicalKey: l.canonicalKey,
    url: l.url,
    applyUrl: l.applyUrl,
    title: l.title,
    segment: l.segment,
    segmentReason: l.segmentReason,
    allocationModel: l.allocationModel,
    closesAfterFirstReaction: l.closesAfterFirstReaction,
    priceNet: l.priceNet,
    priceTotal: l.priceTotal,
    serviceCosts: l.serviceCosts,
    street: l.address.street,
    houseNumber: l.address.houseNumber,
    houseNumberAddition: l.address.houseNumberAddition,
    postcode: l.address.postcode,
    city: l.address.city,
    municipality: l.address.municipality,
    province: l.address.province,
    country: l.address.country,
    lat: l.location?.lat ?? null,
    lng: l.location?.lng ?? null,
    rooms: l.rooms,
    bedrooms: l.bedrooms,
    areaM2: l.areaM2,
    dwellingType: l.dwellingType,
    dwellingCategory: l.dwellingCategory,
    energyLabel: l.energyLabel,
    constructionYear: l.constructionYear,
    floor: l.floor,
    availableFrom: l.availableFrom,
    availableFromText: l.availableFromText,
    publishedAt: l.publishedAt,
    closesAt: l.closesAt,
    labels: l.labels,
    targetGroups: l.targetGroups,
    operatorCode: l.operator.code,
    operatorName: l.operator.name,
    registrationRequired: l.registrationRequired,
    huurtoeslagPossible: l.huurtoeslagPossible,
    photos: l.photos,
    thumbnail: l.thumbnail,
    isNewBuild: l.isNewBuild,
    isExchange: l.isExchange,
    notices: l.notices,
    eligibility: l.eligibility,
    reactionsCount: l.reactionsCount,
    description: l.description,
    rawHash: l.rawHash,
    raw,
  };
}

/** Ensures every registry source exists in the `sources` table (runtime state). */
export async function syncSources(db: AnyDb, regSources: RegistrySource[]) {
  for (const s of regSources) {
    await db
      .insert(sources)
      .values({
        slug: s.slug,
        name: s.name,
        kind: s.kind,
        stack: s.stack,
        tier: s.tier,
        status: s.status,
        intervalSeconds: s.interval_seconds,
      })
      .onConflictDoUpdate({
        target: sources.slug,
        set: {
          name: s.name,
          kind: s.kind,
          stack: s.stack,
          tier: s.tier,
          status: s.status,
          intervalSeconds: s.interval_seconds,
          updatedAt: sql`now()`,
        },
      });
  }
}

/**
 * Applies the result of a full poll (the source ALWAYS returns the whole aanbod):
 * new → insert + `new` event; changed (rawHash) → update + `updated`/`price_changed`;
 * gone from the feed → `removed_at` + `removed` event. Returns counts for metrics.
 */
export async function applyListings(
  db: AnyDb,
  sourceSlug: string,
  parsed: CanonicalListing[],
  rawById: Map<string, unknown>,
  runStartedAt: string,
  opts: { markRemoved?: boolean; presentIds?: string[] } = {},
): Promise<ApplyStats> {
  const stats: ApplyStats = {
    items: parsed.length,
    newItems: 0,
    changedItems: 0,
    removedItems: 0,
    newListings: [],
  };
  const existing = await db
    .select({
      id: listings.id,
      sourceListingId: listings.sourceListingId,
      rawHash: listings.rawHash,
      priceNet: listings.priceNet,
      removedAt: listings.removedAt,
    })
    .from(listings)
    .where(eq(listings.sourceSlug, sourceSlug));
  type Prev = {
    id: number;
    sourceListingId: string;
    rawHash: string;
    priceNet: number | null;
    removedAt: string | null;
  };
  const byId = new Map<string, Prev>((existing as Prev[]).map((e) => [e.sourceListingId, e]));

  for (const l of parsed) {
    const row = toRow(l, rawById.get(l.sourceListingId) ?? null);
    const prev = byId.get(l.sourceListingId);
    if (!prev) {
      const [ins] = (await db
        .insert(listings)
        .values(row)
        .returning({ id: listings.id })) as Array<{ id: number }>;
      if (!ins) throw new Error("insert returned no id");
      await db
        .insert(listingEvents)
        .values({ listingId: ins.id, type: "new", payload: { publishedAt: l.publishedAt } });
      stats.newItems++;
      stats.newListings.push({ id: ins.id, sourceListingId: l.sourceListingId });
      continue;
    }
    if (prev.removedAt) {
      // reappeared: treated as new for the user
      await db
        .update(listings)
        .set({ ...row, removedAt: null, lastSeenAt: sql`now()` })
        .where(eq(listings.id, prev.id));
      await db
        .insert(listingEvents)
        .values({ listingId: prev.id, type: "new", payload: { reappeared: true } });
      stats.newItems++;
      stats.newListings.push({ id: prev.id, sourceListingId: l.sourceListingId });
      continue;
    }
    if (prev.rawHash !== l.rawHash) {
      await db
        .update(listings)
        .set({ ...row, lastSeenAt: sql`now()` })
        .where(eq(listings.id, prev.id));
      const priceChanged = prev.priceNet !== l.priceNet;
      await db.insert(listingEvents).values({
        listingId: prev.id,
        type: priceChanged ? "price_changed" : "updated",
        payload: priceChanged ? { from: prev.priceNet, to: l.priceNet } : null,
      });
      stats.changedItems++;
    } else {
      await db.update(listings).set({ lastSeenAt: sql`now()` }).where(eq(listings.id, prev.id));
    }
  }

  if (opts.markRemoved === false) return stats; // partial poll: nothing is considered removed

  // Ids the source still publishes but that this poll did not read in full: they stay alive.
  const present = [...new Set(opts.presentIds ?? [])].filter(
    (id) => !parsed.some((l) => l.sourceListingId === id),
  );
  for (let i = 0; i < present.length; i += PRESENT_BATCH) {
    const batch = present.slice(i, i + PRESENT_BATCH);
    await db
      .update(listings)
      .set({ lastSeenAt: sql`now()` })
      .where(
        and(
          eq(listings.sourceSlug, sourceSlug),
          isNull(listings.removedAt),
          inArray(listings.sourceListingId, batch),
        ),
      );
  }

  const gone = (await db
    .update(listings)
    .set({ removedAt: sql`now()` })
    .where(
      and(
        eq(listings.sourceSlug, sourceSlug),
        isNull(listings.removedAt),
        lt(listings.lastSeenAt, runStartedAt),
      ),
    )
    .returning({ id: listings.id })) as Array<{ id: number }>;
  for (const g of gone) await db.insert(listingEvents).values({ listingId: g.id, type: "removed" });
  stats.removedItems = gone.length;
  return stats;
}

export async function recordRun(
  db: AnyDb,
  run: {
    sourceSlug: string;
    startedAt: string;
    ok: boolean;
    notModified?: boolean;
    httpStatus?: number | null;
    stats?: ApplyStats | null;
    error?: string | null;
  },
) {
  const finishedAt = new Date().toISOString();
  await db.insert(sourceRuns).values({
    sourceSlug: run.sourceSlug,
    startedAt: run.startedAt,
    finishedAt,
    ok: run.ok,
    notModified: run.notModified ?? false,
    httpStatus: run.httpStatus ?? null,
    items: run.stats?.items ?? 0,
    newItems: run.stats?.newItems ?? 0,
    changedItems: run.stats?.changedItems ?? 0,
    removedItems: run.stats?.removedItems ?? 0,
    durationMs: Date.now() - new Date(run.startedAt).getTime(),
    error: run.error ?? null,
  });
  if (run.ok) {
    await db
      .update(sources)
      .set({ lastOkAt: finishedAt, consecutiveFailures: 0, lastError: null, updatedAt: sql`now()` })
      .where(eq(sources.slug, run.sourceSlug));
  } else {
    await db
      .update(sources)
      .set({
        lastErrorAt: finishedAt,
        lastError: run.error ?? "unknown",
        consecutiveFailures: sql`${sources.consecutiveFailures} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(sources.slug, run.sourceSlug));
  }
}

export async function saveConditionalState(
  db: AnyDb,
  slug: string,
  s: { etag?: string | null; lastModified?: string | null; hash?: string | null },
) {
  await db
    .update(sources)
    .set({
      etag: s.etag ?? null,
      lastModified: s.lastModified ?? null,
      lastHash: s.hash ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(sources.slug, slug));
}

export async function loadConditionalState(db: AnyDb, slug: string) {
  const [row] = await db
    .select({
      etag: sources.etag,
      lastModified: sources.lastModified,
      lastHash: sources.lastHash,
      failures: sources.consecutiveFailures,
    })
    .from(sources)
    .where(eq(sources.slug, slug))
    .limit(1);
  return row ?? { etag: null, lastModified: null, lastHash: null, failures: 0 };
}

/**
 * Columns that take part in the radar↔listing predicate (`matchingRadarsCondition`, `radarMatchCondition`).
 * While any of these values is unfilled, the match made at detection is wrong:
 * a listing without `lat` never matches a radius radar, one without `bedrooms` never matches `minBedrooms`.
 */
const PREDICATE_COLUMNS = {
  segment: listings.segment,
  allocationModel: listings.allocationModel,
  municipality: listings.municipality,
  province: listings.province,
  lat: listings.lat,
  lng: listings.lng,
  priceNet: listings.priceNet,
  bedrooms: listings.bedrooms,
  dwellingCategory: listings.dwellingCategory,
  labels: listings.labels,
} as const;

const MATCH_STATE_COLUMNS = {
  ...PREDICATE_COLUMNS,
  removedAt: listings.removedAt,
  firstSeenAt: listings.firstSeenAt,
} as const;

type MatchState = Record<string, unknown>;

/**
 * Window in which a listing still counts as news to go back to the matcher. The normal detail arrives
 * seconds to minutes after detection (queue at ~10 s per item); the backfill, however, returns to
 * old listings still without detail — re-emitting `new` for yesterday's listing would invent news.
 */
export const REMATCH_WINDOW_MS = 60 * 60 * 1000;

async function matchState(db: AnyDb, listingId: number): Promise<MatchState | null> {
  const [row] = (await db
    .select(MATCH_STATE_COLUMNS)
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1)) as MatchState[];
  return row ?? null;
}

const predicateFingerprint = (row: MatchState) =>
  JSON.stringify(Object.keys(PREDICATE_COLUMNS).map((k) => row[k] ?? null));

/**
 * Sends the listing back to the matcher when the detail (or geocoding) changed a predicate field.
 *
 * Without this, sources that only give coordinates/bedrooms/labels in the detail (some portals
 * return `location: null` in the list) are matched with `lat`
 * NULL and no radius radar catches them: the push never goes out, although the feed shows them.
 *
 * No duplicate alerts: the unique index (user, listing, channel) on `notifications` absorbs the second
 * match — whoever was already notified gets nothing again. No invented news: only for listings
 * still active, detected less than `REMATCH_WINDOW_MS` ago, and never while the detection's `new`
 * event is still unhandled (that one will read the updated row anyway).
 *
 * Detection still does not wait for the detail (p95 ≤ 90 s): this is a second match, not a
 * postponement of the first.
 */
async function requeueForMatching(db: AnyDb, listingId: number, before: MatchState | null) {
  if (!before) return false;
  const after = await matchState(db, listingId);
  if (!after || after.removedAt) return false;
  if (predicateFingerprint(before) === predicateFingerprint(after)) return false;
  const firstSeen = Date.parse(String(after.firstSeenAt));
  if (Number.isFinite(firstSeen) && Date.now() - firstSeen > REMATCH_WINDOW_MS) return false;
  const [pending] = (await db
    .select({ id: listingEvents.id })
    .from(listingEvents)
    .where(
      and(
        eq(listingEvents.listingId, listingId),
        eq(listingEvents.type, "new"),
        isNull(listingEvents.processedAt),
      ),
    )
    .limit(1)) as Array<{ id: number }>;
  if (pending) return false;
  await db.insert(listingEvents).values({ listingId, type: "new", payload: { rematch: true } });
  return true;
}

export async function applyEnrichment(db: AnyDb, listingId: number, patch: EnrichPatch) {
  const before = await matchState(db, listingId);
  const { location, operator, address, ...flat } = patch;
  const set: Record<string, unknown> = { ...flat, enrichedAt: sql`now()` };
  if (address) {
    for (const k of [
      "street",
      "houseNumber",
      "houseNumberAddition",
      "postcode",
      "city",
      "municipality",
      "province",
    ] as const) {
      if (address[k] !== undefined) set[k] = address[k];
    }
    // the detail brought what was missing for the cross-source dedup key: recompute
    if (address.postcode || address.houseNumber) {
      const [row] = (await db
        .select({
          postcode: listings.postcode,
          houseNumber: listings.houseNumber,
          houseNumberAddition: listings.houseNumberAddition,
          sourceSlug: listings.sourceSlug,
          sourceListingId: listings.sourceListingId,
        })
        .from(listings)
        .where(eq(listings.id, listingId))
        .limit(1)) as Array<{
        postcode: string | null;
        houseNumber: string | null;
        houseNumberAddition: string | null;
        sourceSlug: string;
        sourceListingId: string;
      }>;
      if (row) {
        const key = canonicalKey({
          postcode: address.postcode ?? row.postcode,
          houseNumber: address.houseNumber ?? row.houseNumber,
          houseNumberAddition: address.houseNumberAddition ?? row.houseNumberAddition,
          fallback: `${row.sourceSlug}:${row.sourceListingId}`,
        });
        if (!key.startsWith("src:")) set.canonicalKey = key;
      }
    }
  }
  if (location !== undefined) {
    set.lat = location?.lat ?? null;
    set.lng = location?.lng ?? null;
  }
  if (operator !== undefined) {
    set.operatorCode = operator.code;
    set.operatorName = operator.name;
  }
  await db.update(listings).set(set).where(eq(listings.id, listingId));
  await requeueForMatching(db, listingId, before);
}

/** Partial patch without setting `enriched_at` (geocoding). */
export async function applyListingPatch(
  db: AnyDb,
  listingId: number,
  patch: Partial<{ municipality: string; province: string; lat: number; lng: number }>,
) {
  const before = await matchState(db, listingId);
  await db.update(listings).set(patch).where(eq(listings.id, listingId));
  // geocoding fills municipality/province/coordinates: all predicate fields
  await requeueForMatching(db, listingId, before);
}

export interface GeoCandidate {
  rowId: number;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
}

/** Active listings without a municipality but with a postcode or coordinates (backfill). */
/** Inverse of toRow: rebuilds the canonical listing from the row (for re-enrichment). */
export function rowToListing(r: typeof listings.$inferSelect): CanonicalListing {
  const toIso = (v: unknown) =>
    v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : null;
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
      country: r.country ?? "NL",
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
    publishedAt: toIso(r.publishedAt),
    closesAt: toIso(r.closesAt),
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

/** Active listings of a source still without detail (queue full on a first poll, restarts). */
export async function listingsNeedingEnrich(
  db: AnyDb,
  sourceSlug: string,
  limit = 50,
): Promise<Array<{ rowId: number; listing: CanonicalListing }>> {
  const rows = (await db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.sourceSlug, sourceSlug),
        isNull(listings.removedAt),
        isNull(listings.enrichedAt),
      ),
    )
    .orderBy(desc(listings.firstSeenAt))
    .limit(limit)) as Array<typeof listings.$inferSelect>;
  return rows.map((r) => ({ rowId: r.id, listing: rowToListing(r) }));
}

/** Items of a source's last successful, applied poll (not 304/not-modified); null if there never was one. */
export async function lastAppliedRunItems(db: AnyDb, sourceSlug: string): Promise<number | null> {
  const [row] = (await db
    .select({ items: sourceRuns.items })
    .from(sourceRuns)
    .where(
      and(
        eq(sourceRuns.sourceSlug, sourceSlug),
        eq(sourceRuns.ok, true),
        eq(sourceRuns.notModified, false),
      ),
    )
    .orderBy(desc(sourceRuns.startedAt))
    .limit(1)) as Array<{ items: number }>;
  return row ? row.items : null;
}

/** Number of active (not removed) listings of a source. */
export async function activeListingCount(db: AnyDb, sourceSlug: string): Promise<number> {
  const [row] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(listings)
    .where(and(eq(listings.sourceSlug, sourceSlug), isNull(listings.removedAt)))) as Array<{
    n: number;
  }>;
  return row?.n ?? 0;
}

export async function listingsNeedingGeo(db: AnyDb, limit = 500): Promise<GeoCandidate[]> {
  const rows = (await db
    .select({
      rowId: listings.id,
      postcode: listings.postcode,
      lat: listings.lat,
      lng: listings.lng,
    })
    .from(listings)
    .where(
      and(
        isNull(listings.removedAt),
        isNull(listings.municipality),
        sql`(${listings.postcode} is not null or ${listings.lat} is not null)`,
      ),
    )
    .limit(limit)) as GeoCandidate[];
  return rows;
}
