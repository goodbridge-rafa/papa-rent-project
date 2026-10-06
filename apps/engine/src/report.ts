import { sql } from "drizzle-orm";
import type { AnyDb } from "./store";

/**
 * p50/p95 (seconds) of first_seen_at − published_at per source. Only counts listings published AFTER
 * the source's first successful poll: the initial snapshot (backlog) is not detection latency.
 * Ignores publications at local midnight (sources with day granularity).
 */
export async function latencyReport(db: AnyDb, hours = 24) {
  const rows = await db.execute(sql`
    with first_run as (
      select source_slug, min(started_at) as t0 from source_runs where ok group by source_slug
    )
    select l.source_slug,
           count(*)::int as listings,
           round(percentile_cont(0.5) within group (order by extract(epoch from (l.first_seen_at - l.published_at))))::int as p50_s,
           round(percentile_cont(0.95) within group (order by extract(epoch from (l.first_seen_at - l.published_at))))::int as p95_s,
           max(extract(epoch from (l.first_seen_at - l.published_at)))::int as max_s
    from listings l
    join first_run f on f.source_slug = l.source_slug
    where l.published_at is not null
      and l.published_at >= f.t0
      and l.first_seen_at > now() - (${hours} || ' hours')::interval
      and l.first_seen_at >= l.published_at
      -- sources that only give the day ("aangeboden sinds 26 augustus") become local midnight: not latency
      and (l.published_at at time zone 'Europe/Amsterdam')::time <> time '00:00:00'
    group by l.source_slug
    order by l.source_slug
  `);
  return Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
}

/**
 * Per-source health: answers "which sources are mute?".
 *
 * A poll that returns zero listings without warnings is `ok: true` — it resets failures to zero and
 * updates `last_ok_at`. Seen only through polls, a `live` source that stopped publishing is
 * indistinguishable from a healthy one, and coverage drops silently. This looks at the other side:
 * what the source produced, not whether the request went well.
 */
export type SourceHealthStatus = "ok" | "stale" | "empty" | "failing" | "never_ran" | "idle";

export type SourceHealthReason =
  | "healthy"
  /** Never polled (source just added to the registry). */
  | "never_ran"
  /** Has run, never successfully. */
  | "never_succeeded"
  /** Consecutive failures above the limit; the error is in `lastError`. */
  | "failing"
  /** The engine has not read it for too long: no basis to say the source is mute. */
  | "not_polled"
  /** Had listings, went to zero and a second poll confirmed it. */
  | "went_to_zero"
  /** Successful polls, but the source never published a single listing. */
  | "never_published"
  /** Still publishing, but nothing new has appeared for much longer than is normal for it. */
  | "no_new_listings";

export interface HealthThresholds {
  /** No source is declared mute before this, however fast its measured cadence. */
  minSilenceS: number;
  /** Tolerated silence when there is no measured cadence (too few polls with news to infer the pace). */
  unknownCadenceSilenceS: number;
  /**
   * Multiplier over the p90 of the intervals between polls WITH news — that p90 is what absorbs
   * nights and weekends. (Measured between listings it absorbed nothing: a whole batch is detected
   * in the same poll and the p90 came out ~0 s.)
   */
  cadenceFactor: number;
  /** Minimum measured intervals to trust the source's cadence. */
  minGaps: number;
  /** Consecutive polls confirming the aanbod at zero to declare the source empty (same logic as deferred removal). */
  emptyRuns: number;
  /** Consecutive failures from which the source is failing, not mute. */
  failingAfter: number;
  /** No poll for longer than this (or 3× the source interval) → `idle`, nothing is concluded. */
  idleAfterS: number;
}

/**
 * Conservative on purpose: a false alarm spends the owner's attention and then nobody looks at
 * the real ones. A small source sitting at zero for a day is not news; a source that was
 * publishing every day and has been silent for a week is.
 */
export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  minSilenceS: 6 * 60 * 60,
  unknownCadenceSilenceS: 7 * 24 * 60 * 60,
  cadenceFactor: 3,
  minGaps: 8,
  emptyRuns: 2,
  failingAfter: 3,
  idleAfterS: 30 * 60,
};

/** What we know about a source, without judgement. All from the same query. */
export interface SourceHealthFacts {
  sourceSlug: string;
  name: string;
  intervalSeconds: number | null;
  /** Listings still published (not removed). */
  activeListings: number;
  /** Listings ever seen on this source (removed included): tells "dried up" from "never produced". */
  everListings: number;
  /** Most recent detection (`first_seen_at`), the sign the source still talks. */
  lastNewAt: string | null;
  /** Seconds since the last detection. */
  silenceS: number | null;
  /** Seconds since the last poll (successful or not). */
  sinceRunS: number | null;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  /**
   * Consecutive polls (most recent backwards) confirming the aanbod at zero: the applied poll
   * that returned zero listings and the 304/same-hash polls following it (the body did not change,
   * so the aanbod is still empty).
   */
  emptyRuns: number;
  /**
   * Intervals between polls that brought new listings, after the first poll (the initial
   * snapshot does not count). It is the source's pace; between listings it would be the INSERT pace.
   */
  gaps: number;
  p90GapS: number | null;
}

export interface SourceHealth extends SourceHealthFacts {
  status: SourceHealthStatus;
  reason: SourceHealthReason;
  /** Silence after which this source is declared mute (seconds); null when not applicable. */
  silenceBudgetS: number | null;
}

/**
 * How much silence is normal for this source. With enough history it comes from its own pace
 * (p90 of the intervals between polls with news × factor), never below the floor; without history
 * the long default silence applies. So a source with 2 listings a month does not fire after a
 * day, nor does a source publishing one batch a day fire every night.
 */
export function silenceBudgetS(facts: SourceHealthFacts, th: HealthThresholds): number {
  if (facts.gaps >= th.minGaps && facts.p90GapS !== null)
    return Math.max(th.minSilenceS, Math.round(facts.p90GapS * th.cadenceFactor));
  return th.unknownCadenceSilenceS;
}

/** Pure classification (no DB): the source's facts → a status and its reason. */
export function classifySource(facts: SourceHealthFacts, th: HealthThresholds): SourceHealth {
  const base = { ...facts, silenceBudgetS: null as number | null };
  if (facts.lastRunAt === null) return { ...base, status: "never_ran", reason: "never_ran" };
  if (facts.lastOkAt === null) return { ...base, status: "failing", reason: "never_succeeded" };
  if (facts.consecutiveFailures >= th.failingAfter)
    return { ...base, status: "failing", reason: "failing" };
  // the engine runs in sessions: without recent polls, the silence is ours, not the source's
  const idleAfter = Math.max(th.idleAfterS, 3 * (facts.intervalSeconds ?? 300));
  if ((facts.sinceRunS ?? Number.POSITIVE_INFINITY) > idleAfter)
    return { ...base, status: "idle", reason: "not_polled" };
  if (facts.activeListings === 0 && facts.emptyRuns >= th.emptyRuns)
    return {
      ...base,
      status: "empty",
      reason: facts.everListings > 0 ? "went_to_zero" : "never_published",
    };
  const budget = silenceBudgetS(facts, th);
  if (facts.activeListings > 0 && facts.silenceS !== null && facts.silenceS > budget)
    return { ...base, status: "stale", reason: "no_new_listings", silenceBudgetS: budget };
  return { ...base, status: "ok", reason: "healthy", silenceBudgetS: budget };
}

export interface HealthReport {
  checkedAt: string;
  thresholds: HealthThresholds;
  summary: {
    total: number;
    ok: number;
    stale: number;
    empty: number;
    failing: number;
    neverRan: number;
    idle: number;
    /** Sources that stopped producing: the short answer to "which sources are mute?". */
    mute: string[];
  };
  sources: SourceHealth[];
}

function toIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v) return new Date(v).toISOString();
  return null;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Health facts of every source with a given registry `status` (default `live`).
 * A single query: polls (last one, empty streak), listings (active, ever seen,
 * last detection) and the source's own cadence.
 */
export async function sourceHealthFacts(
  db: AnyDb,
  statuses: string[] = ["live"],
): Promise<SourceHealthFacts[]> {
  if (statuses.length === 0) return [];
  const res = await db.execute(sql`
    with applied as (
      select source_slug, started_at, finished_at, items
      from source_runs where ok and not not_modified
    ),
    -- end of the first applied poll: everything inserted up to then is the initial snapshot,
    -- not a detection, and says nothing about the source's pace
    first_run as (
      select distinct on (source_slug) source_slug, finished_at as t0
      from applied order by source_slug, started_at
    ),
    last_applied as (
      select distinct on (source_slug) source_slug, items
      from applied order by source_slug, started_at desc
    ),
    last_non_empty as (
      select source_slug, max(started_at) as at from applied where items > 0 group by source_slug
    ),
    -- Polls confirming the aanbod at zero: every successful poll after the last applied
    -- poll with listings, provided the most recent applied poll is at zero.
    -- A 304/same-hash after an empty poll confirms the SAME empty body, so it counts:
    -- counting only applied polls left the streak stuck at 1 for a source whose empty feed is
    -- byte-stable (every later poll is not_modified) and it was never flagged.
    empty_streak as (
      select r.source_slug, count(*)::int as n
      from source_runs r
      join last_applied la on la.source_slug = r.source_slug and la.items = 0
      left join last_non_empty ne on ne.source_slug = r.source_slug
      where r.ok and (ne.at is null or r.started_at > ne.at)
      group by r.source_slug
    ),
    run_stats as (
      select source_slug, max(started_at) as last_run_at from source_runs group by source_slug
    ),
    listing_stats as (
      select source_slug,
             count(*) filter (where removed_at is null)::int as active_listings,
             count(*)::int as ever_listings,
             max(first_seen_at) as last_new_at
      from listings group by source_slug
    ),
    -- Cadence measured between POLLS that brought news, not between listings: a source publishes
    -- in batches and the whole batch is detected in the same poll (all first_seen_at within
    -- milliseconds). Measured per listing, the p90 came out ~0 s for any batch source,
    -- the silence budget collapsed to the floor and a healthy daily source was flagged
    -- mute every night. A stopped engine widens these intervals — erring towards tolerating
    -- more silence, which is the right side to avoid spending attention on false alarms.
    detections as (
      select r.source_slug, r.started_at as at
      from source_runs r join first_run fr on fr.source_slug = r.source_slug
      where r.ok and r.new_items > 0 and r.started_at > fr.t0
    ),
    gaps as (
      select source_slug,
             extract(epoch from (at - lag(at)
               over (partition by source_slug order by at))) as gap_s
      from detections
    ),
    cadence as (
      select source_slug, count(*)::int as gaps,
             percentile_cont(0.9) within group (order by gap_s) as p90_gap_s
      from gaps where gap_s is not null group by source_slug
    )
    select s.slug, s.name, s.interval_seconds, s.last_ok_at, s.last_error,
           s.consecutive_failures,
           coalesce(ls.active_listings, 0) as active_listings,
           coalesce(ls.ever_listings, 0) as ever_listings,
           ls.last_new_at, rs.last_run_at,
           coalesce(es.n, 0) as empty_runs,
           coalesce(c.gaps, 0) as gaps, c.p90_gap_s,
           round(extract(epoch from (now() - ls.last_new_at)))::int as silence_s,
           round(extract(epoch from (now() - rs.last_run_at)))::int as since_run_s
    from sources s
    left join listing_stats ls on ls.source_slug = s.slug
    left join run_stats rs on rs.source_slug = s.slug
    left join empty_streak es on es.source_slug = s.slug
    left join cadence c on c.source_slug = s.slug
    where s.status in ${statuses}
    order by s.slug
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    sourceSlug: String(r.slug),
    name: String(r.name),
    intervalSeconds: toNum(r.interval_seconds),
    activeListings: toNum(r.active_listings) ?? 0,
    everListings: toNum(r.ever_listings) ?? 0,
    lastNewAt: toIso(r.last_new_at),
    silenceS: toNum(r.silence_s),
    sinceRunS: toNum(r.since_run_s),
    lastRunAt: toIso(r.last_run_at),
    lastOkAt: toIso(r.last_ok_at),
    lastError: typeof r.last_error === "string" ? r.last_error : null,
    consecutiveFailures: toNum(r.consecutive_failures) ?? 0,
    emptyRuns: toNum(r.empty_runs) ?? 0,
    gaps: toNum(r.gaps) ?? 0,
    p90GapS: toNum(r.p90_gap_s),
  }));
}

/** Health report ready to print (CLI) or serve (`/health`). */
export async function sourceHealth(
  db: AnyDb,
  opts: { statuses?: string[]; thresholds?: Partial<HealthThresholds> } = {},
): Promise<HealthReport> {
  const thresholds = { ...DEFAULT_HEALTH_THRESHOLDS, ...opts.thresholds };
  const facts = await sourceHealthFacts(db, opts.statuses ?? ["live"]);
  const sources = facts.map((f) => classifySource(f, thresholds));
  const count = (s: SourceHealthStatus) => sources.filter((x) => x.status === s).length;
  return {
    checkedAt: new Date().toISOString(),
    thresholds,
    summary: {
      total: sources.length,
      ok: count("ok"),
      stale: count("stale"),
      empty: count("empty"),
      failing: count("failing"),
      neverRan: count("never_ran"),
      idle: count("idle"),
      mute: sources
        .filter((s) => s.status === "stale" || s.status === "empty")
        .map((s) => s.sourceSlug),
    },
    sources,
  };
}
