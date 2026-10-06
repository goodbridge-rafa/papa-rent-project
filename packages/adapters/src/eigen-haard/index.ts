import {
  absoluteUrl,
  type CanonicalListing,
  canonicalKey,
  classifySegment,
  type DwellingCategory,
  type ListingLabel,
  MUNICIPALITIES,
  type Municipality,
  municipalityByName,
  normalizePostcode,
  type RegistrySource,
  stableHash,
  toIntOrNull,
} from "@papa/core";
import { type HTMLElement, parse as parseHtml } from "node-html-parser";
import type {
  EnrichPatch,
  EnrichResult,
  FetchedBody,
  FetchPlan,
  ParseResult,
  SourceAdapter,
} from "../types";

/**
 * Adapter for Eigen Haard, a large Amsterdam housing corporation.
 * Social rent is only published on the regional allocation portal (DĀK/WoningNet), but the
 * middenhuur and vrije sector offer is published on the corporation's own site.
 *
 * Data path: a single GET to `/te-huur/middenhuur-en-vrije-sector/zoek/?view=Map`. The map view
 * returns the whole offer in one request (`<input class="objectsJson">` holds a JSON array of
 * every object, including `gps`), whereas the list view pages 12 at a time and has no
 * coordinates. One request per run, no geocoding, no browser.
 *
 * Coverage: `parse` compares the `<h3>N resultaten</h3>` counter with the items read and returns
 * `partial: true` when it did not see the whole offer (missing JSON, counter above the item count),
 * so the engine does not mark absent listings as removed.
 *
 * Segment: the section mixes middenhuur and vrije sector (the `/vrije-sector-huur/` path also
 * serves listings below the midden cap), so NO `sourceHint` is passed; the price decides against
 * market-rules.
 *
 * Application: the detail page carries the exact deep link to the DĀK portal
 * (`<region>.mijndak.nl/HuisDetails?PublicatieId=<id>`), published by the source itself. It is the
 * final application point and avoids any read of the DĀK portal.
 *
 * Personal data: none in the list or the detail page (only the property address and offer text).
 */
export const EIGEN_HAARD_ORIGIN = "https://www.eigenhaard.nl";
export const EIGEN_HAARD_LISTINGS_URL = `${EIGEN_HAARD_ORIGIN}/te-huur/middenhuur-en-vrije-sector/zoek/`;
/** Map view: the whole offer in one request, with coordinates. */
export const MAP_VIEW_QUERY = "view=Map";
/** Selector of the map-view payload. */
export const OBJECTS_JSON_SELECTOR = "input.objectsJson";
/** Place/district filter: gives the municipality of every published place name. */
export const REGION_SELECT_SELECTOR = "#lbRegions option";
/** `<h3>18 resultaten</h3>` inside the results panel. */
const RESULT_COUNT_RE = /<h3>\s*([\d.]+)\s*resultaten?\s*<\/h3>/i;
/** `/te-huur/vrije-sector-huur/900001-amsterdam-centrum-voorbeeldstraat-1` */
const DETAIL_PATH_RE = /^\/te-huur\/[a-z0-9-]+\/(\d+)-[a-z0-9-]+\/?$/i;
/** Application deep link published on the detail page. */
const MIJNDAK_RE = /^https:\/\/[a-z0-9-]+\.mijndak\.nl\/HuisDetails\?PublicatieId=\d+$/i;
/**
 * Address anchor in the detail page's "nearby" blocks:
 * `?regions=…&amp;adres=1234AB&amp;straal=3000`. In the HTML the separators are escaped (`&amp;`).
 */
const NEARBY_POSTCODE_RE = /(?:[?&]|&amp;)(?:adres|postcode)=(\d{4}\s?[A-Za-z]{2})(?=[&"']|$)/g;
const NEARBY_RADIUS_RE = /(?:[?&]|&amp;)straal=\d+/;
/** Monthly only: any other period would be a misleading price. */
const MONTHLY_RE = /^(?:\/?\s*(?:mnd|maand|mth|m)|p\/?m|per\s+maand)$/i;
const STATUS_AVAILABLE_RE = /^beschikbaar$/i;
const RENT_TYPE_RE = /^te\s+huur$/i;
const DESCRIPTION_MAX = 2000;
/** Generous bounds of the Netherlands, to discard absurd coordinates. */
const NL_BOUNDS = { minLat: 50.5, maxLat: 53.8, minLng: 3.2, maxLng: 7.3 };

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

/** HTML entities that appear in this source's attributes and text. */
export function decodeEntities(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/gi, "'")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&euro;|&#8364;/gi, "€")
    .replace(/&amp;/g, "&");
}

/** Strips tags (`extrainfo` carries `m<sup>2</sup>`) and normalises whitespace. */
const stripTags = (raw: string): string => decodeEntities(raw.replace(/<[^>]*>/g, " "));

/**
 * "€ 1.225 /mnd" -> 1225; "950,-" -> 950. A dot is a thousands separator only when followed by
 * exactly three digits; a comma is always decimal.
 */
export function parseEuro(raw: string | null | undefined): number | null {
  const s = clean(raw);
  if (!s) return null;
  const digits = s.replace(/[€\s]/g, "").replace(/\.(?=\d{3}(?!\d))/g, "");
  const m = /(\d+)(?:,(\d{1,2}))?/.exec(digits);
  if (!m) return null;
  const n = Number(m[2] ? `${m[1]}.${m[2]}` : m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** "52.38,4.87" -> {lat,lng}, or null when outside the Netherlands. */
export function parseGps(raw: string | null | undefined): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw ?? "");
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < NL_BOUNDS.minLat || lat > NL_BOUNDS.maxLat) return null;
  if (lng < NL_BOUNDS.minLng || lng > NL_BOUNDS.maxLng) return null;
  return { lat, lng };
}

/** Compares place names ignoring case, accents and hyphens: "Nieuw West" = "Nieuw-West". */
const foldPlace = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-\s]+/g, " ")
    .trim();

/** `municipalityByName` does not tolerate hyphens; here "Ouder Amstel" finds "Ouder-Amstel". */
export function findMunicipality(name: string | null | undefined): Municipality | undefined {
  if (!name) return undefined;
  const direct = municipalityByName(name);
  if (direct) return direct;
  const target = foldPlace(name);
  return MUNICIPALITIES.find((m) => foldPlace(m.name) === target);
}

/**
 * The page's own filter groups places by municipality
 * (`<option data-group="Amsterdam">Amsterdam Nieuw-West</option>`). It is the authoritative source
 * for resolving districts; options without `data-group` are their own place name (which may be a
 * village rather than a municipality; it then stays unresolved instead of being guessed).
 */
export function parseRegionGroups(root: HTMLElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const opt of root.querySelectorAll(REGION_SELECT_SELECTOR)) {
    const label = clean(opt.text);
    if (!label) continue;
    out.set(foldPlace(label), clean(opt.getAttribute("data-group")) ?? label);
  }
  return out;
}

function categoryOf(s: string): DwellingCategory | null {
  if (/senior|55\+|65\+/.test(s)) return "senior";
  if (/studio/.test(s)) return "studio";
  if (/appartement|flat|maisonnette|bovenwoning|benedenwoning|penthouse|portiek|galerij/.test(s))
    return "apartment";
  if (/woonhuis|eengezins|bungalow|villa|hoekwoning|tussenwoning|vrijstaand|woning/.test(s))
    return "house";
  if (/kamer/.test(s)) return "room";
  return null;
}

/** "Appartement" -> apartment; "Woonhuis" -> house. */
export function mapDwellingCategory(dwellingType: string | null): DwellingCategory {
  if (!dwellingType) return "other";
  return categoryOf(dwellingType.toLowerCase()) ?? "other";
}

/**
 * "Voorbeeldstraat 95" -> street + number; "Proeflaan 11-1" -> number 11, addition "1".
 * Without a recognisable number, the street keeps the whole title.
 */
export function splitAddress(title: string): {
  street: string | null;
  houseNumber: string | null;
  houseNumberAddition: string | null;
} {
  const t = clean(title);
  if (!t) return { street: null, houseNumber: null, houseNumberAddition: null };
  const m = /^(.*?[^\d\s])\s+(\d+)\s*[-/\s]?\s*([A-Za-z0-9]{1,4})?$/.exec(t);
  if (!m) return { street: t, houseNumber: null, houseNumberAddition: null };
  return {
    street: clean(m[1]),
    houseNumber: m[2] ?? null,
    houseNumberAddition: clean(m[3]) ?? null,
  };
}

/**
 * "Amsterdam Oost | 54&nbsp;m<sup>2</sup> | 3&nbsp;kamers | Appartement" -> typed parts.
 * The order is not assumed: each part is recognised by its own content.
 */
export function parseExtraInfo(raw: string | null | undefined): {
  city: string | null;
  areaM2: number | null;
  rooms: number | null;
  dwellingType: string | null;
} {
  const out = {
    city: null as string | null,
    areaM2: null as number | null,
    rooms: null as number | null,
    dwellingType: null as string | null,
  };
  const parts = stripTags(raw ?? "")
    .split("|")
    .map((p) => clean(p))
    .filter((p): p is string => p !== null);
  for (const [i, part] of parts.entries()) {
    if (/\bm\s*2\b|m²/i.test(part)) {
      const n = Number((/(\d+(?:[.,]\d+)?)/.exec(part)?.[1] ?? "").replace(",", "."));
      if (Number.isFinite(n) && n > 0) out.areaM2 = n;
      continue;
    }
    if (/kamer/i.test(part)) {
      out.rooms = toIntOrNull(/(\d+)/.exec(part)?.[1]);
      continue;
    }
    if (i === 0) {
      out.city = part;
      continue;
    }
    out.dwellingType = part;
  }
  return out;
}

/** One object of the map-view payload. */
export interface EigenHaardMapObject {
  id?: unknown;
  title?: unknown;
  link?: unknown;
  gps?: unknown;
  image?: unknown;
  price?: unknown;
  extrainfo?: unknown;
  type?: unknown;
  status?: unknown;
  type_object?: unknown;
  additional_price_information?: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" ? clean(v) : null);

/** Listings URL, always with the map view. */
export function mapViewUrl(source: RegistrySource): string {
  const base = source.urls?.listings ?? EIGEN_HAARD_LISTINGS_URL;
  try {
    const u = new URL(base);
    u.searchParams.set("view", "Map");
    return u.toString();
  } catch {
    return `${EIGEN_HAARD_LISTINGS_URL}?${MAP_VIEW_QUERY}`;
  }
}

/** Extracts and deserialises the map view's `input.objectsJson` array. */
export function extractMapObjects(source: string | HTMLElement): EigenHaardMapObject[] | null {
  const root = typeof source === "string" ? parseHtml(source) : source;
  const input = root.querySelector(OBJECTS_JSON_SELECTOR);
  const raw = input?.getAttribute("value");
  if (!raw) return null;
  const json = raw.includes("&quot;") ? decodeEntities(raw) : raw;
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as EigenHaardMapObject[]) : null;
  } catch {
    return null;
  }
}

/** `<h3>18 resultaten</h3>` -> 18. */
export function extractResultCount(html: string): number | null {
  const m = RESULT_COUNT_RE.exec(html);
  if (!m) return null;
  return toIntOrNull((m[1] ?? "").replace(/\./g, ""));
}

/** `/te-huur/vrije-sector-huur/900001-...` -> "900001" (the DĀK PublicatieId). */
export function listingIdFromLink(link: string | null): string | null {
  if (!link) return null;
  const path = link.startsWith("http") ? new URL(link).pathname : link.split(/[?#]/)[0];
  return DETAIL_PATH_RE.exec(path ?? "")?.[1] ?? null;
}

// ---------------------------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------------------------

function toListing(
  source: RegistrySource,
  raw: EigenHaardMapObject,
  now: Date,
  regions: Map<string, string>,
): { listing: CanonicalListing; warnings: string[] } | { skip: string } {
  const link = str(raw.link);
  const id = listingIdFromLink(link) ?? str(raw.id);
  if (!id || !link) return { skip: "no_id_or_link" };

  const type = str(raw.type);
  if (type && !RENT_TYPE_RE.test(type)) return { skip: `type:${type}` };
  const typeObject = str(raw.type_object);
  if (typeObject && typeObject.toLowerCase() !== "woning") return { skip: `object:${typeObject}` };
  const status = str(raw.status);
  if (status && !STATUS_AVAILABLE_RE.test(status)) return { skip: `status:${status}` };

  const period = str(raw.additional_price_information);
  if (period && !MONTHLY_RE.test(period)) return { skip: `price_period:${period}` };

  const url = absoluteUrl(EIGEN_HAARD_ORIGIN, link);
  if (!url) return { skip: "bad_url" };

  const warnings: string[] = [];
  const title = str(raw.title) ?? id;
  const priceNet = parseEuro(str(raw.price));
  if (priceNet === null) warnings.push(`${id}: no readable price ("${str(raw.price) ?? ""}")`);

  const info = parseExtraInfo(str(raw.extrainfo));
  const addr = splitAddress(title);
  // "Amsterdam Oost" is a district: the municipality comes from the page filter's grouping.
  const gemeente = info.city ? (regions.get(foldPlace(info.city)) ?? info.city) : null;
  const muni = findMunicipality(gemeente);
  if (info.city && !muni) warnings.push(`${id}: no municipality for "${info.city}"`);

  // The section mixes middenhuur and vrije sector: no sourceHint, the price decides.
  const seg = classifySegment({ priceNet, at: now });
  const thumbnail = absoluteUrl(EIGEN_HAARD_ORIGIN, str(raw.image));
  const labels: ListingLabel[] = [];

  return {
    warnings,
    listing: {
      sourceSlug: source.slug,
      sourceListingId: id,
      canonicalKey: canonicalKey({
        postcode: null, // only the detail page lets us infer the postcode (enrich)
        houseNumber: addr.houseNumber,
        fallback: `${source.slug}:${id}`,
      }),
      url,
      // Without the detail page there is no DĀK deep link yet; the source page has the button.
      applyUrl: url,
      title: info.city ? `${title}, ${info.city}` : title,
      segment: seg.segment,
      segmentReason: seg.reason,
      // The WoningNet advert decides how candidates are ranked; the source does not publish it.
      allocationModel: "unknown" as const,
      closesAfterFirstReaction: false,
      priceNet,
      priceTotal: null,
      serviceCosts: null,
      address: {
        street: addr.street,
        houseNumber: addr.houseNumber,
        houseNumberAddition: addr.houseNumberAddition,
        postcode: null,
        city: info.city,
        municipality: muni?.name ?? null,
        province: muni?.province ?? null,
        country: "NL",
      },
      location: parseGps(str(raw.gps)),
      rooms: info.rooms,
      bedrooms: null,
      areaM2: info.areaM2,
      dwellingType: info.dwellingType,
      dwellingCategory: mapDwellingCategory(info.dwellingType),
      energyLabel: null,
      constructionYear: null,
      floor: null,
      availableFrom: null,
      availableFromText: null,
      publishedAt: null,
      closesAt: null,
      labels,
      targetGroups: [],
      operator: { code: null, name: "Eigen Haard" },
      registrationRequired: source.registration?.required_to_react ?? null,
      huurtoeslagPossible: null,
      photos: thumbnail ? [thumbnail] : [],
      thumbnail,
      isNewBuild: false, // "Soort bouw" only exists on the detail page (enrich)
      isExchange: false,
      notices: [],
      eligibility: null,
      reactionsCount: null,
      description: null,
      rawHash: stableHash(raw),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// enrich
// ---------------------------------------------------------------------------------------------

const text = (el: HTMLElement | null | undefined): string | null => (el ? clean(el.text) : null);

/** `<li><span class="key">Bouwjaar</span><span class="value">1918</span></li>` -> map. */
export function parseKenmerken(root: HTMLElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const li of root.querySelectorAll(".property-list li")) {
    const key = text(li.querySelector(".key"));
    const value = text(li.querySelector(".value"));
    if (key && value) out.set(key.toLowerCase().replace(/:$/, ""), value);
  }
  return out;
}

/**
 * The postcode is not labelled: it only appears as the anchor of the "nearby" blocks
 * (`/te-huur/parkeren/zoek/?...&adres=1234AB&straal=3000`). It is accepted only when ALL anchors
 * agree, so the dedup key is never contaminated with another property's postcode.
 */
export function inferPostcode(html: string): { postcode: string | null; conflict: boolean } {
  const found = new Set<string>();
  for (const m of html.matchAll(NEARBY_POSTCODE_RE)) {
    const around = html.slice(Math.max(0, m.index - 200), m.index + 200);
    if (!NEARBY_RADIUS_RE.test(around)) continue;
    const pc = normalizePostcode(decodeEntities(m[1] ?? ""));
    if (pc) found.add(pc);
  }
  if (found.size === 1) return { postcode: [...found][0] ?? null, conflict: false };
  return { postcode: null, conflict: found.size > 1 };
}

function htmlToText(el: HTMLElement | null): string | null {
  if (!el) return null;
  const t = clean(el.structuredText ?? el.text);
  if (!t) return null;
  return t.length > DESCRIPTION_MAX ? `${t.slice(0, DESCRIPTION_MAX - 1)}…` : t;
}

// ---------------------------------------------------------------------------------------------
// adapter
// ---------------------------------------------------------------------------------------------

export const eigenHaardAdapter: SourceAdapter = {
  id: "eigen-haard",

  plan(source): FetchPlan[] {
    // No ETag nor Last-Modified (`Cache-Control: no-store`): a conditional GET would not help.
    return [{ url: mapViewUrl(source), conditional: false }];
  },

  parse(source, bodies, now = new Date()): ParseResult {
    const listings: CanonicalListing[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    const warnings: string[] = [];
    const body = bodies[0];

    if (!body || body.status !== 200) {
      warnings.push(`listings unavailable (status ${body?.status ?? "no response"})`);
      return { listings, skipped, warnings, partial: true };
    }

    const root = parseHtml(body.text);
    const objects = extractMapObjects(root);
    if (!objects) {
      warnings.push(`no ${OBJECTS_JSON_SELECTOR} in the map view (markup drift?)`);
      return { listings, skipped, warnings, partial: true };
    }

    const regions = parseRegionGroups(root);
    const seen = new Set<string>();
    for (const raw of objects) {
      const result = toListing(source, raw, now, regions);
      if ("skip" in result) {
        skipped.push({ id: listingIdFromLink(str(raw.link)) ?? "?", reason: result.skip });
        continue;
      }
      if (seen.has(result.listing.sourceListingId)) {
        skipped.push({ id: result.listing.sourceListingId, reason: "duplicate" });
        continue;
      }
      seen.add(result.listing.sourceListingId);
      listings.push(result.listing);
      warnings.push(...result.warnings);
    }

    // The page's own counter says how many objects the payload should hold.
    const total = extractResultCount(body.text);
    let partial = false;
    if (total === null) {
      warnings.push("no results counter (markup drift?)");
      partial = objects.length === 0;
    } else if (total > objects.length) {
      warnings.push(`counter says ${total} results but the payload has ${objects.length}`);
      partial = true;
    }

    return { listings, skipped, warnings, partial };
  },

  enrich: {
    plan(_source, listing): FetchPlan {
      return { url: listing.url };
    },

    parse(_source, listing, body): EnrichResult {
      const warnings: string[] = [];
      const patch: EnrichPatch = {};
      if (body.status !== 200) {
        warnings.push(`detail ${listing.sourceListingId}: status ${body.status}`);
        return { patch, warnings };
      }
      const root = parseHtml(body.text);

      // Application deep link to the DĀK portal, published by the source itself.
      const applyHref = root
        .querySelectorAll('a[href*="mijndak.nl"]')
        .map((a) => clean(a.getAttribute("href")))
        .find((href): href is string => href !== null && MIJNDAK_RE.test(href));
      if (applyHref) {
        const idInLink = /PublicatieId=(\d+)/i.exec(applyHref)?.[1];
        // Accept the link only if it points at THIS listing: never send the user to the wrong home.
        if (idInLink === listing.sourceListingId) patch.applyUrl = applyHref;
        else
          warnings.push(`detail ${listing.sourceListingId}: WoningNet link points to ${idInLink}`);
      } else {
        warnings.push(`detail ${listing.sourceListingId}: no WoningNet application link`);
      }

      const kenmerken = parseKenmerken(root);
      if (kenmerken.size === 0) {
        warnings.push(`detail ${listing.sourceListingId}: no property-list (markup drift?)`);
      }
      const year = toIntOrNull(kenmerken.get("bouwjaar"));
      if (year && year > 1000 && year < 2100) patch.constructionYear = year;

      const soortBouw = kenmerken.get("soort bouw");
      if (soortBouw) patch.isNewBuild = /nieuwbouw/i.test(soortBouw);

      const rooms = toIntOrNull(kenmerken.get("aantal kamers"));
      if (rooms !== null) patch.rooms = rooms;

      const area = kenmerken.get("totale oppervlakte");
      if (area) {
        const n = Number((/(\d+(?:[.,]\d+)?)/.exec(area)?.[1] ?? "").replace(",", "."));
        if (Number.isFinite(n) && n > 0) patch.areaM2 = n;
      }

      const label = kenmerken.get("energielabel");
      if (label && /^[A-G](\+{1,4})?$/i.test(label)) patch.energyLabel = label.toUpperCase();

      const { postcode, conflict } = inferPostcode(body.text);
      if (conflict) {
        warnings.push(`detail ${listing.sourceListingId}: conflicting postcode anchors`);
      } else if (postcode) {
        patch.address = { postcode };
      }

      const description = htmlToText(root.querySelector(".content--woningnet"));
      if (description) patch.description = description;

      const notices: string[] = [];
      if (/onder voorbehoud/i.test(body.text)) {
        notices.push("Woningkenmerken, energielabel en huurprijs zijn nog onder voorbehoud.");
      }
      const labels = new Set<ListingLabel>(listing.labels);
      if (/doorstromers krijgen voorrang/i.test(body.text)) {
        labels.add("doorstromers");
        notices.push("Doorstromers krijgen voorrang bij Eigen Haard.");
      }
      if (notices.length > 0) patch.notices = notices;
      if (labels.size !== listing.labels.length) patch.labels = [...labels];
      if (patch.isNewBuild) {
        const withNieuwbouw = new Set<ListingLabel>(patch.labels ?? listing.labels);
        withNieuwbouw.add("nieuwbouw");
        patch.labels = [...withNieuwbouw];
      }

      return { patch, warnings };
    },
  },
};

export default eigenHaardAdapter;
