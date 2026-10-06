import { readFileSync } from "node:fs";
import { CanonicalListing, classifySegment, type RegistrySource } from "@papa/core";
import { describe, expect, it } from "vitest";
import {
  extractFeed,
  HEIMSTADEN_DATA_URL,
  heimstadenAdapter,
  lookupMunicipality,
  mapDwellingCategory,
  normalizeCity,
  normalizeEnergyLabel,
  parseDutchDate,
  parseNlAmount,
  pickThumbnail,
  readJsonObject,
  sentenceAt,
  splitAddress,
  statusSkipReason,
} from "../src/heimstaden/index";

/** Synthetic source on a fictional host; the fixture's permalinks live on the same host. */
const LISTINGS_URL = "https://huren.example.nl/nl/huurwoningen/";
const source = (data: string | null = null): RegistrySource => ({
  slug: "heimstaden",
  name: "Heimstaden Nederland",
  kind: "manager",
  stack: "bespoke",
  tier: "A",
  status: "live",
  urls: {
    home: "https://huren.example.nl/",
    listings: LISTINGS_URL,
    data,
    robots: null,
    terms: null,
  },
  regions: [],
  provinces: [],
  municipalities: [],
  segments: ["social", "midden", "free"],
  registration: {
    fee_eur: null,
    renewal_eur_per_year: null,
    required_to_react: false,
    confidence: null,
  },
  allocation_models: ["direct"],
  interval_seconds: 90,
  adapter: "heimstaden",
  research_ref: null,
  fingerprint: null,
  legal: null,
  notes: null,
});

interface Feed {
  total_nr_of_objects: number;
  objects: Array<Record<string, unknown>>;
}
/** Synthetic `hose_search` level_2 response: 5 fictional objects. */
const fixtureText = readFileSync(
  new URL("../fixtures/heimstaden/hose-search.json", import.meta.url),
  "utf8",
);
const feed = JSON.parse(fixtureText) as Feed;
const byId = (id: string) => {
  const o = feed.objects.find((x) => x.rental_object_id === id);
  if (!o) throw new Error(`fixture has no object ${id}`);
  return o;
};
const FETCHED_AT = "2026-09-06T12:00:00Z";
const body = (text: string, status = 200, url = HEIMSTADEN_DATA_URL) => ({
  url,
  status,
  contentType: "application/json; charset=utf-8",
  text,
  fetchedAt: FETCHED_AT,
});
const htmlBody = (text: string) => ({
  url: LISTINGS_URL,
  status: 200,
  contentType: "text/html; charset=UTF-8",
  text,
  fetchedAt: FETCHED_AT,
});
/** Listings page with the same feed inline, as the server-rendered fallback serves it. */
const inlineHtml = (data: unknown) =>
  `<!doctype html><html><body><div class="object-card"></div>\n<script>\n    window.hose_objects_data = ${JSON.stringify(data)};\n    var ajax_object = {"ajax_url":"https://huren.example.nl/nl/wp-admin/admin-ajax.php"};\n</script></body></html>`;
const now = new Date(FETCHED_AT);
const parseFixture = () => heimstadenAdapter.parse(source(), [body(fixtureText)], now);
const listing = (id: string) => {
  const l = parseFixture().listings.find((x) => x.sourceListingId === id);
  if (!l) throw new Error(`no listing ${id}`);
  return l;
};

const BREDA = "00000000-0000-4000-8000-000000000001";
const DEN_HAAG = "00000000-0000-4000-8000-000000000002";
const ARNHEM = "00000000-0000-4000-8000-000000000003";
const AMSTERDAM = "00000000-0000-4000-8000-000000000004";
const HEERLEN = "00000000-0000-4000-8000-000000000005";

/** One concrete expectation per listing rather than a blanket "all apartments" invariant. */
const EXPECTED: Record<
  string,
  {
    key: string;
    title: string;
    priceNet: number;
    serviceCosts: number;
    segment: "social" | "midden" | "free";
    category: "apartment" | "studio";
    city: string;
    municipality: string;
    province: string;
    rooms: number;
    areaM2: number;
    floor: number;
    energy: string;
    availableFrom: string;
    labels: string[];
    targetGroups: string[];
  }
> = {
  [BREDA]: {
    key: "4811AA-88",
    title: "Lindelaan 88, Breda",
    priceNet: 1720,
    serviceCosts: 75,
    segment: "free",
    category: "apartment",
    city: "Breda",
    municipality: "Breda",
    province: "Noord-Brabant",
    rooms: 3,
    areaM2: 95,
    floor: 0, // no floor value, but is_on_ground_floor = "1"
    energy: "A+++",
    availableFrom: "2026-10-01",
    labels: [],
    targetGroups: [],
  },
  [DEN_HAAG]: {
    key: "2511ZZ-12",
    title: "Plein 1940 12, Den Haag",
    priceNet: 1228.07,
    serviceCosts: 60,
    segment: "midden",
    category: "apartment",
    city: "Den Haag",
    municipality: "'s-Gravenhage",
    province: "Zuid-Holland",
    rooms: 2,
    areaM2: 72,
    floor: 3,
    energy: "A",
    availableFrom: "2026-11-01",
    labels: ["nieuwbouw"],
    targetGroups: ["Nieuwbouw"],
  },
  [ARNHEM]: {
    key: "6811ZZ-4-s",
    title: "Kortelaan 4 S, Arnhem",
    priceNet: 754,
    serviceCosts: 135,
    segment: "social",
    category: "studio",
    city: "Arnhem",
    municipality: "Arnhem",
    province: "Gelderland",
    rooms: 1,
    areaM2: 20,
    floor: 0,
    energy: "C",
    availableFrom: "2026-09-24",
    labels: ["student"],
    targetGroups: ["studenten"],
  },
  [AMSTERDAM]: {
    key: "1024ZZ-546-h3",
    title: "Voorbeeldstraat 546 H3, Amsterdam",
    priceNet: 1077.5,
    serviceCosts: 88,
    segment: "midden",
    category: "apartment",
    city: "Amsterdam",
    municipality: "Amsterdam",
    province: "Noord-Holland",
    rooms: 2,
    areaM2: 66,
    floor: 8,
    energy: "B",
    availableFrom: "2026-12-01",
    labels: ["senioren"],
    targetGroups: ["55+"],
  },
  [HEERLEN]: {
    key: "6411ZZ-9",
    title: "Mijnweg 9, Heerlen",
    priceNet: 932.93,
    serviceCosts: 42,
    segment: "social",
    category: "apartment",
    city: "Heerlen",
    municipality: "Heerlen",
    province: "Limburg",
    rooms: 3,
    areaM2: 80,
    floor: 1,
    energy: "A",
    availableFrom: "2026-10-15",
    labels: [],
    targetGroups: [],
  },
};

describe("heimstaden adapter", () => {
  it("plans one non-conditional GET on the hose_search level_2 endpoint", () => {
    expect(heimstadenAdapter.id).toBe("heimstaden");
    const plans = heimstadenAdapter.plan(source());
    expect(plans).toHaveLength(1);
    // The source sends no ETag/Last-Modified: a conditional GET would be pointless.
    expect(plans[0]).toEqual({
      url: HEIMSTADEN_DATA_URL,
      conditional: false,
      headers: { accept: "application/json" },
    });
    expect(HEIMSTADEN_DATA_URL).toContain("action=hose_search");
    expect(HEIMSTADEN_DATA_URL).toContain("hose_data_detail_level=level_2");
    expect(heimstadenAdapter.plan(source("https://data.example.nl/feed?x=1"))[0]?.url).toBe(
      "https://data.example.nl/feed?x=1",
    );
    expect(heimstadenAdapter.enrich).toBeUndefined();
  });

  it("parses the fixture: 5 listings, 0 skipped, 0 warnings, not partial", () => {
    expect(feed.total_nr_of_objects).toBe(5);
    const r = parseFixture();
    expect(r.warnings).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.partial).toBe(false);
    expect(r.listings.map((l) => l.sourceListingId)).toEqual([
      BREDA,
      DEN_HAAG,
      ARNHEM,
      AMSTERDAM,
      HEERLEN,
    ]);
  });

  it("maps every listing to concrete values on both sides of the rent caps", () => {
    const r = parseFixture();
    for (const l of r.listings) {
      const e = EXPECTED[l.sourceListingId];
      expect(e, l.sourceListingId).toBeDefined();
      if (!e) continue;
      expect(CanonicalListing.safeParse(l).success).toBe(true);
      expect(l.sourceSlug).toBe("heimstaden");
      expect(l.canonicalKey).toBe(e.key);
      expect(l.title).toBe(e.title);
      expect(l.priceNet).toBe(e.priceNet);
      expect(l.serviceCosts).toBe(e.serviceCosts);
      expect(l.priceTotal).toBe(Math.round((e.priceNet + e.serviceCosts) * 100) / 100);
      expect(l.segment).toBe(e.segment);
      expect(l.segment).toBe(classifySegment({ priceNet: e.priceNet, at: now }).segment);
      expect(l.dwellingCategory).toBe(e.category);
      expect(l.address.city).toBe(e.city);
      expect(l.address.municipality).toBe(e.municipality);
      expect(l.address.province).toBe(e.province);
      expect(l.address.country).toBe("NL");
      expect(l.address.postcode).toMatch(/^\d{4}[A-Z]{2}$/);
      expect(l.rooms).toBe(e.rooms);
      expect(l.areaM2).toBe(e.areaM2);
      expect(l.floor).toBe(e.floor);
      expect(l.energyLabel).toBe(e.energy);
      expect(l.availableFrom).toBe(e.availableFrom);
      expect(l.labels).toEqual(e.labels);
      expect(l.targetGroups).toEqual(e.targetGroups);
      expect(l.url.startsWith(LISTINGS_URL)).toBe(true);
      // The server 301s to the trailing-slash form; the adapter avoids the redirect.
      expect(l.url.endsWith(`${l.sourceListingId}/`)).toBe(true);
      expect(l.applyUrl).toBe(`${l.url}#inquiry_form`);
      expect(l.allocationModel).toBe("direct");
      expect(l.closesAfterFirstReaction).toBe(false);
      expect(l.registrationRequired).toBe(false);
      expect(l.publishedAt).toBeNull();
      expect(l.closesAt).toBeNull();
      expect(l.bedrooms).toBeNull();
      expect(l.location).not.toBeNull();
      expect(l.operator).toEqual({ code: null, name: "Heimstaden Nederland" });
      expect(l.photos).toEqual([]);
      expect(l.isExchange).toBe(false);
      expect(l.huurtoeslagPossible).toBeNull();
      expect(l.reactionsCount).toBeNull();
      expect(l.description).not.toMatch(/<br|<p|&nbsp;/);
      expect(l.rawHash).toHaveLength(64);
    }
    // Both rent caps are inclusive: 932.93 stays social, 1228.07 stays midden.
    expect(listing(HEERLEN).segmentReason).toMatch(/social_rent_cap/);
    expect(listing(DEN_HAAG).segmentReason).toMatch(/midden_rent_cap/);
  });

  it("maps every field of the Breda listing", () => {
    const l = listing(BREDA);
    expect(l.url).toBe(
      "https://huren.example.nl/nl/huurwoningen/BREDA-95m%C2%B2-00000000-0000-4000-8000-000000000001/",
    );
    expect(l.segmentReason).toMatch(/midden_rent_cap/);
    expect(l.address).toEqual({
      street: "Lindelaan",
      houseNumber: "88",
      houseNumberAddition: null,
      postcode: "4811AA",
      city: "Breda",
      municipality: "Breda",
      province: "Noord-Brabant",
      country: "NL",
    });
    expect(l.location).toEqual({ lat: 51.59, lng: 4.78 });
    expect(l.dwellingType).toBe("appartement / bovenwoning");
    // Smallest srcset variant wins over the hero image.
    expect(l.thumbnail).toBe("https://img.example.com/obj/0001/xs/a.jpg");
    expect(l.availableFromText).toBe("Direct");
    expect(l.constructionYear).toBeNull();
    expect(l.isNewBuild).toBe(false);
    expect(l.notices).toEqual([]);
    expect(l.eligibility).toBeNull();
    expect(l.description).toBe(
      "Ruim appartement aan de Lindelaan.\nDrie kamers en een balkon op het zuiden.",
    );
  });

  it("maps the Den Haag listing: city alias, structured labels, furnished and showing notices", () => {
    const l = listing(DEN_HAAG);
    expect(l.address.street).toBe("Plein 1940");
    expect(l.address.houseNumber).toBe("12");
    expect(l.constructionYear).toBe(1965);
    expect(l.isNewBuild).toBe(true);
    expect(l.availableFromText).toBe("Per 1 november");
    expect(l.notices).toEqual(["Gemeubileerd", "Bezichtigingen op afspraak."]);
    // A relative hero URL resolves against the listings base.
    expect(l.thumbnail).toBe("https://huren.example.nl/app/uploads/obj/0002/hero.jpg");
  });

  it("maps the Arnhem student studio: student label from explicit text, not from 'studentenstad'", () => {
    const l = listing(ARNHEM);
    expect(l.address.houseNumberAddition).toBe("S");
    expect(l.dwellingType).toBe("appartement / studio");
    expect(l.priceTotal).toBe(889);
    expect(l.notices).toEqual([
      "Studentenkamer te huur Kortelaan 4-S voor maximaal 12 maanden",
      "Per direct beschikbaar, uitsluitend voor studenten",
    ]);
    expect(l.eligibility).toBeNull();
  });

  it("reads age and income requirements from the description into notices and eligibility", () => {
    const ams = listing(AMSTERDAM);
    expect(ams.eligibility).toEqual({
      minIncome: null,
      maxIncome: null,
      minAge: 55,
      maxAge: null,
      minHousehold: null,
      maxHousehold: null,
      localBindingPriority: null,
    });
    expect(ams.notices).toEqual([
      "Voor deze woning geldt een minimale leeftijd van 55 jaar of ouder",
    ]);
    // No available_from_date_text: falls back to the raw date string.
    expect(ams.availableFromText).toBe("1 december, 2026");

    const heerlen = listing(HEERLEN);
    expect(heerlen.labels).toEqual([]);
    expect(heerlen.eligibility).toBeNull();
    expect(heerlen.notices).toEqual([
      "Wij hanteren een inkomenseis waarbij het bruto maandinkomen minimaal 3 keer de kale maandhuur bedraagt",
      "De doelgroep voor dit complex zijn een- en tweepersoonshuishoudens",
    ]);
  });

  it("skips rented, reserved, unpublished and non-dwelling objects with a reason", () => {
    const base = byId(BREDA);
    const objects = [
      { ...base, rental_object_id: "a", publish_status: "verhuurd" },
      { ...base, rental_object_id: "b", publish_status: "gereserveerd" },
      { ...base, rental_object_id: "c", publish_status: "draft" },
      { ...base, rental_object_id: "d", hose_main_type: "commercial" },
      { ...base, rental_object_id: "e", object_type_text: "parkeerplaats" },
      { ...base, rental_object_id: "" },
      { ...base, rental_object_id: "g", permalink: "" },
      base,
    ];
    const r = heimstadenAdapter.parse(
      source(),
      [body(JSON.stringify({ total_nr_of_objects: objects.length, objects }))],
      now,
    );
    expect(r.listings.map((l) => l.sourceListingId)).toEqual([BREDA]);
    expect(r.skipped).toEqual([
      { id: "a", reason: "rented" },
      { id: "b", reason: "reserved" },
      { id: "c", reason: "unpublished" },
      { id: "d", reason: "not_dwelling" },
      { id: "e", reason: "not_dwelling" },
      { id: "?", reason: "no_id" },
      { id: "g", reason: "no_url" },
    ]);
    expect(r.warnings).toEqual(["item g: no permalink (schema drift?)"]);
  });

  it("flags schema drift as warnings instead of throwing", () => {
    const drift = heimstadenAdapter.parse(source(), [body('{"foo":1}')], now);
    expect(drift.listings).toEqual([]);
    expect(drift.warnings[0]).toMatch(/schema drift/);

    const zero = heimstadenAdapter.parse(source(), [body("0")], now);
    expect(zero.listings).toEqual([]);
    expect(zero.warnings[0]).toMatch(/admin-ajax returned "0"/);

    expect(heimstadenAdapter.parse(source(), [body("{not json")], now).warnings[0]).toMatch(
      /invalid JSON/,
    );
    expect(heimstadenAdapter.parse(source(), [body("", 500)], now).warnings[0]).toBe(
      `${HEIMSTADEN_DATA_URL}: HTTP 500`,
    );
    expect(heimstadenAdapter.parse(source(), [], now).warnings).toEqual(["no body"]);

    const one = (o: Record<string, unknown>) =>
      heimstadenAdapter.parse(
        source(),
        [body(JSON.stringify({ total_nr_of_objects: 1, objects: [o] }))],
        now,
      );

    const noStatus = one({ ...byId(BREDA), publish_status: undefined });
    expect(noStatus.listings).toHaveLength(1);
    expect(noStatus.warnings).toEqual([`item ${BREDA}: no publish_status (schema drift?)`]);

    const badDate = one({ ...byId(BREDA), available_from_date: "31 februari, 2026" });
    expect(badDate.listings[0]?.availableFrom).toBeNull();
    expect(badDate.listings[0]?.availableFromText).toBe("Direct");
    expect(badDate.warnings).toEqual([
      `item ${BREDA}: unparseable available_from_date "31 februari, 2026"`,
    ]);

    const noRent = one({ ...byId(BREDA), rental_cost: "" });
    expect(noRent.listings[0]?.priceNet).toBeNull();
    expect(noRent.listings[0]?.priceTotal).toBeNull();
    expect(noRent.listings[0]?.segment).toBe("unknown");
    expect(noRent.warnings).toEqual([`item ${BREDA}: no rental_cost`]);
  });

  it("marks a truncated feed as partial and warns on an empty one", () => {
    const truncated = heimstadenAdapter.parse(
      source(),
      [body(JSON.stringify({ ...feed, total_nr_of_objects: 9 }))],
      now,
    );
    expect(truncated.listings).toHaveLength(5);
    expect(truncated.partial).toBe(true);
    expect(truncated.warnings).toEqual([
      "total_nr_of_objects 9 != 5 objects returned (pagination/truncation?)",
    ]);

    const empty = heimstadenAdapter.parse(
      source(),
      [body(JSON.stringify({ total_nr_of_objects: 0, objects: [] }))],
      now,
    );
    expect(empty.listings).toEqual([]);
    expect(empty.partial).toBe(false);
    expect(empty.warnings).toEqual(["feed returned 0 objects"]);
  });

  it("falls back to the inline hose_objects_data whenever the primary body yields no listing", () => {
    const fallbackPlan = {
      url: LISTINGS_URL,
      headers: { accept: "text/html" },
      conditional: false,
    };
    expect(heimstadenAdapter.planMore?.(source(), [body(fixtureText)])).toEqual([]);
    expect(heimstadenAdapter.planMore?.(source(), [body("0")])).toEqual([fallbackPlan]);
    expect(heimstadenAdapter.planMore?.(source(), [body(JSON.stringify({ objects: [] }))])).toEqual(
      [fallbackPlan],
    );
    // `level_1` shape (ids and coordinates only): no permalink means no listing.
    const level1 = {
      total_nr_of_objects: 5,
      objects: feed.objects.map((o) => ({
        rental_object_id: o.rental_object_id,
        latitude: o.latitude,
        longitude: o.longitude,
      })),
    };
    expect(heimstadenAdapter.planMore?.(source(), [body(JSON.stringify(level1))])).toEqual([
      fallbackPlan,
    ]);

    const r = heimstadenAdapter.parse(
      source(),
      [body(JSON.stringify(level1)), htmlBody(inlineHtml(feed))],
      now,
    );
    expect(r.listings).toHaveLength(5);
    expect(r.skipped).toEqual([]);
    expect(r.partial).toBe(false);
    expect(r.warnings).toEqual([
      `primary body failed, used fallback: ${HEIMSTADEN_DATA_URL}: item ${BREDA}: no publish_status (schema drift?)`,
    ]);
    expect(r.listings[2]?.canonicalKey).toBe("6811ZZ-4-s");

    const afterZero = heimstadenAdapter.parse(
      source(),
      [body("0"), htmlBody(inlineHtml(feed))],
      now,
    );
    expect(afterZero.listings).toHaveLength(5);
    expect(afterZero.warnings).toEqual([
      `primary body failed, used fallback: ${HEIMSTADEN_DATA_URL}: admin-ajax returned "0" (action hose_search unknown? schema drift)`,
    ]);

    const noMarker = heimstadenAdapter.parse(
      source(),
      [htmlBody("<html><body>Geen woningen</body></html>")],
      now,
    );
    expect(noMarker.listings).toEqual([]);
    expect(noMarker.warnings[0]).toMatch(/neither hose_search JSON nor listings HTML/);

    const feedOnly = extractFeed(htmlBody(inlineHtml({ objects: [] })));
    expect("feed" in feedOnly && feedOnly.feed.objects).toEqual([]);
    expect(readJsonObject('{"a":"}{","b":{"c":[1,2]}} trailing', 0)).toBe(
      '{"a":"}{","b":{"c":[1,2]}}',
    );
    expect(readJsonObject('{"a":1', 0)).toBeNull();
  });

  it("ignores import counters in rawHash but reacts to real changes", () => {
    const first = byId(BREDA);
    const parseOne = (o: Record<string, unknown>) =>
      heimstadenAdapter.parse(source(), [body(JSON.stringify({ objects: [o] }))], now).listings[0];
    const a = parseOne(first);
    const b = parseOne({
      ...first,
      latest_import: "99999",
      images: (first.images as Array<Record<string, unknown>>).map((im) => ({
        ...im,
        latest_import: "99999",
      })),
    });
    const c = parseOne({ ...first, rental_cost: "1.725" });
    expect(a?.rawHash).toBe(b?.rawHash);
    expect(a?.rawHash).not.toBe(c?.rawHash);
    expect(c?.priceNet).toBe(1725);
  });

  it("parses Dutch amounts, dates, addresses, cities and labels deterministically", () => {
    expect(parseNlAmount("1.720")).toBe(1720);
    expect(parseNlAmount("754")).toBe(754);
    expect(parseNlAmount("1.720,50")).toBe(1720.5);
    expect(parseNlAmount("1,720.00")).toBe(1720);
    expect(parseNlAmount("1,234,567.89")).toBe(1234567.89);
    expect(parseNlAmount("1720,50")).toBe(1720.5);
    expect(parseNlAmount("€ 1.234.567")).toBe(1234567);
    expect(parseNlAmount("12.5")).toBe(12.5);
    expect(parseNlAmount(75)).toBe(75);
    expect(parseNlAmount("")).toBeNull();
    expect(parseNlAmount("n.v.t.")).toBeNull();

    expect(parseDutchDate("1 mei, 2026")).toBe("2026-05-01");
    expect(parseDutchDate("25 augustus, 2026")).toBe("2026-08-25");
    expect(parseDutchDate("3 sept 2027")).toBe("2027-09-03");
    expect(parseDutchDate("29 februari, 2028")).toBe("2028-02-29");
    expect(parseDutchDate("31 februari, 2026")).toBeNull();
    expect(parseDutchDate("29 februari, 2026")).toBeNull();
    expect(parseDutchDate("2026-11-01")).toBe("2026-11-01");
    expect(parseDutchDate("2026-02-31")).toBeNull();
    expect(parseDutchDate("01-11-2026")).toBe("2026-11-01");
    expect(parseDutchDate("31-04-2026")).toBeNull();
    expect(parseDutchDate("Direct")).toBeNull();
    expect(parseDutchDate("1 foo, 2026")).toBeNull();
    expect(parseDutchDate(null)).toBeNull();

    expect(splitAddress("Lindelaan 88 ")).toEqual({
      street: "Lindelaan",
      houseNumber: "88",
      addition: null,
    });
    expect(splitAddress("Kortelaan 4 S", "", "S")).toEqual({
      street: "Kortelaan",
      houseNumber: "4",
      addition: "S",
    });
    expect(splitAddress("Voorbeeldstraat 546 H3")).toEqual({
      street: "Voorbeeldstraat",
      houseNumber: "546",
      addition: "H3",
    });
    expect(splitAddress("Plein 1940 12")).toEqual({
      street: "Plein 1940",
      houseNumber: "12",
      addition: null,
    });
    expect(splitAddress("1e Voorbeeldstraat 5-A")).toEqual({
      street: "1e Voorbeeldstraat",
      houseNumber: "5",
      addition: "A",
    });
    expect(splitAddress("Laan 12", "14", "bis")).toEqual({
      street: "Laan",
      houseNumber: "14",
      addition: "bis",
    });
    expect(splitAddress("Zonder nummer")).toEqual({
      street: "Zonder nummer",
      houseNumber: null,
      addition: null,
    });
    expect(splitAddress(null)).toEqual({ street: null, houseNumber: null, addition: null });

    expect(normalizeCity("BREDA")).toBe("Breda");
    expect(normalizeCity("DEN HAAG")).toBe("Den Haag");
    expect(normalizeCity("'S-GRAVENHAGE")).toBe("'s-Gravenhage");
    expect(normalizeCity("CAPELLE AAN DEN IJSSEL")).toBe("Capelle aan den IJssel");
    expect(normalizeCity("Heerlen")).toBe("Heerlen");
    expect(normalizeCity("")).toBeNull();
    expect(lookupMunicipality("DEN HAAG")?.name).toBe("'s-Gravenhage");
    expect(lookupMunicipality("Heerlen")?.province).toBe("Limburg");
    expect(lookupMunicipality("Nergenshuizen")).toBeUndefined();

    expect(mapDwellingCategory("appartement / studio")).toBe("studio");
    expect(mapDwellingCategory("appartement / portiekflat")).toBe("apartment");
    expect(mapDwellingCategory("appartement")).toBe("apartment");
    expect(mapDwellingCategory("eengezinswoning")).toBe("house");
    expect(mapDwellingCategory("seniorenwoning")).toBe("senior");
    expect(mapDwellingCategory("kamer")).toBe("room");
    expect(mapDwellingCategory("parkeerplaats")).toBe("other");
    expect(mapDwellingCategory(null)).toBe("other");

    expect(statusSkipReason("published")).toBeNull();
    expect(statusSkipReason(null)).toBeNull();
    expect(statusSkipReason("verhuurd")).toBe("rented");
    expect(statusSkipReason("Rented")).toBe("rented");
    expect(statusSkipReason("gereserveerd")).toBe("reserved");
    expect(statusSkipReason("draft")).toBe("unpublished");

    expect(normalizeEnergyLabel("A+++")).toBe("A+++");
    expect(normalizeEnergyLabel("b")).toBe("B");
    expect(normalizeEnergyLabel("A ++")).toBe("A++");
    expect(normalizeEnergyLabel("Z")).toBeNull();
    expect(normalizeEnergyLabel("")).toBeNull();

    expect(sentenceAt("*** LET OP! Voor deze woning geldt 55 jaar. *** Rest", 20)).toBe(
      "Voor deze woning geldt 55 jaar",
    );
    expect(sentenceAt("Eerste regel\nStudentenkamer te huur\nDerde", 15)).toBe(
      "Studentenkamer te huur",
    );

    expect(
      pickThumbnail(
        "https://x.example/md/a.jpg 992w, https://x.example/xs/a.jpg 576w, https://x.example/lg/a.jpg 1200w",
        "https://x.example/md/a.jpg",
        LISTINGS_URL,
      ),
    ).toBe("https://x.example/xs/a.jpg");
    expect(pickThumbnail(null, "/app/uploads/a.jpg", LISTINGS_URL)).toBe(
      "https://huren.example.nl/app/uploads/a.jpg",
    );
    expect(pickThumbnail(null, null, LISTINGS_URL)).toBeNull();
  });

  it("labels student and youth housing from explicit text and never from loose mentions", () => {
    const base = byId(BREDA);
    const parseWith = (description: string) =>
      heimstadenAdapter.parse(
        source(),
        [body(JSON.stringify({ objects: [{ ...base, description }] }))],
        now,
      ).listings[0];
    expect(parseWith("Deze woning is alleen voor studenten beschikbaar.")?.labels).toEqual([
      "student",
    ]);
    expect(parseWith("Jongerenwoning tot 28 jaar.")?.labels).toEqual(["jongeren"]);
    expect(parseWith("Jongerenwoning tot 28 jaar.")?.targetGroups).toEqual(["jongeren"]);
    expect(parseWith("Geschikt voor senioren, vanaf 65 jaar.")?.labels).toEqual(["senioren"]);
    expect(parseWith("Geschikt voor senioren, vanaf 65 jaar.")?.eligibility?.minAge).toBe(65);
    expect(parseWith("Voorbeeldstad is een gezellige studentenstad.")?.labels).toEqual([]);
    expect(parseWith("Vermeld waar je studeert.")?.labels).toEqual([]);
    expect(parseWith("Nieuwbouwproject in aanbouw.")?.labels).toEqual([]);
  });
});
