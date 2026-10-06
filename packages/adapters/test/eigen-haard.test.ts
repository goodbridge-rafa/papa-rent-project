import { readFileSync } from "node:fs";
import { CanonicalListing, type RegistrySource } from "@papa/core";
import { parse as parseHtml } from "node-html-parser";
import { describe, expect, it } from "vitest";
import {
  EIGEN_HAARD_ORIGIN,
  eigenHaardAdapter,
  extractMapObjects,
  extractResultCount,
  inferPostcode,
  listingIdFromLink,
  mapDwellingCategory,
  mapViewUrl,
  parseEuro,
  parseExtraInfo,
  parseGps,
  parseRegionGroups,
  splitAddress,
} from "../src/eigen-haard/index";

const LISTINGS_URL = "https://www.example.nl/te-huur/middenhuur-en-vrije-sector/zoek/";
const MAP_URL = `${LISTINGS_URL}?view=Map`;

const source = (overrides: Partial<RegistrySource> = {}): RegistrySource => ({
  slug: "eigen-haard",
  name: "Eigen Haard",
  kind: "corporation",
  stack: "bespoke",
  tier: "A",
  status: "live",
  urls: {
    home: "https://www.example.nl/te-huur/",
    listings: LISTINGS_URL,
    data: null,
    robots: null,
    terms: null,
  },
  regions: [],
  provinces: ["Noord-Holland"],
  municipalities: [],
  segments: ["midden", "free"],
  registration: {
    fee_eur: null,
    renewal_eur_per_year: null,
    required_to_react: true,
    confidence: "A",
  },
  allocation_models: [],
  interval_seconds: 90,
  adapter: "eigen-haard",
  research_ref: null,
  fingerprint: null,
  legal: null,
  notes: null,
  ...overrides,
});

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/eigen-haard/${name}`, import.meta.url), "utf8");
/** Synthetic map view: 6 fictional objects, all "Beschikbaar", counter = 6. */
const listText = fixture("listings-map.html");
/** Synthetic detail page of listing 900001 (€1,225/month). */
const detailText = fixture("detail-900001.html");

const FETCHED_AT = "2026-09-10T22:00:00Z";
const body = (text: string, status = 200, url = MAP_URL) => ({
  url,
  status,
  contentType: "text/html; charset=utf-8",
  text,
  fetchedAt: FETCHED_AT,
});
const now = new Date(FETCHED_AT);

describe("eigen-haard · helpers", () => {
  it("parseEuro treats the dot as a thousands separator and the comma as decimal", () => {
    expect(parseEuro("1.225")).toBe(1225);
    expect(parseEuro("950")).toBe(950);
    expect(parseEuro("€ 1.225 /mnd")).toBe(1225);
    expect(parseEuro("950,-")).toBe(950);
    expect(parseEuro("1.228,07")).toBe(1228.07);
    expect(parseEuro("12.345,50")).toBe(12345.5);
    expect(parseEuro("")).toBeNull();
    expect(parseEuro(null)).toBeNull();
  });

  it("parseGps only accepts coordinates inside the Netherlands", () => {
    expect(parseGps("52.38,4.88")).toEqual({ lat: 52.38, lng: 4.88 });
    expect(parseGps("0,0")).toBeNull();
    expect(parseGps("4.88,52.38")).toBeNull(); // swapped
    expect(parseGps("")).toBeNull();
  });

  it("parseExtraInfo recognises each part by content, not by position", () => {
    expect(
      parseExtraInfo("Amsterdam Oost | 54&nbsp;m<sup>2</sup> | 3&nbsp;kamers | Appartement"),
    ).toEqual({ city: "Amsterdam Oost", areaM2: 54, rooms: 3, dwellingType: "Appartement" });
    // Shuffled order: still correct.
    expect(parseExtraInfo("Amstelveen | Woonhuis | 4&nbsp;kamers | 65&nbsp;m<sup>2</sup>")).toEqual(
      { city: "Amstelveen", areaM2: 65, rooms: 4, dwellingType: "Woonhuis" },
    );
    expect(parseExtraInfo("Kudelstaart")).toEqual({
      city: "Kudelstaart",
      areaM2: null,
      rooms: null,
      dwellingType: null,
    });
  });

  it("splitAddress separates number and addition", () => {
    expect(splitAddress("Voorbeeldplantsoen 95")).toEqual({
      street: "Voorbeeldplantsoen",
      houseNumber: "95",
      houseNumberAddition: null,
    });
    expect(splitAddress("Proeflaan 11-1")).toEqual({
      street: "Proeflaan",
      houseNumber: "11",
      houseNumberAddition: "1",
    });
    expect(splitAddress("Fictiefstraat 200 A")).toEqual({
      street: "Fictiefstraat",
      houseNumber: "200",
      houseNumberAddition: "A",
    });
    expect(splitAddress("Zonder nummer")).toEqual({
      street: "Zonder nummer",
      houseNumber: null,
      houseNumberAddition: null,
    });
  });

  it("listingIdFromLink returns the publication id from the path", () => {
    expect(
      listingIdFromLink("/te-huur/vrije-sector-huur/900001-amsterdam-voorbeeldplantsoen"),
    ).toBe("900001");
    expect(
      listingIdFromLink(
        "https://www.example.nl/te-huur/middenhuur/900002-amsterdam-proeflaan-11?x=1",
      ),
    ).toBe("900002");
    expect(listingIdFromLink("/te-huur/parkeren/zoek/")).toBeNull();
    expect(listingIdFromLink(null)).toBeNull();
  });

  it("mapDwellingCategory maps the types the source publishes", () => {
    expect(mapDwellingCategory("Appartement")).toBe("apartment");
    expect(mapDwellingCategory("Woonhuis")).toBe("house");
    expect(mapDwellingCategory("Seniorenwoning")).toBe("senior");
    expect(mapDwellingCategory(null)).toBe("other");
  });

  it("mapViewUrl forces view=Map on the registry URL", () => {
    expect(mapViewUrl(source())).toBe(MAP_URL);
    expect(
      mapViewUrl(
        source({ urls: { ...source().urls, listings: `${LISTINGS_URL}?view=List&page=2` } }),
      ),
    ).toBe(`${LISTINGS_URL}?view=Map&page=2`);
  });
});

describe("eigen-haard · plan", () => {
  it("requests a single page, the map view, without a conditional GET", () => {
    expect(eigenHaardAdapter.plan(source())).toEqual([{ url: MAP_URL, conditional: false }]);
  });

  it("defines no planMore: the whole offer fits in one request", () => {
    expect(eigenHaardAdapter.planMore).toBeUndefined();
  });
});

describe("eigen-haard · parse (synthetic map view)", () => {
  const result = eigenHaardAdapter.parse(source(), [body(listText)], now);
  const byId = new Map(result.listings.map((l) => [l.sourceListingId, l]));

  it("the fixture carries the entity-escaped map payload and the counter", () => {
    expect(listText).toContain("&quot;");
    expect(extractMapObjects(listText)).toHaveLength(6);
    expect(extractResultCount(listText)).toBe(6);
  });

  it("reads all 6 listings, every one valid against the canonical schema", () => {
    expect(result.listings).toHaveLength(6);
    expect(result.skipped).toEqual([]);
    expect(result.partial).toBe(false);
    // The only warning is the unresolvable village (see below).
    expect(result.warnings).toEqual(['900006: no municipality for "Kudelstaart"']);
    for (const l of result.listings) expect(() => CanonicalListing.parse(l)).not.toThrow();
    expect(new Set(result.listings.map((l) => l.sourceListingId)).size).toBe(6);
  });

  it("classifies by price on both sides of the caps, never by the URL path", () => {
    const seg = (id: string) => [byId.get(id)?.priceNet, byId.get(id)?.segment];
    expect(seg("900003")).toEqual([910, "social"]);
    expect(seg("900005")).toEqual([1050, "midden"]);
    // /vrije-sector-huur/ path, but €1,225 is under the midden cap.
    expect(byId.get("900001")?.url).toContain("/te-huur/vrije-sector-huur/");
    expect(seg("900001")).toEqual([1225, "midden"]);
    expect(byId.get("900001")?.segmentReason).not.toBe("source_hint");
    // Exactly the midden cap is still midden (inclusive).
    expect(seg("900002")).toEqual([1228.07, "midden"]);
    expect(seg("900004")).toEqual([1495, "free"]);
  });

  it("normalises a whole listing from the payload", () => {
    const l = byId.get("900001");
    expect(l?.title).toBe("Voorbeeldplantsoen 95, Amsterdam Centrum");
    // Relative links resolve against the adapter's fixed origin.
    expect(l?.url).toBe(
      `${EIGEN_HAARD_ORIGIN}/te-huur/vrije-sector-huur/900001-amsterdam-centrum-voorbeeldplantsoen-95`,
    );
    expect(l?.canonicalKey).toBe("src:eigen-haard:900001"); // no postcode before enrich
    expect(l?.address).toEqual({
      street: "Voorbeeldplantsoen",
      houseNumber: "95",
      houseNumberAddition: null,
      postcode: null,
      city: "Amsterdam Centrum",
      municipality: "Amsterdam",
      province: "Noord-Holland",
      country: "NL",
    });
    expect(l?.location).toEqual({ lat: 52.38, lng: 4.88 });
    expect(l?.areaM2).toBe(39);
    expect(l?.rooms).toBe(2);
    expect(l?.dwellingType).toBe("Appartement");
    expect(l?.dwellingCategory).toBe("apartment");
    expect(l?.thumbnail).toBe(`${EIGEN_HAARD_ORIGIN}/media/objects/900001/foto-1.jpg`);
    expect(l?.photos).toEqual([l?.thumbnail]);
    expect(l?.operator).toEqual({ code: null, name: "Eigen Haard" });
    expect(l?.registrationRequired).toBe(true);
    // Before enrich the application button lives on the source page.
    expect(l?.applyUrl).toBe(l?.url);
    expect(l?.allocationModel).toBe("unknown");
    expect(l?.isNewBuild).toBe(false);

    const shuffled = byId.get("900003");
    expect(shuffled?.dwellingCategory).toBe("house");
    expect(shuffled?.areaM2).toBe(85);
    expect(shuffled?.rooms).toBe(4);
    expect(shuffled?.thumbnail).toBeNull();
    expect(shuffled?.photos).toEqual([]);
    expect(byId.get("900004")?.address.houseNumberAddition).toBe("A");
  });

  it("resolves districts and villages through the page's own filter grouping", () => {
    const muni = (id: string) => byId.get(id)?.address.municipality;
    // District without a hyphen in the listing, with a hyphen in the filter: still Amsterdam.
    expect(byId.get("900002")?.address.city).toBe("Amsterdam Nieuw West");
    expect(muni("900002")).toBe("Amsterdam");
    // `data-group="Ouder Amstel"` -> the official municipality "Ouder-Amstel".
    expect(muni("900003")).toBe("Ouder-Amstel");
    expect(muni("900004")).toBe("Amstelveen");
    expect(muni("900005")).toBe("Zaanstad");
    // A village the filter does not group stays unresolved, with a warning.
    expect(muni("900006")).toBeNull();
    expect(byId.get("900006")?.address.province).toBeNull();
  });

  it("the page filter is the source of the place -> municipality grouping", () => {
    const groups = parseRegionGroups(parseHtml(listText));
    expect(groups.get("amsterdam nieuw west")).toBe("Amsterdam");
    expect(groups.get("duivendrecht")).toBe("Ouder Amstel");
    expect(groups.get("zaanstad")).toBe("Zaanstad");
    expect(groups.size).toBe(7);
  });

  it("every listing carries coordinates: the engine does not need to geocode", () => {
    expect(result.listings.every((l) => l.location !== null)).toBe(true);
  });
});

describe("eigen-haard · parse (coverage and noise)", () => {
  const inject = (objects: unknown[], count = objects.length) =>
    `<h3>${count} resultaten</h3><input type="hidden" class="objectsJson" value='${JSON.stringify(
      objects,
    ).replace(/'/g, "&#39;")}' />`;

  const obj = (o: Record<string, unknown> = {}) => ({
    id: "guid-1",
    title: "Teststraat 1",
    link: "/te-huur/vrije-sector-huur/999001-amsterdam-teststraat-1",
    gps: "52.37,4.89",
    image: "/media/x.jpg",
    price: "1.000",
    extrainfo: "Amsterdam | 50&nbsp;m<sup>2</sup> | 2&nbsp;kamers | Appartement",
    type: "Te huur",
    status: "Beschikbaar",
    type_object: "woning",
    additional_price_information: "/mnd",
    ...o,
  });

  it("marks partial and returns nothing when the payload disappears", () => {
    const r = eigenHaardAdapter.parse(source(), [body("<h3>6 resultaten</h3>")], now);
    expect(r.listings).toEqual([]);
    expect(r.partial).toBe(true);
    expect(r.warnings).toEqual(["no input.objectsJson in the map view (markup drift?)"]);
  });

  it("marks partial when the counter exceeds the payload", () => {
    const r = eigenHaardAdapter.parse(source(), [body(inject([obj()], 12))], now);
    expect(r.listings).toHaveLength(1);
    expect(r.partial).toBe(true);
    expect(r.warnings).toEqual(["counter says 12 results but the payload has 1"]);
  });

  it("warns on a missing counter without marking a non-empty payload partial", () => {
    const noCounter = inject([obj()]).replace("<h3>1 resultaten</h3>", "");
    const r = eigenHaardAdapter.parse(source(), [body(noCounter)], now);
    expect(r.listings).toHaveLength(1);
    expect(r.partial).toBe(false);
    expect(r.warnings).toEqual(["no results counter (markup drift?)"]);
  });

  it("accepts a genuinely empty offer without marking partial", () => {
    const r = eigenHaardAdapter.parse(source(), [body(inject([], 0))], now);
    expect(r.listings).toEqual([]);
    expect(r.partial).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it("marks partial when the listings page errors or is missing", () => {
    const r = eigenHaardAdapter.parse(source(), [body("", 503)], now);
    expect(r.partial).toBe(true);
    expect(r.listings).toEqual([]);
    expect(r.warnings).toEqual(["listings unavailable (status 503)"]);
    expect(eigenHaardAdapter.parse(source(), [], now).warnings).toEqual([
      "listings unavailable (status no response)",
    ]);
  });

  it("skips parking, items for sale and unavailable items", () => {
    const r = eigenHaardAdapter.parse(
      source(),
      [
        body(
          inject([
            obj({ type_object: "parkeerplaats", link: "/te-huur/parkeren/999002-a-b" }),
            obj({ status: "Verhuurd", link: "/te-huur/vrije-sector-huur/999003-a-b" }),
            obj({ type: "Te koop", link: "/te-huur/vrije-sector-huur/999004-a-b" }),
            obj({ link: "", id: "" }),
          ]),
        ),
      ],
      now,
    );
    expect(r.listings).toEqual([]);
    expect(r.skipped).toEqual([
      { id: "999002", reason: "object:parkeerplaats" },
      { id: "999003", reason: "status:Verhuurd" },
      { id: "999004", reason: "type:Te koop" },
      { id: "?", reason: "no_id_or_link" },
    ]);
  });

  it("never presents a price for another period as monthly", () => {
    const r = eigenHaardAdapter.parse(
      source(),
      [body(inject([obj({ additional_price_information: "/jaar" })]))],
      now,
    );
    expect(r.listings).toEqual([]);
    expect(r.skipped).toEqual([{ id: "999001", reason: "price_period:/jaar" }]);
  });

  it("keeps a listing without a readable price, but warns and leaves it unclassified", () => {
    const r = eigenHaardAdapter.parse(
      source(),
      [body(inject([obj({ price: "op aanvraag" })]))],
      now,
    );
    expect(r.listings).toHaveLength(1);
    expect(r.listings[0]?.priceNet).toBeNull();
    expect(r.listings[0]?.segment).toBe("unknown");
    expect(r.warnings).toEqual(['999001: no readable price ("op aanvraag")']);
  });

  it("drops coordinates outside the Netherlands instead of storing them", () => {
    const r = eigenHaardAdapter.parse(source(), [body(inject([obj({ gps: "0,0" })]))], now);
    expect(r.listings[0]?.location).toBeNull();
  });

  it("dedupes repeated ids in the same payload", () => {
    const r = eigenHaardAdapter.parse(
      source(),
      [body(inject([obj(), obj({ id: "guid-2" })]))],
      now,
    );
    expect(r.listings).toHaveLength(1);
    expect(r.skipped).toEqual([{ id: "999001", reason: "duplicate" }]);
  });
});

describe("eigen-haard · enrich (synthetic detail page)", () => {
  const listing = eigenHaardAdapter
    .parse(source(), [body(listText)], now)
    .listings.find((l) => l.sourceListingId === "900001") as CanonicalListing;
  const detailUrl = listing.url;
  const run = (text: string, status = 200) =>
    eigenHaardAdapter.enrich?.parse(source(), listing, body(text, status, detailUrl));

  it("requests exactly the listing's page", () => {
    expect(eigenHaardAdapter.enrich?.plan(source(), listing)).toEqual({ url: detailUrl });
  });

  it("extracts the application deep link to the allocation portal", () => {
    const r = run(detailText);
    expect(r?.warnings).toEqual([]);
    expect(r?.patch.applyUrl).toBe("https://example.mijndak.nl/HuisDetails?PublicatieId=900001");
  });

  it("refuses an application link that belongs to another property", () => {
    const swapped = detailText.replace(/PublicatieId=900001/g, "PublicatieId=111111");
    const r = run(swapped);
    expect(r?.patch.applyUrl).toBeUndefined();
    expect(r?.warnings).toEqual(["detail 900001: WoningNet link points to 111111"]);
  });

  it("warns when there is no application link at all", () => {
    const r = run(detailText.replace(/mijndak\.nl/g, "elsewhere.example"));
    expect(r?.patch.applyUrl).toBeUndefined();
    expect(r?.warnings).toEqual(["detail 900001: no WoningNet application link"]);
  });

  it("completes the property characteristics from the detail page", () => {
    const patch = run(detailText)?.patch;
    expect(patch?.constructionYear).toBe(1918);
    expect(patch?.isNewBuild).toBe(false);
    expect(patch?.rooms).toBe(2);
    expect(patch?.areaM2).toBe(39);
    expect(patch?.energyLabel).toBe("C");
    expect(patch?.description).toContain("onder voorbehoud");
    expect(patch?.description).not.toMatch(/<|&nbsp;/);
  });

  it("warns about markup drift when the property list is gone", () => {
    const r = run(detailText.replace('class="property-list"', 'class="kenmerken"'));
    expect(r?.patch.constructionYear).toBeUndefined();
    expect(r?.warnings).toEqual(["detail 900001: no property-list (markup drift?)"]);
  });

  it("infers the postcode from the nearby anchors when they all agree", () => {
    expect(inferPostcode(detailText)).toEqual({ postcode: "1000AA", conflict: false });
    expect(run(detailText)?.patch.address).toEqual({ postcode: "1000AA" });
  });

  it("writes no postcode at all when the anchors disagree", () => {
    const conflicting = detailText.replace("adres=1000AA", "adres=1099ZZ");
    expect(inferPostcode(conflicting)).toEqual({ postcode: null, conflict: true });
    const r = run(conflicting);
    expect(r?.patch.address).toBeUndefined();
    expect(r?.warnings).toEqual(["detail 900001: conflicting postcode anchors"]);
  });

  it("ignores postcode-like parameters that are not a nearby-search anchor", () => {
    const noRadius = detailText.replace(/&amp;straal=3000/g, "");
    expect(inferPostcode(noRadius)).toEqual({ postcode: null, conflict: false });
  });

  it("records the source's notices and the doorstromers priority", () => {
    const patch = run(detailText)?.patch;
    expect(patch?.notices).toEqual([
      "Woningkenmerken, energielabel en huurprijs zijn nog onder voorbehoud.",
      "Doorstromers krijgen voorrang bij Eigen Haard.",
    ]);
    expect(patch?.labels).toEqual(["doorstromers"]);
  });

  it("marks nieuwbouw when 'Soort bouw' says so", () => {
    const nieuw = detailText.replace(
      '<span class="value">Bestaande bouw</span>',
      '<span class="value">Nieuwbouw</span>',
    );
    const patch = run(nieuw)?.patch;
    expect(patch?.isNewBuild).toBe(true);
    expect(patch?.labels).toEqual(["doorstromers", "nieuwbouw"]);
  });

  it("warns instead of inventing when the detail page fails", () => {
    const r = run("", 404);
    expect(r?.patch).toEqual({});
    expect(r?.warnings).toEqual(["detail 900001: status 404"]);
  });

  it("never touches the listing's price or identity", () => {
    const patch = run(detailText)?.patch as Record<string, unknown>;
    for (const key of ["priceNet", "sourceListingId", "url", "canonicalKey", "segment"]) {
      expect(patch[key]).toBeUndefined();
    }
  });
});
