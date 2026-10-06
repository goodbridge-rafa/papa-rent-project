export const euro = (n: number | null | undefined, opts: { decimals?: boolean } = {}) =>
  n === null || n === undefined
    ? "?"
    : n.toLocaleString("nl-NL", {
        minimumFractionDigits: opts.decimals ? 2 : 0,
        maximumFractionDigits: opts.decimals ? 2 : 0,
      });

/** "3 min" / "2 u" / "1 d", for "nieuw · X geleden". */
export function ago(iso: string | null, locale: "nl" | "en", now = Date.now()): string {
  if (!iso) return "";
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ${locale === "nl" ? "u" : "h"}`;
  return `${Math.floor(h / 24)} d`;
}

/** "1d 4u" / "3u 20m" / "12m": countdown. null once it has passed. */
export function countdown(
  iso: string | null,
  locale: "nl" | "en",
  now = Date.now(),
): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const min = Math.round(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const H = locale === "nl" ? "u" : "h";
  if (d > 0) return `${d}d ${h}${H}`;
  if (h > 0) return `${h}${H} ${m}m`;
  return `${m}m`;
}

export function dateShort(iso: string | null, locale: "nl" | "en"): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function isClosingSoon(closesAt: string | null, hours = 6, now = Date.now()): boolean {
  if (!closesAt) return false;
  const ms = new Date(closesAt).getTime() - now;
  return ms > 0 && ms < hours * 3_600_000;
}

/** PDOK tile (BRT achtergrondkaart, CC-BY Kadaster) containing the point, and the pin position inside it. */
export function pdokTile(lat: number, lng: number, z = 15) {
  const n = 2 ** z;
  const xf = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  return {
    url: `https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/${z}/${x}/${y}.png`,
    px: xf - x,
    py: yf - y,
  };
}
