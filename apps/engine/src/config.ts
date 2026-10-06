import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface EngineConfig {
  databaseUrl: string | undefined;
  registryPath: string;
  userAgent: string;
  logLevel: string;
  /** Maximum number of concurrent polls. */
  concurrency: number;
  /** Minimum gap between requests to the same host (source policy). Default 60 s. */
  minGapPerHostMs: number;
  requestTimeoutMs: number;
  /** Pause between detail fetches of the same source (enrichment queue, off the critical path). */
  enrichGapMs: number;
  /** Maximum size of the per-source enrichment queue; beyond it, the oldest are dropped. */
  enrichQueueMax: number;
  /** PDOK geocoding of new listings without a municipality (off the critical path). */
  geocode: boolean;
  geocodeGapMs: number;
  /** Periodic municipality backfill for listings that gained a postcode later (enrich). */
  geocodeBackfillMs: number;
  /**
   * Visitor-like load: each request of a poll "costs" this much time in the next interval
   * (e.g. 6 pages × 60 s → the source is read again only ≥ 6 min later).
   */
  perRequestBudgetMs: number;
  /** Browser for `render` plans (Tier B): Chromium executable and launch arguments. */
  browserExecutable: string | undefined;
  browserArgs: string[];
  browserTimeoutMs: number;
}

const CHROMIUM_CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/opt/pw-browsers/chromium",
];

/**
 * Default User-Agent: an identified bot with a contact URL, never a browser disguise. The robots.txt
 * matcher uses its product token ("PapaRentBot"), so a site can address us by that name.
 */
export const DEFAULT_BOT_USER_AGENT = "PapaRentBot/0.1 (+https://example.com/bot)";

export function loadConfig(env = process.env): EngineConfig {
  return {
    databaseUrl: env.DATABASE_URL,
    registryPath:
      env.REGISTRY_PATH ??
      fileURLToPath(new URL("../../../docs/sources/registry.yaml", import.meta.url)),
    userAgent: env.BOT_USER_AGENT || DEFAULT_BOT_USER_AGENT,
    logLevel: env.LOG_LEVEL ?? "info",
    concurrency: Number(env.ENGINE_CONCURRENCY ?? 4),
    minGapPerHostMs: Number(env.ENGINE_MIN_GAP_PER_HOST_MS ?? 60_000),
    requestTimeoutMs: Number(env.ENGINE_REQUEST_TIMEOUT_MS ?? 30_000),
    enrichGapMs: Number(env.ENGINE_ENRICH_GAP_MS ?? 10_000),
    enrichQueueMax: Number(env.ENGINE_ENRICH_QUEUE_MAX ?? 300),
    geocode: (env.ENGINE_GEOCODE ?? "1") !== "0",
    geocodeGapMs: Number(env.ENGINE_GEOCODE_GAP_MS ?? 250),
    geocodeBackfillMs: Number(env.ENGINE_GEOCODE_BACKFILL_MS ?? 30 * 60_000),
    perRequestBudgetMs: Number(env.ENGINE_PER_REQUEST_BUDGET_MS ?? 60_000),
    browserExecutable:
      env.ENGINE_BROWSER_EXECUTABLE || CHROMIUM_CANDIDATES.find((p) => existsSync(p)),
    browserArgs: (env.ENGINE_BROWSER_ARGS ?? "--no-sandbox,--disable-dev-shm-usage")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
    browserTimeoutMs: Number(env.ENGINE_BROWSER_TIMEOUT_MS ?? 45_000),
  };
}
