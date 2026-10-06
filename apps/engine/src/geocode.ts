import type { Logger } from "pino";
import type { Http } from "./http";

/**
 * Municipality/province (and coordinates, when missing) via the PDOK Locatieserver, open data
 * from the Dutch government. Only called for new listings without a municipality: Zig feeds carry it.
 * In-memory cache per postcode; its own pause between requests (`ENGINE_GEOCODE_GAP_MS`).
 */
export interface GeoInput {
  postcode: string | null;
  lat: number | null;
  lng: number | null;
}

export interface GeoResult {
  municipality: string;
  province: string;
  lat: number | null;
  lng: number | null;
}

const PDOK = "https://api.pdok.nl/bzk/locatieserver/search/v3_1";
const FIELDS = "fl=type,postcode,woonplaatsnaam,gemeentenaam,provincienaam,centroide_ll";

export class Geocoder {
  private readonly cache = new Map<string, GeoResult | null>();

  constructor(
    private readonly http: Http,
    private readonly log: Logger,
    private readonly gapMs = 250,
  ) {}

  /** null when there is no postcode nor coordinates, or when PDOK does not know the point. */
  async resolve(g: GeoInput): Promise<GeoResult | null> {
    const pc = g.postcode ? g.postcode.replace(/\s+/g, "").toUpperCase() : null;
    const hasPoint = g.lat !== null && g.lng !== null;
    const key = pc ?? (hasPoint ? `${g.lat?.toFixed(4)},${g.lng?.toFixed(4)}` : null);
    if (!key) return null;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let out: GeoResult | null = null;
    try {
      if (pc && /^\d{4}[A-Z]{2}$/.test(pc)) out = await this.byPostcode(pc);
      if (!out && hasPoint) out = await this.byPoint(g.lat as number, g.lng as number);
    } catch (err) {
      this.log.warn({ err: String(err), key }, "geocode failed");
      return null; // do not cache transient failures
    }
    this.cache.set(key, out);
    return out;
  }

  private async byPostcode(pc: string): Promise<GeoResult | null> {
    const url = `${PDOK}/free?q=postcode:${pc}&fq=type:postcode&${FIELDS}&rows=1`;
    return parseDoc(await this.fetch(url));
  }

  private async byPoint(lat: number, lng: number): Promise<GeoResult | null> {
    const url = `${PDOK}/reverse?lat=${lat}&lon=${lng}&fq=type:adres&${FIELDS}&rows=1`;
    const r = parseDoc(await this.fetch(url));
    // in reverse mode the position is already known; do not overwrite it with the address centroid
    return r ? { ...r, lat: null, lng: null } : null;
  }

  private async fetch(url: string): Promise<string> {
    const res = await this.http.get({ url }, {}, { minGapMs: this.gapMs });
    if (res.status !== 200) throw new Error(`pdok http ${res.status}`);
    return res.text;
  }

  size() {
    return this.cache.size;
  }
}

interface PdokDoc {
  gemeentenaam?: string;
  provincienaam?: string;
  centroide_ll?: string;
}

/** Reads the first doc of a Locatieserver response. Exported for tests. */
export function parseDoc(text: string): GeoResult | null {
  let json: { response?: { docs?: PdokDoc[] } };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return null;
  }
  const doc = json.response?.docs?.[0];
  if (!doc?.gemeentenaam || !doc.provincienaam) return null;
  let lat: number | null = null;
  let lng: number | null = null;
  const m = /POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(doc.centroide_ll ?? "");
  if (m) {
    lng = Number(m[1]);
    lat = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      lat = null;
      lng = null;
    }
  }
  return { municipality: doc.gemeentenaam, province: doc.provincienaam, lat, lng };
}
