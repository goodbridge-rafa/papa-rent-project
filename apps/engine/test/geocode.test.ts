import type { FetchPlan } from "@papa/adapters";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { Geocoder, parseDoc } from "../src/geocode";
import type { Http } from "../src/http";

// Real PDOK Locatieserver v3_1 responses (captured on 2026-09-06)
const postcodeBody = JSON.stringify({
  response: {
    numFound: 1,
    docs: [
      {
        type: "postcode",
        woonplaatsnaam: "Eindhoven",
        gemeentenaam: "Eindhoven",
        postcode: "5625NH",
        provincienaam: "Noord-Brabant",
        centroide_ll: "POINT(5.47701324 51.47515961)",
      },
    ],
  },
});
const reverseBody = JSON.stringify({
  response: {
    numFound: 1,
    docs: [
      {
        type: "adres",
        woonplaatsnaam: "Amsterdam",
        gemeentenaam: "Amsterdam",
        postcode: "1012EG",
        provincienaam: "Noord-Holland",
      },
    ],
  },
});
const emptyBody = JSON.stringify({ response: { numFound: 0, docs: [] } });

function fakeHttp(calls: string[]): Http {
  return {
    async get(plan: FetchPlan) {
      calls.push(plan.url);
      const u = new URL(plan.url);
      const text = u.pathname.endsWith("/reverse")
        ? reverseBody
        : u.searchParams.get("q") === "postcode:5625NH"
          ? postcodeBody
          : emptyBody;
      return {
        url: plan.url,
        status: 200,
        headers: {},
        text,
        fetchedAt: new Date().toISOString(),
        durationMs: 1,
      };
    },
    async close() {},
  } as unknown as Http;
}

describe("PDOK geocoder", () => {
  it("parses gemeente, provincie and centroid", () => {
    expect(parseDoc(postcodeBody)).toEqual({
      municipality: "Eindhoven",
      province: "Noord-Brabant",
      lat: 51.47515961,
      lng: 5.47701324,
    });
    expect(parseDoc(emptyBody)).toBeNull();
    expect(parseDoc("not json")).toBeNull();
  });

  it("resolves by postcode, caches, and falls back to reverse lookup by point", async () => {
    const calls: string[] = [];
    const g = new Geocoder(fakeHttp(calls), pino({ level: "silent" }), 0);
    const a = await g.resolve({ postcode: "5625 nh", lat: null, lng: null });
    expect(a?.municipality).toBe("Eindhoven");
    expect(a?.lat).toBeCloseTo(51.475, 2);
    await g.resolve({ postcode: "5625NH", lat: null, lng: null });
    expect(calls.length).toBe(1); // cache

    const b = await g.resolve({ postcode: "9999ZZ", lat: 52.3702, lng: 4.8952 });
    expect(b).toEqual({
      municipality: "Amsterdam",
      province: "Noord-Holland",
      lat: null,
      lng: null,
    });
    expect(calls.length).toBe(3); // postcode (empty) + reverse
    expect(calls[2]).toContain("/reverse?lat=52.3702&lon=4.8952");

    expect(await g.resolve({ postcode: null, lat: null, lng: null })).toBeNull();
    expect(g.size()).toBe(2);
  });
});
