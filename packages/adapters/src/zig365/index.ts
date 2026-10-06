import {
  type AllocationModel,
  absoluteUrl,
  amsterdamLocalToIso,
  CanonicalListing,
  canonicalKey,
  classifySegment,
  type DwellingCategory,
  isoDateOnly,
  type ListingLabel,
  normalizePostcode,
  type RegistrySource,
  stableHash,
  toIntOrNull,
  toNumberOrNull,
} from "@papa/core";
import type { EnrichResult, FetchedBody, FetchPlan, ParseResult, SourceAdapter } from "../types";

/**
 * Adapter for housing portals built on the Zig365 platform (one adapter, many regional portals).
 * Source: the portal's own public JSON endpoint, no login (the same data the site displays).
 */
export const ZIG_FEED_PATH = "portal/object/frontend/getallobjects/format/json";
export const ZIG_DETAIL_PATH = "portal/object/frontend/getobject/format/json";
const DEFAULT_LISTINGS_SECTION = "aanbod/nu-te-huur/te-huur";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/**
 * Origin of the Zig portal. Some operators host the portal on their own subdomain (e.g.
 * example.nl → woningaanbod.example.nl): when `urls.data` or `urls.listings` is set, the origin
 * comes from there.
 */
function home(source: RegistrySource): string {
  const portal = source.urls.data ?? source.urls.listings;
  if (portal) {
    try {
      return `${new URL(portal).origin}/`;
    } catch {
      /* fall back to urls.home */
    }
  }
  return source.urls.home.endsWith("/") ? source.urls.home : `${source.urls.home}/`;
}

function listingsBase(source: RegistrySource): string {
  const base = source.urls.listings ?? `${home(source)}${DEFAULT_LISTINGS_SECTION}`;
  return base.replace(/\/+$/, "");
}

export function mapAllocationModel(code: string | null): AllocationModel {
  if (!code) return "unknown";
  const c = code.toLowerCase();
  if (c.includes("motivatie")) return "motivatie";
  if (c.includes("random") || c.includes("loting")) return "loting";
  if (c.includes("reactiedatum") || c.includes("direct") || c.includes("dth")) return "direct";
  if (c.includes("optie")) return "optie";
  if (c.includes("punten")) return "punten";
  if (c.includes("inschrijfduur") || c.includes("cooptatie")) return "inschrijfduur";
  return "unknown";
}

export function mapEnergyLabel(icon: string | null, id: string | null): string | null {
  if (icon) {
    const m = /icon_label_([a-g])((?:_plus)*)/.exec(icon);
    if (m?.[1]) return `${m[1].toUpperCase()}${"+".repeat((m[2] ?? "").split("_plus").length - 1)}`;
  }
  const byId: Record<string, string> = {
    "1": "A",
    "2": "B",
    "3": "C",
    "4": "D",
    "5": "E",
    "6": "F",
    "7": "G",
    "10": "A+",
    "11": "A++",
  };
  return id ? (byId[id] ?? null) : null;
}

export function mapDwellingCategory(name: string | null): DwellingCategory {
  if (!name) return "other";
  const n = name.toLowerCase();
  if (n.includes("senior")) return "senior";
  if (n.includes("studio")) return "studio";
  if (n.includes("kamer")) return "room";
  if (/appartement|bovenwoning|benedenwoning|portiek|galerij|maisonnette|flat|penthouse/.test(n))
    return "apartment";
  if (/woning|bungalow|villa|kap|hoek|tussen|vrijstaand|eengezins/.test(n)) return "house";
  return "other";
}

const LABEL_RULES: Array<[RegExp, ListingLabel]> = [
  [/\b(55|60|65|70)\s*\+|senior/i, "senioren"],
  [/jongeren/i, "jongeren"],
  [/student/i, "student"],
  [/grote gezinnen|minimaal \d+ personen|grotere woning/i, "grote_gezinnen"],
  [/doorstrom|van groot naar beter/i, "doorstromers"],
  [/sleutelberoep|cruciale beroep|vitale beroep/i, "sleutelberoepen"],
  [/nultrede|rollator|rolstoel/i, "nultreden"],
  [/urgentie/i, "urgentie"],
  [/nieuwbouw/i, "nieuwbouw"],
  [/woningruil/i, "woningruil"],
  [/kernbinding|lokale binding|maatschappelijke binding|economische binding/i, "voorrang_lokaal"],
  [/motivatie/i, "motivatie_gevraagd"],
];

function labelsFromText(text: string, into: Set<ListingLabel>) {
  for (const [re, label] of LABEL_RULES) if (re.test(text)) into.add(label);
}

function stripHtml(html: string | null): string | null {
  if (!html) return null;
  const t = html
    .replace(/<\/(p|li|div|br|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return t === "" ? null : t.slice(0, 2000);
}

export function parseZigItem(
  source: RegistrySource,
  item: Obj,
  now: Date,
): { listing: CanonicalListing } | { skip: string } {
  const id = str(item.id);
  if (!id) return { skip: "no_id" };
  if (item.isGepubliceerd === false) return { skip: "unpublished" };
  if (str(item.rentBuy) !== "Huur") return { skip: "not_rent" };
  const dwellingType = obj(item.dwellingType);
  if (str(dwellingType.categorie) && str(dwellingType.categorie) !== "woning")
    return { skip: "not_dwelling" };

  const street = str(item.street);
  const houseNumber = str(item.houseNumber);
  const addition = str(item.houseNumberAddition);
  const city = str(obj(item.city).name);
  const municipality = str(obj(item.municipality).name);
  const postcode = normalizePostcode(str(item.postalcode));
  const urlKey = str(item.urlKey) ?? id;
  const url = `${listingsBase(source)}/details/${urlKey}`;
  const priceNet = toNumberOrNull(item.netRent);
  const priceTotal = toNumberOrNull(item.totalRent);
  const model = obj(item.model);
  const modelCode = str(obj(model.modelCategorie).code);
  const seg = classifySegment({ priceNet: priceNet && priceNet > 0 ? priceNet : null, at: now });
  const typeName = str(dwellingType.localizedName);
  const energy = obj(item.energyLabel);
  const lat = toNumberOrNull(item.latitude);
  const lng = toNumberOrNull(item.longitude);
  const targetGroups = (Array.isArray(item.doelgroepen) ? item.doelgroepen : [])
    .map((d) => str(obj(d).code) ?? str(obj(d).id))
    .filter((x): x is string => x !== null);
  const notices: string[] = [];
  const actionLabel = str(obj(item.actionLabel).localizedLabel);
  if (actionLabel) notices.push(actionLabel);
  const infoKort = stripHtml(str(item.infoveldKort));
  if (infoKort) notices.push(infoKort);

  const labels = new Set<ListingLabel>();
  for (const g of targetGroups) {
    if (g === "55_plus") labels.add("senioren");
    if (g === "nultrede") labels.add("nultreden");
  }
  labelsFromText([typeName ?? "", ...notices].join(" | "), labels);
  if (item.newlyBuild === true) labels.add("nieuwbouw");
  if (item.isWoningruil === true) labels.add("woningruil");
  if (model.isHospiteren === true) labels.add("motivatie_gevraagd");

  const pictures = (Array.isArray(item.pictures) ? item.pictures : [])
    .map((p) => absoluteUrl(home(source), str(obj(p).uri)))
    .filter((x): x is string => x !== null);

  const candidate = {
    sourceSlug: source.slug,
    sourceListingId: id,
    canonicalKey: canonicalKey({
      postcode,
      houseNumber,
      houseNumberAddition: addition,
      fallback: `${source.slug}:${id}`,
    }),
    url,
    applyUrl: absoluteUrl(home(source), str(item.reactieUrl)) ?? url,
    title:
      street && houseNumber
        ? `${street} ${houseNumber}${addition ?? ""}${city ? `, ${city}` : ""}`
        : urlKey,
    segment: seg.segment,
    segmentReason: seg.reason,
    allocationModel: mapAllocationModel(modelCode),
    closesAfterFirstReaction: model.advertentieSluitenNaEersteReactie === true,
    priceNet: priceNet && priceNet > 0 ? priceNet : null,
    priceTotal: priceTotal && priceTotal > 0 ? priceTotal : null,
    serviceCosts: null,
    address: {
      street,
      houseNumber,
      houseNumberAddition: addition,
      postcode,
      city,
      municipality,
      province: source.provinces.length === 1 ? (source.provinces[0] ?? null) : null,
      country: "NL",
    },
    location: lat && lng && Math.abs(lat) > 1 && Math.abs(lng) > 1 ? { lat, lng } : null,
    rooms: null,
    bedrooms: toIntOrNull(obj(item.sleepingRoom).amountOfRooms),
    areaM2: (toNumberOrNull(item.areaDwelling) ?? 0) > 0 ? toNumberOrNull(item.areaDwelling) : null,
    dwellingType: typeName,
    dwellingCategory: mapDwellingCategory(typeName),
    energyLabel: mapEnergyLabel(str(energy.icon), str(energy.id)),
    constructionYear:
      (toIntOrNull(item.constructionYear) ?? 0) > 0 ? toIntOrNull(item.constructionYear) : null,
    floor: toIntOrNull(item.floor),
    availableFrom: isoDateOnly(str(item.availableFromDate)),
    availableFromText: str(item.availableFrom),
    publishedAt: amsterdamLocalToIso(str(item.publicationDate)),
    closesAt: amsterdamLocalToIso(str(item.closingDate)),
    labels: [...labels],
    targetGroups,
    operator: { code: str(obj(item.corporation).code), name: null },
    registrationRequired: bool(item.inschrijvingVereistVoorReageren),
    huurtoeslagPossible: bool(item.huurtoeslagMogelijk),
    photos: pictures,
    thumbnail: pictures[0] ?? null,
    isNewBuild: item.newlyBuild === true || labels.has("nieuwbouw"),
    isExchange: item.isWoningruil === true,
    notices,
    eligibility: null,
    reactionsCount: null,
    description: null,
    rawHash: stableHash(item),
  };
  return { listing: CanonicalListing.parse(candidate) };
}

export const zig365Adapter: SourceAdapter = {
  id: "zig365",
  plan(source) {
    const url = source.urls.data ?? `${home(source)}${ZIG_FEED_PATH}`;
    return [{ url, conditional: true, headers: { accept: "application/json" } }];
  },
  parse(source, bodies, now = new Date()) {
    const result: ParseResult = { listings: [], skipped: [], warnings: [] };
    const body = bodies[0];
    if (!body) {
      result.warnings.push("no body");
      return result;
    }
    let json: unknown;
    try {
      json = JSON.parse(body.text);
    } catch (err) {
      result.warnings.push(`invalid JSON: ${String(err).slice(0, 120)}`);
      return result;
    }
    const items = obj(json).result;
    if (!Array.isArray(items)) {
      result.warnings.push("feed has no `result` array (schema drift?)");
      return result;
    }
    for (const raw of items) {
      const item = obj(raw);
      try {
        const r = parseZigItem(source, item, now);
        if ("skip" in r) result.skipped.push({ id: str(item.id) ?? "?", reason: r.skip });
        else result.listings.push(r.listing);
      } catch (err) {
        result.warnings.push(`item ${str(item.id) ?? "?"}: ${String(err).slice(0, 200)}`);
      }
    }
    return result;
  },
  enrich: {
    plan(source, listing): FetchPlan {
      return {
        url: `${home(source)}${ZIG_DETAIL_PATH}?id=${encodeURIComponent(listing.sourceListingId)}`,
        headers: { accept: "application/json" },
      };
    },
    parse(_source, _listing, body: FetchedBody): EnrichResult {
      let json: unknown;
      try {
        json = JSON.parse(body.text);
      } catch {
        return { patch: {}, warnings: ["invalid detail JSON"] };
      }
      const d = obj(obj(json).result);
      if (!str(d.id)) return { patch: {}, warnings: ["detail has no result.id"] };
      const service = toNumberOrNull(d.serviceCosts);
      return {
        patch: {
          serviceCosts: service !== null && service >= 0 ? service : null,
          reactionsCount: toIntOrNull(d.numberOfReactions),
          description: stripHtml(str(d.description)),
          eligibility: {
            minIncome: toNumberOrNull(d.minimumIncome) || null,
            maxIncome: toNumberOrNull(d.maximumIncome) || null,
            minAge: toIntOrNull(d.minimumAge) || null,
            maxAge: toIntOrNull(d.maximumAge) || null,
            minHousehold: toIntOrNull(d.minimumHouseholdSize) || null,
            maxHousehold: toIntOrNull(d.maximumHouseholdSize) || null,
            localBindingPriority: bool(d.voorrangKernbinding),
          },
        },
        warnings: [],
      };
    },
  },
};
