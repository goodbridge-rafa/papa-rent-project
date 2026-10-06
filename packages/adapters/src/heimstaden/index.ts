import {
  absoluteUrl,
  CanonicalListing,
  canonicalKey,
  classifySegment,
  type DwellingCategory,
  isoDateOnly,
  type ListingLabel,
  type Municipality,
  municipalityByName,
  normalizePostcode,
  type RegistrySource,
  stableHash,
  toIntOrNull,
  toNumberOrNull,
} from "@papa/core";
import type { FetchedBody, FetchPlan, ParseResult, SourceAdapter } from "../types";

/**
 * Adapter for Heimstaden Nederland (institutional landlord, own portfolio, nationwide).
 * Source: the WordPress theme's public endpoint (`admin-ajax.php?action=hose_search`, GET, no
 * cookie or nonce) with `hose_data_detail_level=level_2`, which returns full objects. Fallback: the
 * same JSON is inline in the server-rendered HTML of `/nl/huurwoningen/` (`window.hose_objects_data`).
 * `rental_cost` is the bare rent; `extra_cost_amount` the service costs. No absolute publication
 * date (only import counters): the engine's `first_seen` is the proxy. No closing deadline. Target
 * groups (students, 55+, income requirements) only exist as free text in the description.
 */
export const HEIMSTADEN_HOME = "https://heimstaden.com/nl/";
export const HEIMSTADEN_DATA_URL =
  "https://heimstaden.com/nl/wp-admin/admin-ajax.php?action=hose_search&query_string=object_type%3Dapartments%26sort%3Dadded-desc&hose_data_detail_level=level_2";
export const HEIMSTADEN_LISTINGS_URL = "https://heimstaden.com/nl/huurwoningen/";
/** Global variable holding the inline feed on the listings page. */
export const HEIMSTADEN_INLINE_MARKER = "window.hose_objects_data";
/** Anchor of the "Reageer" CTA on the detail page (Contact Form 7). */
export const HEIMSTADEN_APPLY_ANCHOR = "#inquiry_form";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const flag = (v: unknown): boolean => v === true || v === 1 || str(v) === "1" || str(v) === "true";

function home(source: RegistrySource): string {
  // The registry's `urls.home` is the group root (→ /se/); the NL section lives under /nl/.
  const base = source.urls.listings ?? HEIMSTADEN_HOME;
  return base.endsWith("/") ? base : `${base}/`;
}

/**
 * "1.720" → 1720; "754" → 754; "1.720,50" → 1720.5; "1,720.00" → 1720; "12.5" → 12.5.
 * With both separators, the decimal one is whichever comes last. Dot only: a group of exactly
 * 3 digits is thousands (NL); otherwise decimal. Comma only: decimal (NL).
 */
export function parseNlAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = str(raw);
  if (!s) return null;
  const cleaned = s.replace(/[^\d.,]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (lastComma >= 0) normalized = cleaned.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) normalized = cleaned.replace(/\./g, "");
  else normalized = cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const NL_MONTHS: Record<string, number> = {
  januari: 1,
  jan: 1,
  februari: 2,
  feb: 2,
  maart: 3,
  mrt: 3,
  april: 4,
  apr: 4,
  mei: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  augustus: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

/** "2026-02-31" → null: the date must exist in the calendar. */
function validIsoDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return isoDateOnly(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
}

/**
 * "1 mei, 2026" → "2026-05-01"; "25 augustus 2026" → "2026-08-25"; ISO and dd-mm-yyyy accepted;
 * non-existent dates ("31 februari, 2026") and other text → null.
 */
export function parseDutchDate(raw: string | null | undefined): string | null {
  const s = str(raw);
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso?.[1] && iso[2] && iso[3])
    return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const nl = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/i.exec(s);
  if (nl?.[1] && nl[2] && nl[3]) {
    const month = NL_MONTHS[nl[2].toLowerCase()];
    if (!month) return null;
    return validIsoDate(Number(nl[3]), month, Number(nl[1]));
  }
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy?.[1] && dmy[2] && dmy[3])
    return validIsoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return null;
}

/**
 * "Lindelaan 88 " → { street: "Lindelaan", houseNumber: "88", addition: null };
 * "Voorbeeldstraat 546 H3" → { …, houseNumber: "546", addition: "H3" }; "Plein 1940 12" → no. 12.
 * `houseNumberField`/`flatNumber` (the source's own fields) take precedence when filled.
 */
export function splitAddress(
  streetAddress: string | null | undefined,
  houseNumberField?: string | null,
  flatNumber?: string | null,
): { street: string | null; houseNumber: string | null; addition: string | null } {
  const s = str(streetAddress)?.replace(/\s+/g, " ") ?? null;
  const explicitNr = str(houseNumberField);
  const explicitAdd = str(flatNumber);
  if (!s) return { street: null, houseNumber: explicitNr, addition: explicitAdd };
  // Greedy street: the last digit block before a short addition is the number ("Plein 1940 12").
  const m = /^(.+)\s+(\d+)\s*[-/]?\s*([A-Za-z][A-Za-z0-9]{0,4}|\d{1,3})?$/.exec(s);
  if (!m?.[1] || !m[2]) return { street: s, houseNumber: explicitNr, addition: explicitAdd };
  return {
    street: str(m[1]),
    houseNumber: explicitNr ?? str(m[2]),
    addition: explicitAdd ?? str(m[3]),
  };
}

/** Common names that differ from the official municipality name in core's geo data. */
const CITY_ALIASES: Record<string, string> = {
  "den haag": "'s-Gravenhage",
  "the hague": "'s-Gravenhage",
  "den bosch": "'s-Hertogenbosch",
};

export function lookupMunicipality(name: string | null | undefined): Municipality | undefined {
  const s = str(name);
  if (!s) return undefined;
  return municipalityByName(CITY_ALIASES[s.toLowerCase()] ?? s);
}

/** Particles that stay lower-case inside a place name ("Capelle aan den IJssel"). */
const CITY_PARTICLES = new Set([
  "aan",
  "bij",
  "de",
  "den",
  "der",
  "en",
  "het",
  "in",
  "op",
  "ter",
  "van",
]);
const capitalize = (part: string): string => {
  if (part.startsWith("ij")) return `IJ${part.slice(2)}`;
  if (part.startsWith("'s-")) return `'s-${capitalize(part.slice(3))}`;
  return part.charAt(0).toUpperCase() + part.slice(1);
};

/** "BREDA" → "Breda"; "DEN HAAG" → "Den Haag"; "Blaricum" → "Blaricum"; "'S-GRAVENHAGE" → "'s-Gravenhage". */
export function normalizeCity(raw: string | null | undefined): string | null {
  const s = str(raw);
  if (!s) return null;
  const official = municipalityByName(s);
  if (official) return official.name;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) =>
      word
        .split("-")
        .map((part, j) => (i > 0 && j === 0 && CITY_PARTICLES.has(part) ? part : capitalize(part)))
        .join("-"),
    )
    .join(" ");
}

export function mapDwellingCategory(label: string | null): DwellingCategory {
  if (!label) return "other";
  const n = label.toLowerCase();
  if (/zorg|senior/.test(n)) return "senior";
  if (n.includes("studio")) return "studio";
  if (n.includes("kamer")) return "room";
  if (
    /appartement|apartment|penthouse|maisonn?ette|flat|bovenwoning|benedenwoning|portiek|galerij/.test(
      n,
    )
  )
    return "apartment";
  if (/eengezins|woning|villa|bungalow|kap|hoek|tussen|vrijstaand|house/.test(n)) return "house";
  return "other";
}

const NOT_DWELLING = /parkeer|parking|garage|berging|opslag|kantoor|bedrijf|winkel|commerc|office/i;

/** `publish_status`: only "published" has been observed. Any other state cannot be applied to. */
export function statusSkipReason(status: string | null): string | null {
  if (status === null) return null;
  const s = status.toLowerCase();
  if (s === "published" || s === "publish") return null;
  if (/verhuurd|rented|let\b/.test(s)) return "rented";
  if (/gereserveerd|reserved|optie|option/.test(s)) return "reserved";
  return "unpublished";
}

/** "A+++" → "A+++"; "a" → "A"; garbage → null. */
export function normalizeEnergyLabel(raw: string | null): string | null {
  const s = raw?.replace(/\s+/g, "").toUpperCase() ?? "";
  return /^[A-G]\+{0,5}$/.test(s) ? s : null;
}

/** Short rules for structured fields (type, `labels[]`), where "student" is unambiguous. */
const TYPE_LABEL_RULES: Array<[RegExp, ListingLabel]> = [
  [/\b(55|60|65|70)\s*\+|senior/i, "senioren"],
  [/jongeren/i, "jongeren"],
  [/student/i, "student"],
  [/nieuwbouw/i, "nieuwbouw"],
  [/sleutelberoep/i, "sleutelberoepen"],
  [/nultrede|rollator|rolstoel/i, "nultreden"],
];

/**
 * Explicit patterns for free text (description): only unambiguous target-group wording, so that
 * "studentenstad" or "seniorvriendelijke buurt" are not labelled.
 */
export const TEXT_RULES: Array<{ re: RegExp; label: ListingLabel | null; group: string | null }> = [
  {
    re: /studenten(kamer|woning|huisvesting|complex)|(uitsluitend|alleen|speciaal|exclusief)\s+voor\s+studenten/i,
    label: "student",
    group: "studenten",
  },
  {
    re: /minimale leeftijd van\s*(\d{2})\s*jaar|\b(55|60|65|70)\s*\+|\b(55|60|65|70)\s*jaar (of|en) ouder|vanaf\s*(55|60|65|70)\s*jaar|\bsenioren\b/i,
    label: "senioren",
    group: null,
  },
  { re: /\bjongeren(woning|huisvesting|contract)?\b/i, label: "jongeren", group: "jongeren" },
  {
    re: /inkomenseis|bruto (maand|jaar)inkomen[^.!\n]*(keer|maal|x)\b/i,
    label: null,
    group: null,
  },
  { re: /doelgroep[^.!\n]*huishoudens/i, label: null, group: null },
  {
    // Temporary contract ("voor maximaal 12 maanden"); not the deposit "maximaal 2 maanden".
    re: /(voor|huurperiode van|contract van)\s*(maximaal|max\.?)\s*\d{1,2}\s*maanden|tijdelijk(e)?\s+(huur)?contract/i,
    label: null,
    group: null,
  },
];

/** Sentences per rule kept as notices; avoids repeating long boilerplate. */
const MAX_NOTICES_PER_RULE = 3;
const MIN_AGE_RE =
  /minimale leeftijd van\s*(\d{2})\s*jaar|vanaf\s*(\d{2})\s*jaar|\b(\d{2})\s*\+|\b(\d{2})\s*jaar (?:of|en) ouder/i;

/** The sentence (delimited by . ! ? or a line break) containing `index`, cleaned and short. */
export function sentenceAt(text: string, index: number): string {
  let start = index;
  while (start > 0 && !/[.!?\n]/.test(text[start - 1] ?? "")) start--;
  let end = index;
  while (end < text.length && !/[.!?\n]/.test(text[end] ?? "")) end++;
  return text
    .slice(start, end)
    .replace(/\*+/g, " ")
    .replace(/^[\s:;,-]+|[\s:;,-]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

/** Text without HTML, untruncated (for matching); `description` is the first 2000 characters. */
export function cleanText(html: string | null): string | null {
  if (!html) return null;
  const t = html
    .replace(/<\/(p|li|div|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return t === "" ? null : t;
}

/** Picks the smallest `srcset` variant (576w = `xs`); otherwise the hero. Hotlink only, never copy. */
export function pickThumbnail(
  srcset: string | null,
  hero: string | null,
  base: string,
): string | null {
  let best: { url: string; w: number } | null = null;
  for (const entry of (srcset ?? "").split(",")) {
    const m = /^\s*(\S+)\s+(\d+)w\s*$/.exec(entry);
    if (!m?.[1] || !m[2]) continue;
    const w = Number(m[2]);
    if (!best || w < best.w) best = { url: m[1], w };
  }
  return absoluteUrl(base, best?.url ?? hero);
}

/**
 * Reads the balanced JSON object starting at `text[start]` (must be "{"), honouring strings and
 * escapes: the equivalent of `raw_decode`. Returns null if it never closes.
 */
export function readJsonObject(text: string, start: number): string | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Extracts `window.hose_objects_data = {…};` from the listings HTML. */
export function extractInlineFeed(html: string): unknown {
  const at = html.indexOf(HEIMSTADEN_INLINE_MARKER);
  if (at < 0) return null;
  const eq = html.indexOf("=", at + HEIMSTADEN_INLINE_MARKER.length);
  if (eq < 0) return null;
  const start = html.indexOf("{", eq);
  if (start < 0) return null;
  const raw = readJsonObject(html, start);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface Feed {
  objects: unknown[];
  total: number | null;
}

/** Accepts the `hose_search` JSON or the listings HTML with the inline feed. */
export function extractFeed(body: FetchedBody): { feed: Feed } | { error: string } {
  if (body.status !== 200) return { error: `HTTP ${body.status}` };
  const text = body.text.trim();
  if (text === "") return { error: "empty body" };
  const looksJson = text.startsWith("{") || text.startsWith("[");
  let json: unknown = null;
  let via = "hose_search JSON";
  if (looksJson) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      return { error: `invalid JSON: ${String(err).slice(0, 120)}` };
    }
  } else if (text === "0" || text === "-1") {
    // admin-ajax answers "0" to unknown actions: the `hose_search` action was renamed.
    return { error: `admin-ajax returned "${text}" (action hose_search unknown? schema drift)` };
  } else if (text.includes(HEIMSTADEN_INLINE_MARKER)) {
    via = "inline hose_objects_data";
    json = extractInlineFeed(text);
    if (json === null) return { error: "inline hose_objects_data present but not parseable" };
  } else {
    return {
      error: "body is neither hose_search JSON nor listings HTML with inline hose_objects_data",
    };
  }
  const objects = obj(json).objects;
  if (!Array.isArray(objects)) return { error: `${via} has no \`objects\` array (schema drift?)` };
  return { feed: { objects, total: toIntOrNull(obj(json).total_nr_of_objects) } };
}

/** Drops the import counters, which change on every run even when the listing did not. */
function stableView(item: Obj): Obj {
  const { latest_import: _li, ...rest } = item;
  if (Array.isArray(rest.images)) {
    rest.images = rest.images.map((im) => {
      const { latest_import: _x, ...keep } = obj(im);
      return keep;
    });
  }
  return rest;
}

export function parseHeimstadenItem(
  source: RegistrySource,
  item: Obj,
  now: Date,
  warn: (msg: string) => void,
): { listing: CanonicalListing } | { skip: string } {
  const id = str(item.rental_object_id);
  if (!id) return { skip: "no_id" };

  const status = str(item.publish_status);
  if (status === null) warn(`item ${id}: no publish_status (schema drift?)`);
  const skip = statusSkipReason(status);
  if (skip) return { skip };

  const mainType = str(item.hose_main_type);
  if (mainType && mainType.toLowerCase() !== "living") return { skip: "not_dwelling" };
  const typeText = str(item.object_type_text) ?? str(item.tracking_object_type);
  if (typeText && NOT_DWELLING.test(typeText)) return { skip: "not_dwelling" };

  const base = home(source);
  const permalink = absoluteUrl(base, str(item.permalink));
  if (!permalink) {
    warn(`item ${id}: no permalink (schema drift?)`);
    return { skip: "no_url" };
  }
  // The server 301s to the trailing-slash version: avoid the redirect.
  const url = permalink.endsWith("/") ? permalink : `${permalink}/`;
  const applyUrl = `${url}${HEIMSTADEN_APPLY_ANCHOR}`;

  const { street, houseNumber, addition } = splitAddress(
    str(item.street_address) ?? str(item.object_short_name),
    str(item.house_number),
    str(item.flat_number),
  );
  const postcode = normalizePostcode(str(item.postal_code) ?? str(item.area_id));
  const locationParts = (str(item.location) ?? "").split("/").map((p) => p.trim());
  const cityRaw = str(item.city) ?? str(item.area_name) ?? str(locationParts[0]);
  const municipality =
    lookupMunicipality(cityRaw) ?? lookupMunicipality(locationParts[1] ?? locationParts[0]);
  const city = normalizeCity(cityRaw);

  const rent = parseNlAmount(item.rental_cost);
  const priceNet = rent !== null && rent > 0 ? rent : null;
  if (priceNet === null) warn(`item ${id}: no rental_cost`);
  const service = parseNlAmount(item.extra_cost_amount);
  const serviceCosts = service !== null && service >= 0 ? service : null;
  const priceTotal =
    priceNet !== null && serviceCosts !== null
      ? Math.round((priceNet + serviceCosts) * 100) / 100
      : null;
  const seg = classifySegment({ priceNet, at: now });

  const lat = toNumberOrNull(item.latitude);
  const lng = toNumberOrNull(item.longitude);
  const rooms = toIntOrNull(item.rooms) ?? toIntOrNull(item.rooms_value);
  const area = toNumberOrNull(item.size_main);
  const builtYear = toIntOrNull(item.building_built_year);
  let floor = toIntOrNull(item.floor);
  if (floor === null && flag(item.is_on_ground_floor)) floor = 0;

  const availableRaw = str(item.available_from_date);
  const availableFrom = parseDutchDate(availableRaw);
  if (availableRaw && !availableFrom)
    warn(`item ${id}: unparseable available_from_date "${availableRaw}"`);

  const labels = new Set<ListingLabel>();
  const targetGroups: string[] = [];
  const notices = new Set<string>();
  const rawLabels = Array.isArray(item.labels) ? item.labels : [];
  for (const l of rawLabels) {
    const text = str(l) ?? str(obj(l).name) ?? str(obj(l).text) ?? str(obj(l).label);
    if (!text) continue;
    targetGroups.push(text);
    for (const [re, label] of TYPE_LABEL_RULES) if (re.test(text)) labels.add(label);
  }
  for (const [re, label] of TYPE_LABEL_RULES) if (typeText && re.test(typeText)) labels.add(label);

  // Target groups only exist as free text: explicit patterns, the sentence becomes a notice.
  const fullText = cleanText(str(item.description)) ?? cleanText(str(item.short_description));
  let minAge: number | null = null;
  if (fullText) {
    for (const rule of TEXT_RULES) {
      let hits = 0;
      for (const m of fullText.matchAll(new RegExp(rule.re.source, "gi"))) {
        if (hits++ >= MAX_NOTICES_PER_RULE) break;
        if (rule.label) labels.add(rule.label);
        if (rule.group && !targetGroups.includes(rule.group)) targetGroups.push(rule.group);
        const sentence = sentenceAt(fullText, m.index);
        if (sentence) notices.add(sentence);
        if (rule.label === "senioren" && minAge === null) {
          const age = MIN_AGE_RE.exec(sentence);
          const n = toIntOrNull(age?.[1] ?? age?.[2] ?? age?.[3] ?? age?.[4]);
          if (n !== null && n > 0) minAge = n;
        }
      }
    }
  }
  if (minAge !== null && !targetGroups.includes(`${minAge}+`)) targetGroups.push(`${minAge}+`);
  if (flag(item.has_property_furnished)) notices.add("Gemeubileerd");
  const showing = str(item.showing_comment);
  if (showing) notices.add(showing.slice(0, 300));

  const thumbnail = pickThumbnail(str(item.hero_image_srcset), str(item.hero_image_url), base);
  const title =
    street && houseNumber
      ? `${street} ${houseNumber}${addition ? ` ${addition}` : ""}${city ? `, ${city}` : ""}`
      : (str(item.real_estate_name) ?? str(item.object_short_name) ?? id);

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
    applyUrl,
    title,
    segment: seg.segment,
    segmentReason: seg.reason,
    // Apply via a form, selection by the landlord, no registration or deadline.
    allocationModel: "direct" as const,
    closesAfterFirstReaction: false,
    priceNet,
    priceTotal,
    serviceCosts,
    address: {
      street,
      houseNumber,
      houseNumberAddition: addition,
      postcode,
      city,
      municipality: municipality?.name ?? null,
      province: municipality?.province ?? null,
      country: "NL",
    },
    location:
      lat !== null && lng !== null && Math.abs(lat) > 1 && Math.abs(lng) > 1 ? { lat, lng } : null,
    rooms: rooms !== null && rooms > 0 ? rooms : null,
    // The source only gives "kamers" (living room included); bedrooms are not inferred.
    bedrooms: null,
    areaM2: area !== null && area > 0 ? area : null,
    dwellingType: typeText,
    dwellingCategory: mapDwellingCategory(typeText),
    energyLabel: normalizeEnergyLabel(str(item.energy_label)),
    constructionYear: builtYear !== null && builtYear > 0 ? builtYear : null,
    floor,
    availableFrom,
    availableFromText: str(item.available_from_date_text) ?? availableRaw,
    // Only relative import counters (`first_import`), no timestamp: the engine uses first_seen.
    publishedAt: null,
    closesAt: null,
    labels: [...labels],
    targetGroups,
    operator: { code: null, name: source.name },
    // No account, registration or fee: a form on the page itself.
    registrationRequired: source.registration?.required_to_react ?? false,
    huurtoeslagPossible: null,
    // Only the smallest thumbnail URL; never copy files.
    photos: [],
    thumbnail,
    isNewBuild: labels.has("nieuwbouw"),
    isExchange: false,
    notices: [...notices],
    eligibility:
      minAge !== null
        ? {
            minIncome: null,
            maxIncome: null,
            minAge,
            maxAge: null,
            minHousehold: null,
            maxHousehold: null,
            localBindingPriority: null,
          }
        : null,
    reactionsCount: null,
    description: fullText ? fullText.slice(0, 2000) : null,
    rawHash: stableHash(stableView(item)),
  };
  return { listing: CanonicalListing.parse(candidate) };
}

function listingsPlan(source: RegistrySource): FetchPlan {
  return {
    url: source.urls.listings ?? HEIMSTADEN_LISTINGS_URL,
    headers: { accept: "text/html" },
    conditional: false,
  };
}

/** One body → result; `error` when the body holds no feed. */
function parseBody(
  source: RegistrySource,
  body: FetchedBody,
  now: Date,
): { result: ParseResult } | { error: string } {
  const r = extractFeed(body);
  if ("error" in r) return { error: `${body.url}: ${r.error}` };
  const result: ParseResult = { listings: [], skipped: [], warnings: [], partial: false };
  const { objects, total } = r.feed;
  if (objects.length === 0) result.warnings.push("feed returned 0 objects");
  if (total !== null && total !== objects.length) {
    // Only part of the feed arrived: the engine must not mark absent listings as removed.
    result.partial = true;
    result.warnings.push(
      `total_nr_of_objects ${total} != ${objects.length} objects returned (pagination/truncation?)`,
    );
  }
  const warn = (msg: string) => result.warnings.push(msg);
  for (const raw of objects) {
    const item = obj(raw);
    const id = str(item.rental_object_id) ?? "?";
    try {
      const p = parseHeimstadenItem(source, item, now, warn);
      if ("skip" in p) result.skipped.push({ id, reason: p.skip });
      else result.listings.push(p.listing);
    } catch (err) {
      result.warnings.push(`item ${id}: ${String(err).slice(0, 200)}`);
    }
  }
  return { result };
}

export const heimstadenAdapter: SourceAdapter = {
  id: "heimstaden",
  plan(source): FetchPlan[] {
    return [
      {
        url: source.urls.data ?? HEIMSTADEN_DATA_URL,
        // No ETag/Last-Modified at the source (cache-control: no-cache, x-proxy-cache: BYPASS): a
        // conditional GET would never return 304.
        conditional: false,
        headers: { accept: "application/json" },
      },
    ];
  },
  /**
   * If the primary body yields no listing (renamed action → "0", `level_1` shape without
   * permalinks, `objects: []`), request the listings HTML, which carries the feed inline.
   */
  planMore(source, bodies): FetchPlan[] {
    for (const body of bodies) {
      const r = parseBody(source, body, new Date());
      if ("result" in r && r.result.listings.length > 0) return [];
    }
    return [listingsPlan(source)];
  },
  parse(source, bodies, now = new Date()) {
    if (bodies.length === 0) return { listings: [], skipped: [], warnings: ["no body"] };
    const parsed = bodies.map((body) => parseBody(source, body, now));
    const pick = parsed.findIndex((p) => "result" in p && p.result.listings.length > 0);
    // First body with listings; else the first with a feed; else only the errors.
    const idx = pick >= 0 ? pick : parsed.findIndex((p) => "result" in p);
    if (idx < 0) {
      return {
        listings: [],
        skipped: [],
        warnings: parsed.map((p) => ("error" in p ? p.error : "")).filter((e) => e !== ""),
      };
    }
    const chosen = parsed[idx];
    if (!chosen || !("result" in chosen)) return { listings: [], skipped: [], warnings: [] };
    const result = chosen.result;
    // An earlier body failed or came back empty and the fallback was used: a drift signal, even with listings.
    const preceding = parsed.slice(0, idx).map((p, i) => {
      if ("error" in p) return p.error;
      return `${bodies[i]?.url ?? "?"}: ${p.result.warnings[0] ?? "no listings"}`;
    });
    result.warnings.unshift(...preceding.map((e) => `primary body failed, used fallback: ${e}`));
    return result;
  },
};
