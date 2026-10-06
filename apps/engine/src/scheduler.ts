import { getAdapter, type SourceAdapter } from "@papa/adapters";
import type { RegistrySource } from "@papa/core";
import type { Logger } from "pino";
import type { BrowserFetcher } from "./browser";
import type { EngineConfig } from "./config";
import type { Geocoder } from "./geocode";
import type { Http } from "./http";
import { type EnrichItem, enrichOne, runSourceOnce } from "./runner";
import {
  type AnyDb,
  applyListingPatch,
  type GeoCandidate,
  listingsNeedingEnrich,
  listingsNeedingGeo,
} from "./store";

/** Exponential backoff ceiling: a failing source is retried at least every 15 min. */
export const MAX_BACKOFF_MS = 15 * 60 * 1000;

/**
 * Load floor of a poll (source policy): never below the registry `interval_seconds`,
 * and each request made in the poll (feed + extra pages) "costs" the per-request budget
 * — 6 pages × 60 s ⇒ the source is read again only ≥ 6 min later. It is the one thing that keeps
 * the engine a visitor rather than a crawler; it is pure and tested on purpose.
 */
export function pollBaseMs(
  intervalSeconds: number | null | undefined,
  requests: number,
  perRequestBudgetMs: number,
): number {
  const interval = (intervalSeconds ?? 300) * 1000;
  return Math.max(interval, Math.max(1, requests) * perRequestBudgetMs);
}

/**
 * Wait until the next poll. Jitter spreads sources over time but only upwards: 0.9 × base
 * would break the floor above. On failure, exponential backoff with a ceiling — and the ceiling
 * never drops below the floor (an expensive source, with 12 requests per poll, would otherwise be
 * read faster on failure than on success).
 */
export function nextPollDelayMs(base: number, failures: number, rnd: () => number = Math.random) {
  if (failures > 0) return Math.max(base, Math.min(base * 2 ** failures, MAX_BACKOFF_MS));
  return base * (1 + rnd() * 0.2);
}

/**
 * One timer per source, with up to +20% jitter and exponential backoff on failure (max 15 min).
 * Bounded concurrency. Never below the registry `interval_seconds` (source policy).
 *
 * Detection and enrichment are decoupled: the feed poll finishes as soon as the new listings
 * are stored (and the notifier can already send them); each new listing's detail is fetched
 * later, in a per-source queue with its own pause, without delaying the next poll.
 */
export class Scheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private failures = new Map<string, number>();
  private running = 0;
  private stopped = false;
  private enrichQueue = new Map<string, EnrichItem[]>();
  private enriching = new Set<string>();
  private geoQueue: GeoCandidate[] = [];
  private geocoding = false;

  constructor(
    private readonly sources: RegistrySource[],
    private readonly deps: {
      db: AnyDb;
      http: Http;
      log: Logger;
      cfg: EngineConfig;
      /** Resolves a source's adapter (injectable in tests). */
      resolveAdapter?: (id: string) => SourceAdapter;
      /** PDOK geocoder; absent = no geocoding. */
      geocoder?: Geocoder;
      /** Browser for `render` plans (Tier B). */
      browser?: BrowserFetcher;
    },
  ) {}

  private adapterFor(s: RegistrySource): SourceAdapter {
    return (this.deps.resolveAdapter ?? getAdapter)(s.adapter ?? "");
  }

  start() {
    for (const [i, s] of this.sources.entries()) {
      // stagger startup so we do not hit every source in the same second
      this.schedule(s, Math.min(i * 1500, 60_000));
    }
    this.scheduleBackfill(60_000);
    this.deps.log.info({ sources: this.sources.length }, "scheduler started");
  }

  /**
   * Periodic background work: listings without a municipality (that gained a postcode via enrich)
   * go back to the geo queue; listings still without detail (queue full on a first poll, restarts)
   * go back to the enrichment queue, a few at a time, only when the source queue is empty.
   */
  private scheduleBackfill(delayMs: number) {
    if (this.stopped) return;
    const t = setTimeout(() => {
      void (async () => {
        try {
          if (this.deps.geocoder) {
            const rows = await listingsNeedingGeo(this.deps.db, 200);
            if (rows.length) this.enqueueGeo(rows);
          }
          for (const s of this.sources) {
            if (this.stopped) break;
            if (!this.adapterFor(s).enrich) continue;
            if ((this.enrichQueue.get(s.slug)?.length ?? 0) > 0) continue;
            const items = await listingsNeedingEnrich(this.deps.db, s.slug, 50);
            if (items.length) this.enqueueEnrich(s, items);
          }
        } catch (err) {
          this.deps.log.warn({ err: String(err) }, "backfill failed");
        } finally {
          this.scheduleBackfill(this.deps.cfg.geocodeBackfillMs);
        }
      })();
    }, delayMs);
    this.timers.set("__backfill__", t);
  }

  private schedule(s: RegistrySource, delayMs: number) {
    if (this.stopped) return;
    const t = setTimeout(() => void this.tick(s), delayMs);
    this.timers.set(s.slug, t);
  }

  private async tick(s: RegistrySource) {
    if (this.stopped) return;
    if (this.running >= this.deps.cfg.concurrency) {
      this.schedule(s, 2_000);
      return;
    }
    this.running++;
    let ok = false;
    let requests = 1;
    try {
      const out = await runSourceOnce(s, {
        db: this.deps.db,
        http: this.deps.http,
        adapter: this.adapterFor(s),
        log: this.deps.log,
        userAgent: this.deps.cfg.userAgent,
        ...(this.deps.browser ? { browser: this.deps.browser } : {}),
      });
      ok = out.ok;
      requests = Math.max(1, out.requests);
      if (out.pendingEnrich.length) this.enqueueEnrich(s, out.pendingEnrich);
      if (out.pendingGeo.length && this.deps.geocoder) this.enqueueGeo(out.pendingGeo);
    } finally {
      this.running--;
    }
    // never below the registry, and each extra request (pages) pushes the next poll back
    const base = pollBaseMs(s.interval_seconds, requests, this.deps.cfg.perRequestBudgetMs);
    let failures = 0;
    if (!ok) {
      failures = (this.failures.get(s.slug) ?? 0) + 1;
      this.failures.set(s.slug, failures);
    } else this.failures.set(s.slug, 0);
    this.schedule(s, nextPollDelayMs(base, failures));
  }

  private enqueueEnrich(s: RegistrySource, items: EnrichItem[]) {
    const q = this.enrichQueue.get(s.slug) ?? [];
    q.push(...items);
    const max = this.deps.cfg.enrichQueueMax;
    if (q.length > max) {
      this.deps.log.warn(
        { source: s.slug, dropped: q.length - max },
        "enrichment queue full: oldest dropped",
      );
      q.splice(0, q.length - max);
    }
    this.enrichQueue.set(s.slug, q);
    void this.drainEnrich(s);
  }

  /** One consumer per source; never runs in parallel with itself. */
  private async drainEnrich(s: RegistrySource) {
    if (this.enriching.has(s.slug)) return;
    this.enriching.add(s.slug);
    try {
      const q = this.enrichQueue.get(s.slug);
      while (!this.stopped && q && q.length) {
        const item = q.shift();
        if (!item) break;
        const patch = await enrichOne(
          s,
          {
            db: this.deps.db,
            http: this.deps.http,
            adapter: this.adapterFor(s),
            log: this.deps.log,
            userAgent: this.deps.cfg.userAgent,
          },
          item,
        );
        // the detail brought a postcode/coordinates to a listing without a municipality: geocode now
        const pc = patch?.address?.postcode ?? item.listing.address.postcode;
        const loc = patch?.location ?? item.listing.location;
        if (
          this.deps.geocoder &&
          patch &&
          (patch.address?.postcode || patch.location) &&
          !item.listing.address.municipality
        )
          this.enqueueGeo([
            { rowId: item.rowId, postcode: pc, lat: loc?.lat ?? null, lng: loc?.lng ?? null },
          ]);
        if (q.length) await sleep(this.deps.cfg.enrichGapMs);
      }
    } finally {
      this.enriching.delete(s.slug);
    }
  }

  private enqueueGeo(items: GeoCandidate[]) {
    this.geoQueue.push(...items);
    const max = this.deps.cfg.enrichQueueMax * 4;
    if (this.geoQueue.length > max) this.geoQueue.splice(0, this.geoQueue.length - max);
    void this.drainGeo();
  }

  /** A single global consumer (PDOK is a single host). */
  private async drainGeo() {
    const geocoder = this.deps.geocoder;
    if (this.geocoding || !geocoder) return;
    this.geocoding = true;
    try {
      while (!this.stopped && this.geoQueue.length) {
        const c = this.geoQueue.shift();
        if (!c) break;
        await geocodeCandidate(this.deps.db, geocoder, c);
      }
    } finally {
      this.geocoding = false;
    }
  }

  /** For tests and metrics. */
  enrichBacklog(): number {
    let n = 0;
    for (const q of this.enrichQueue.values()) n += q.length;
    return n + this.geoQueue.length;
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.enrichQueue.clear();
  }
}

/** Resolves a listing's municipality/province (and missing coordinates) and stores it. Shared with the backfill. */
export async function geocodeCandidate(db: AnyDb, geocoder: Geocoder, c: GeoCandidate) {
  const r = await geocoder.resolve({ postcode: c.postcode, lat: c.lat, lng: c.lng });
  if (!r) return false;
  const patch: Parameters<typeof applyListingPatch>[2] = {
    municipality: r.municipality,
    province: r.province,
  };
  if (c.lat === null && r.lat !== null && r.lng !== null) {
    patch.lat = r.lat;
    patch.lng = r.lng;
  }
  await applyListingPatch(db, c.rowId, patch);
  return true;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
