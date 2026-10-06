/** "5625 nh" -> "5625NH"; invalid -> null */
export function normalizePostcode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, "").toUpperCase();
  return /^\d{4}[A-Z]{2}$/.test(s) ? s : null;
}

/** Canonical NL address key: postcode + number + addition. Fallback: source:id. */
export function canonicalKey(input: {
  postcode: string | null;
  houseNumber: string | null;
  houseNumberAddition?: string | null;
  fallback: string;
}): string {
  const pc = normalizePostcode(input.postcode);
  const nr = (input.houseNumber ?? "").trim().toLowerCase();
  if (pc && nr) {
    const add = (input.houseNumberAddition ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return `${pc}-${nr}${add ? `-${add}` : ""}`;
  }
  return `src:${input.fallback}`;
}

function tzOffsetMinutes(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return (asIfUtc - date.getTime()) / 60_000;
}

/**
 * Converts "YYYY-MM-DD HH:mm:ss" (Amsterdam local time, as sources publish it) to ISO UTC.
 * "0000-00-00 00:00:00" and empty strings -> null.
 */
export function amsterdamLocalToIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw.trim());
  if (!m) return null;
  const [, Y, M, D, h = "00", mi = "00", s = "00"] = m;
  if (Y === "0000" || M === "00" || D === "00") return null;
  const guess = Date.UTC(Number(Y), Number(M) - 1, Number(D), Number(h), Number(mi), Number(s));
  const off1 = tzOffsetMinutes("Europe/Amsterdam", new Date(guess));
  const off2 = tzOffsetMinutes("Europe/Amsterdam", new Date(guess - off1 * 60_000));
  return new Date(guess - off2 * 60_000).toISOString();
}

/** "2026-09-06" -> "2026-09-06"; anything else -> null */
export function isoDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  if (!m || m[1]?.startsWith("0000")) return null;
  return m[1] ?? null;
}

export function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function toIntOrNull(v: unknown): number | null {
  const n = toNumberOrNull(v);
  return n === null ? null : Math.trunc(n);
}

export function absoluteUrl(base: string, path: string | null | undefined): string | null {
  if (!path) return null;
  try {
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}
