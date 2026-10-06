import type { CanonicalListing, RegistrySource } from "@papa/core";

/**
 * Rendering in a browser (technical Tier B): public pages whose data only exists after JS runs.
 * No stealth, no login, no bypassing challenges; the browser uses the engine's User-Agent and host
 * policy. When `captureResponse` is set, the returned body is that of the first XHR/fetch response
 * whose URL matches; otherwise it is the page's rendered HTML.
 */
export interface RenderPlan {
  /** CSS selector to wait for before capturing (e.g. ".woning-card"). */
  waitForSelector?: string;
  /** URL substring (or "re:<regex>") of the XHR/fetch response to capture. */
  captureResponse?: string;
  /** Selectors to click before capturing (e.g. accept cookies); ignored when absent. */
  clicks?: string[];
  /** Total timeout in ms (engine default: 45 000). */
  timeoutMs?: number;
}

/** A request the engine performs on the adapter's behalf. */
export interface FetchPlan {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Request body (POST only). Always public and anonymous: never session tokens. */
  body?: string;
  /** If true, the engine sends If-None-Match / If-Modified-Since and handles 304 (only without `render`). */
  conditional?: boolean;
  /** When present, the page is loaded in a browser instead of a plain GET. */
  render?: RenderPlan;
}

export interface FetchedBody {
  url: string;
  status: number;
  contentType: string | null;
  text: string;
  fetchedAt: string; // ISO
}

export interface ParseResult {
  listings: CanonicalListing[];
  /**
   * true when the adapter knows it did NOT see the whole offer (missing page, truncated feed, more
   * pages than the limit). The engine applies new/changed listings but does not mark absent ones as
   * removed.
   */
  partial?: boolean;
  /**
   * Ids the source still publishes right now, including those this run did not read in full.
   * Meant for catalogues too large for a full sweep (1000+ listings) that publish a cheap index of
   * everything that exists (a sitemap, an id feed). The adapter reads only the first page in depth
   * (the newest, which is what triggers alerts) and returns the whole set here: the engine keeps
   * listed ids alive and removes the ones that dropped out, without re-reading the catalogue. An
   * empty list is ignored (it never causes a mass removal). Only effective with `partial: true`;
   * without `partial` the listings themselves are the truth.
   */
  presentIds?: string[];
  /** Items skipped on purpose (garages, for sale, unpublished), for auditing. */
  skipped: Array<{ id: string; reason: string }>;
  /** Non-fatal warnings (unexpected field, out-of-pattern value). */
  warnings: string[];
}

/**
 * Fields the detail page may complete. Never the net price nor identity (avoids false events).
 * `applyUrl` may be corrected by the detail page (e.g. a project's external application site).
 * `address` is partial: only the keys present are written (e.g. a postcode only the detail has).
 */
export type EnrichPatch = Partial<
  Pick<
    CanonicalListing,
    | "applyUrl"
    | "serviceCosts"
    | "priceTotal"
    | "reactionsCount"
    | "description"
    | "eligibility"
    | "rooms"
    | "bedrooms"
    | "areaM2"
    | "dwellingType"
    | "dwellingCategory"
    | "energyLabel"
    | "constructionYear"
    | "floor"
    | "availableFrom"
    | "availableFromText"
    | "publishedAt"
    | "closesAt"
    | "huurtoeslagPossible"
    | "registrationRequired"
    | "targetGroups"
    | "notices"
    | "labels"
    | "photos"
    | "thumbnail"
    | "location"
    | "operator"
    | "isNewBuild"
  >
> & { address?: Partial<CanonicalListing["address"]> };

export interface EnrichResult {
  patch: EnrichPatch;
  warnings: string[];
}

/**
 * Adapter contract. Pure: no network. Takes the registry source, says what to fetch and turns the
 * response into canonical listings. Testable with fixtures.
 * `enrich` (optional) fetches the detail of ONE new listing for extra fields (service costs,
 * eligibility criteria, number of reactions).
 */
export interface SourceAdapter {
  readonly id: string;
  plan(source: RegistrySource): FetchPlan[];
  /**
   * Optional: extra requests discovered in the first round's bodies (pagination, unit ids,
   * buildId). A single round; the engine caps the count (load policy) and passes every body, in
   * order, to `parse`. Non-200 bodies from this round arrive with their real `status`.
   */
  planMore?(source: RegistrySource, bodies: FetchedBody[]): FetchPlan[];
  parse(source: RegistrySource, bodies: FetchedBody[], now?: Date): ParseResult;
  enrich?: {
    plan(source: RegistrySource, listing: CanonicalListing): FetchPlan;
    parse(source: RegistrySource, listing: CanonicalListing, body: FetchedBody): EnrichResult;
  };
}
