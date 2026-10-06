import data from "./municipalities.json";

export interface Municipality {
  name: string;
  code: string; // CBS gemeentecode, ex. "0363"
  province: string;
  lat: number | null;
  lng: number | null;
}

/** 342 municipalities (PDOK Locatieserver, 2026-09-06). Official, open source. */
export const MUNICIPALITIES: Municipality[] = (data as { municipalities: Municipality[] })
  .municipalities;
export const PROVINCES: string[] = [...new Set(MUNICIPALITIES.map((m) => m.province))].sort(
  (a, b) => a.localeCompare(b, "nl"),
);

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function searchMunicipalities(query: string, limit = 12): Municipality[] {
  const q = fold(query.trim());
  if (!q) return [];
  const starts: Municipality[] = [];
  const contains: Municipality[] = [];
  for (const m of MUNICIPALITIES) {
    const n = fold(m.name);
    if (n.startsWith(q)) starts.push(m);
    else if (n.includes(q)) contains.push(m);
  }
  return [...starts, ...contains].slice(0, limit);
}

export function municipalityByName(name: string): Municipality | undefined {
  const n = fold(name);
  return MUNICIPALITIES.find((m) => fold(m.name) === n);
}
