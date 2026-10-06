import { amsterdamLocalToIso } from "@papa/core";

const TZ = "Europe/Amsterdam";

export function localParts(date: Date): {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
} {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hh: Number(p.hour),
    mm: Number(p.minute),
  };
}

function localDateTime(y: number, m: number, d: number, hhmm: string): Date {
  const [hh, mm] = hhmm.split(":");
  const iso = amsterdamLocalToIso(
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${hh}:${mm}:00`,
  );
  if (!iso) throw new Error(`invalid local time ${y}-${m}-${d} ${hhmm}`);
  return new Date(iso);
}

function addDays(y: number, m: number, d: number, days: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Inside quiet hours? Supports windows that cross midnight (23:00–07:00). */
export function inQuietHours(now: Date, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const { hh, mm } = localParts(now);
  const cur = hh * 60 + mm;
  const s = minutes(start);
  const e = minutes(end);
  if (s === e) return false;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

/** First allowed instant: now, or the end of quiet hours. */
export function nextAllowed(now: Date, start: string | null, end: string | null): Date {
  if (!start || !end || !inQuietHours(now, start, end)) return now;
  const { y, m, d, hh, mm } = localParts(now);
  const cur = hh * 60 + mm;
  const e = minutes(end);
  const [yy, mo, dd] = cur < e ? [y, m, d] : addDays(y, m, d, 1);
  return localDateTime(yy, mo, dd, end);
}

/** Start of the local day (00:00 Europe/Amsterdam) containing `now`. Basis of the "per day" counts. */
export function startOfLocalDay(now: Date): Date {
  const { y, m, d } = localParts(now);
  return localDateTime(y, m, d, "00:00");
}

/** Next daily-digest time (default 08:00 local). */
export function nextDigestAt(now: Date, at = "08:00"): Date {
  const { y, m, d, hh, mm } = localParts(now);
  const cur = hh * 60 + mm;
  const [yy, mo, dd] = cur < minutes(at) ? [y, m, d] : addDays(y, m, d, 1);
  return localDateTime(yy, mo, dd, at);
}

/** "1d 4u" / "3u 20m" / "12m" in NL, "1d 4h" in EN. */
export function humanDuration(ms: number, locale: "nl" | "en"): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const H = locale === "nl" ? "u" : "h";
  if (d > 0) return `${d}d ${h}${H}`;
  if (h > 0) return `${h}${H} ${m}m`;
  return `${m}m`;
}
