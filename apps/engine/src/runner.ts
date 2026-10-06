import { createHash } from "node:crypto";
import type { EnrichPatch, FetchedBody, SourceAdapter } from "@papa/adapters";
import type { CanonicalListing, RegistrySource } from "@papa/core";
import type { Logger } from "pino";
import type { BrowserFetcher } from "./browser";
import type { Http } from "./http";
import { isAllowed, parseRobots } from "./robots";
import {
  type AnyDb,
  activeListingCount,
  applyEnrichment,
  applyListings,
  type GeoCandidate,
  lastAppliedRunItems,
  loadConditionalState,
  recordRun,
  saveConditionalState,
} from "./store";

export interface RunOutcome {
  ok: boolean;
  notModified: boolean;
  httpStatus: number | null;
  items: number;
  newItems: number;
  changedItems: number;
  removedItems: number;
  warnings: string[];
  error: string | null;
  durationMs: number;
  /** HTTP requests made in this poll (feed + extra pages), so the scheduler can pace the load. */
  requests: number;
  /** The poll did not see the whole aanbod: nothing was marked as removed. */
  partial: boolean;
  /**
   * New listings whose detail has not been fetched yet. Detection never waits for enrichment:
   * the scheduler processes this queue in the background (see `enrichOne`).
   */
  pendingEnrich: EnrichItem[];
  /** New listings without municipality/province (or coordinates) that the geocoder resolves in the background. */
  pendingGeo: GeoCandidate[];
}

export interface EnrichItem {
  rowId: number;
  listing: CanonicalListing;
}

const robotsCache = new Map<string, { at: number; rules: ReturnType<typeof parseRobots> }>();
/** Maximum extra requests per poll coming from `planMore` (visitor-like load). */
const MAX_FOLLOWUP_PLANS = 12;
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

/** Clears the robots.txt cache. Tests only: each case needs clean origins. */
export function clearRobotsCache() {
  robotsCache.clear();
}

export async function checkRobots(
  http: Http,
  url: string,
  userAgent: string,
): Promise<{ allowed: boolean; malformed: boolean }> {
  const u = new URL(url);
  const key = u.origin;
  let entry = robotsCache.get(key);
  if (!entry || Date.now() - entry.at > ROBOTS_TTL_MS) {
    let text = "";
    try {
      const res = await http.get({ url: `${key}/robots.txt` });
      // an HTML soft-404 is not robots; any other 200 body is parsed (TYPO3 serves robots as text/html)
      const looksHtml = /<(!doctype|html|head|body)\b/i.test(res.text.slice(0, 800));
      text = res.status === 200 && !looksHtml ? res.text : "";
    } catch {
      text = "";
    }
    entry = { at: Date.now(), rules: parseRobots(text, userAgent) };
    robotsCache.set(key, entry);
  }
  return {
    allowed: isAllowed(entry.rules, u.pathname + u.search),
    malformed: entry.rules.malformed,
  };
}

export interface RunDeps {
  db: AnyDb | null;
  http: Http;
  /** Browser for `render` plans; absent = sources that need it fail with `browser_unavailable`. */
  browser?: BrowserFetcher;
  adapter: SourceAdapter;
  log: Logger;
  userAgent: string;
  /**
   * Inline enrichment (detail of new listings) up to this maximum, only for `once --db`.
   * Default 0: the poll returns `pendingEnrich` and the scheduler enriches off the critical path.
   */
  enrichMaxPerRun?: number;
}

/** Fetches the detail of ONE new listing and applies the patch. Respects the `Http` host policy. */
export async function enrichOne(
  source: RegistrySource,
  deps: Pick<RunDeps, "db" | "http" | "adapter" | "log" | "userAgent">,
  item: EnrichItem,
): Promise<EnrichPatch | null> {
  if (!deps.adapter.enrich || !deps.db) return null;
  try {
    const plan = deps.adapter.enrich.plan(source, item.listing);
    // the source policy also covers the detail (e.g. a robots rule blocking /*?id=*)
    const robots = await checkRobots(deps.http, plan.url, deps.userAgent);
    if (!robots.allowed) {
      deps.log.debug({ source: source.slug, url: plan.url }, "enrich: robots disallow");
      return null;
    }
    const res = await deps.http.get(plan);
    if (res.status !== 200) return null;
    const e = deps.adapter.enrich.parse(source, item.listing, {
      url: res.url,
      status: res.status,
      contentType: res.headers["content-type"] ?? null,
      text: res.text,
      fetchedAt: res.fetchedAt,
    });
    for (const w of e.warnings)
      deps.log.warn({ source: source.slug, warning: w }, "enrich warning");
    await applyEnrichment(deps.db, item.rowId, e.patch);
    return e.patch;
  } catch (err) {
    deps.log.warn({ source: source.slug, err: String(err) }, "enrich failed");
    return null;
  }
}

/** A full poll of one source. Without a DB (`db: null`) it is a dry run returning what it found. */
export async function runSourceOnce(
  source: RegistrySource,
  deps: RunDeps,
): Promise<RunOutcome & { listings?: import("@papa/core").CanonicalListing[] }> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const log = deps.log.child({ source: source.slug });
  const base: RunOutcome = {
    ok: false,
    notModified: false,
    httpStatus: null,
    items: 0,
    newItems: 0,
    changedItems: 0,
    removedItems: 0,
    warnings: [],
    error: null,
    durationMs: 0,
    requests: 0,
    partial: false,
    pendingEnrich: [],
    pendingGeo: [],
  };
  let requests = 0;
  const finish = async (
    o: Partial<RunOutcome> & { stats?: import("./store").ApplyStats | null },
  ) => {
    const out = { ...base, ...o, requests, durationMs: Date.now() - t0 };
    if (deps.db)
      await recordRun(deps.db, {
        sourceSlug: source.slug,
        startedAt,
        ok: out.ok,
        notModified: out.notModified,
        httpStatus: out.httpStatus,
        stats: o.stats ?? null,
        error: out.error,
      });
    return out;
  };

  try {
    const plans = deps.adapter.plan(source);
    const bodies: FetchedBody[] = [];
    const cond = deps.db
      ? await loadConditionalState(deps.db, source.slug)
      : { etag: null, lastModified: null, lastHash: null, failures: 0 };
    let lastRes: Awaited<ReturnType<Http["get"]>> | null = null;
    for (const [planIdx, plan] of plans.entries()) {
      const robots = await checkRobots(deps.http, plan.url, deps.userAgent);
      if (!robots.allowed) return finish({ error: "robots_disallow", httpStatus: null });
      if (robots.malformed)
        log.warn(
          { url: plan.url },
          "robots.txt malformed: a non-consent signal; check the tier in the registry",
        );
      let res: Awaited<ReturnType<Http["get"]>>;
      requests++;
      if (plan.render) {
        if (!deps.browser) return finish({ error: "browser_unavailable", httpStatus: null });
        res = await deps.browser.fetch(plan);
      } else {
        // conditional state (ETag/Last-Modified) is stored per source: it only applies to the 1st plan
        res = await deps.http.get(plan, plan.conditional && planIdx === 0 ? cond : {});
      }
      lastRes = res;
      if (res.status === 304) return finish({ ok: true, notModified: true, httpStatus: 304 });
      if (res.status !== 200)
        return finish({ error: `http_${res.status}`, httpStatus: res.status });
      bodies.push({
        url: res.url,
        status: res.status,
        contentType: res.headers["content-type"] ?? null,
        text: res.text,
        fetchedAt: res.fetchedAt,
      });
    }
    if (deps.adapter.planMore) {
      const more = deps.adapter.planMore(source, bodies);
      if (more.length > MAX_FOLLOWUP_PLANS)
        log.warn(
          { planned: more.length, max: MAX_FOLLOWUP_PLANS },
          "planMore over the limit: only the first ones",
        );
      for (const plan of more.slice(0, MAX_FOLLOWUP_PLANS)) {
        const robots = await checkRobots(deps.http, plan.url, deps.userAgent);
        if (!robots.allowed) {
          log.warn({ url: plan.url }, "planMore: robots disallow, request skipped");
          continue;
        }
        let res: Awaited<ReturnType<Http["get"]>>;
        requests++;
        if (plan.render) {
          if (!deps.browser) continue;
          res = await deps.browser.fetch(plan);
        } else res = await deps.http.get({ ...plan, conditional: false });
        bodies.push({
          url: res.url,
          status: res.status,
          contentType: res.headers["content-type"] ?? null,
          text: res.text,
          fetchedAt: res.fetchedAt,
        });
      }
    }
    const bodyHash = createHash("sha256")
      .update(bodies.map((b) => b.text).join("\n"))
      .digest("hex");
    if (deps.db && cond.lastHash === bodyHash) {
      // content identical to the last poll: nothing to apply, but we record the poll
      return finish({ ok: true, notModified: true, httpStatus: 200 });
    }
    const parsed = deps.adapter.parse(source, bodies);
    for (const w of parsed.warnings) log.warn({ warning: w }, "parse warning");
    if (parsed.listings.length === 0 && parsed.warnings.length > 0) {
      // Zero listings with warnings = likely drift... except when the source was already at zero:
      // then nothing can be "removed" by mistake and a benign warning must not put the source in backoff.
      const hadActive = deps.db ? (await activeListingCount(deps.db, source.slug)) > 0 : true;
      if (hadActive)
        return finish({
          error: `parse_failed: ${parsed.warnings[0]}`,
          httpStatus: lastRes?.status ?? null,
          warnings: parsed.warnings,
        });
    }
    if (!deps.db) {
      // dry run (`engine once` without --db): the report must tell the truth about coverage,
      // otherwise an always-partial adapter looks complete.
      return {
        ...(await finish({
          ok: true,
          httpStatus: 200,
          items: parsed.listings.length,
          warnings: parsed.warnings,
          partial: Boolean(parsed.partial),
        })),
        listings: parsed.listings,
      };
    }
    const rawById = new Map<string, unknown>();
    try {
      const json = JSON.parse(bodies[0]?.text ?? "{}") as { result?: Array<{ id?: unknown }> };
      for (const it of json.result ?? [])
        if (it && typeof it.id === "string") rawById.set(it.id, it);
    } catch {
      /* raw opcional */
    }
    // An id index (sitemap, feed) allows safe removal even in a partial poll:
    // the adapter did not read everything, but knows exactly what the source still publishes.
    const presentIds = parsed.presentIds?.length ? parsed.presentIds : undefined;
    let markRemoved = !parsed.partial || presentIds !== undefined;
    if (parsed.partial && !presentIds)
      log.warn("partial poll: missing listings will not be marked as removed");
    if (parsed.partial && presentIds)
      log.info({ presentIds: presentIds.length }, "partial poll with the source's id index");
    let deferredRemoval = false;
    if (markRemoved && parsed.listings.length === 0 && !presentIds) {
      // the whole aanbod vanished at once: only removed if the next poll confirms it
      const active = await activeListingCount(deps.db, source.slug);
      const prev = await lastAppliedRunItems(deps.db, source.slug);
      if (active > 0 && prev !== 0) {
        markRemoved = false;
        deferredRemoval = true;
        log.warn(
          { active },
          "empty feed with active listings: removal deferred until a second empty poll",
        );
      }
    }
    const stats = await applyListings(deps.db, source.slug, parsed.listings, rawById, startedAt, {
      markRemoved,
      ...(presentIds ? { presentIds } : {}),
    });
    // The poll that defers removal stores no conditional state. The second empty poll is, by
    // definition, byte-for-byte equal to the first (`{"result":[]}`, "geen aanbod"): with an ETag or hash
    // stored it would exit via 304 or the hash short-circuit before the removal logic, and the
    // listings would stay active forever — the app deep-linking to homes already rented.
    // Costs one full request per poll, and only while the feed is empty.
    await saveConditionalState(
      deps.db,
      source.slug,
      deferredRemoval
        ? { etag: null, lastModified: null, hash: null }
        : {
            etag: lastRes?.headers.etag ?? null,
            lastModified: lastRes?.headers["last-modified"] ?? null,
            hash: bodyHash,
          },
    );

    let pendingEnrich: EnrichItem[] = [];
    const pendingGeo: GeoCandidate[] = [];
    const byId = new Map(parsed.listings.map((l) => [l.sourceListingId, l]));
    for (const n of stats.newListings) {
      const l = byId.get(n.sourceListingId);
      if (!l) continue;
      const missing = !l.address.municipality || !l.address.province || !l.location;
      if (missing && (l.address.postcode || l.location))
        pendingGeo.push({
          rowId: n.id,
          postcode: l.address.postcode,
          lat: l.location?.lat ?? null,
          lng: l.location?.lng ?? null,
        });
    }
    if (deps.adapter.enrich && stats.newListings.length) {
      for (const n of stats.newListings) {
        const listing = byId.get(n.sourceListingId);
        if (listing) pendingEnrich.push({ rowId: n.id, listing });
      }
      const max = deps.enrichMaxPerRun ?? 0;
      if (max > 0) {
        for (const item of pendingEnrich.slice(0, max)) await enrichOne(source, deps, item);
        pendingEnrich = pendingEnrich.slice(max);
      }
    }
    log.info(
      {
        items: stats.items,
        new: stats.newItems,
        changed: stats.changedItems,
        removed: stats.removedItems,
        ms: Date.now() - t0,
      },
      "run ok",
    );
    return finish({
      ok: true,
      httpStatus: 200,
      items: stats.items,
      newItems: stats.newItems,
      changedItems: stats.changedItems,
      removedItems: stats.removedItems,
      warnings: parsed.warnings,
      stats,
      partial: Boolean(parsed.partial),
      pendingEnrich,
      pendingGeo,
    });
  } catch (err) {
    log.error({ err: String(err) }, "run failed");
    return finish({ error: String(err).slice(0, 500) });
  }
}
