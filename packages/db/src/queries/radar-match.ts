import {
  and,
  arrayOverlaps,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  not,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { RadarRow } from "../schema";
import { listings, radars } from "../schema";

/** Municipality normalised for comparison (the feed carries "Eindhoven", the radar stores "eindhoven"). */
export function normalizeMunicipality(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Haversine distance in km between a listing and a point, in SQL (Postgres and PGlite). */
export function haversineKm(lat: number, lng: number): SQL<number> {
  return sql<number>`2 * 6371 * asin(sqrt(power(sin(radians(${listings.lat} - ${lat}) / 2), 2) + cos(radians(${lat})) * cos(radians(${listings.lat})) * power(sin(radians(${listings.lng} - ${lng}) / 2), 2)))`;
}

/** A radar's area: what each `areaType` requires to be a usable area. */
type RadarArea = Pick<
  RadarRow,
  "areaType" | "municipalities" | "provinces" | "centerLat" | "centerLng" | "radiusKm"
>;

/**
 * Does a radar have a usable area? The SINGLE definition of the area predicate, shared by both
 * directions of matching. Only `areaType="all"` means "the whole country"; a radar that declares
 * `municipalities` without municipalities or provinces, or `radius` without a centre or radius, is
 * **unfinished**, not nationwide — and matches ZERO. Aligning the other way (matching everything) would
 * push the national aanbod to someone who only asked for Eindhoven, so the safe direction is zero.
 * `RadarInput` (packages/core) already rejects these states on creation; the guard exists because the
 * `area_type` column is free text and nothing stops a partial write from leaving the row in this state.
 */
export function hasUsableArea(r: RadarArea): boolean {
  if (r.areaType === "all") return true;
  if (r.areaType === "municipalities") return r.municipalities.length + r.provinces.length > 0;
  if (r.areaType === "radius")
    return r.centerLat !== null && r.centerLng !== null && r.radiusKm !== null;
  return false; // unknown areaType: to be safe, matches zero (the SQL mirror does the same).
}

/**
 * SQL condition "this listing interests this radar". Shared by the API (feed) and the engine (matcher),
 * so the user sees in the feed exactly what generates alerts.
 */
export function radarMatchCondition(
  r: Pick<
    RadarRow,
    | "segments"
    | "areaType"
    | "municipalities"
    | "provinces"
    | "centerLat"
    | "centerLng"
    | "radiusKm"
    | "maxRent"
    | "minBedrooms"
    | "dwellingCategories"
    | "includeLabels"
    | "excludeLabels"
    | "allocationModels"
  >,
): SQL {
  const conds: SQL[] = [];
  if (r.segments.length) conds.push(inArray(listings.segment, r.segments));
  if (!hasUsableArea(r)) {
    // Unfinished radar: matches zero, as the `matchingRadarsCondition` mirror always did.
    conds.push(sql`false`);
  } else if (r.areaType === "municipalities") {
    const areaConds: SQL[] = [];
    if (r.municipalities.length)
      areaConds.push(
        inArray(sql`lower(${listings.municipality})`, r.municipalities.map(normalizeMunicipality)),
      );
    if (r.provinces.length)
      areaConds.push(
        inArray(sql`lower(${listings.province})`, r.provinces.map(normalizeMunicipality)),
      );
    conds.push(or(...areaConds) as SQL);
  } else if (r.areaType === "radius" && r.centerLat !== null && r.centerLng !== null) {
    // `hasUsableArea` already guaranteed centre and radius; the `!== null` is repeated only to narrow the type.
    conds.push(
      and(
        not(isNull(listings.lat)),
        lte(haversineKm(r.centerLat, r.centerLng), r.radiusKm as number),
      ) as SQL,
    );
  }
  if (r.maxRent !== null) conds.push(lte(listings.priceNet, r.maxRent));
  if (r.minBedrooms !== null) conds.push(gte(listings.bedrooms, r.minBedrooms));
  if (r.dwellingCategories.length)
    conds.push(inArray(listings.dwellingCategory, r.dwellingCategories));
  if (r.includeLabels.length) conds.push(arrayOverlaps(listings.labels, r.includeLabels));
  if (r.excludeLabels.length) conds.push(not(arrayOverlaps(listings.labels, r.excludeLabels)));
  if (r.allocationModels.length) conds.push(inArray(listings.allocationModel, r.allocationModels));
  return conds.length ? (and(...conds) as SQL) : sql`true`;
}

/** Listings still active: not removed and not closed. */
export function activeListingCondition(now = new Date().toISOString()): SQL {
  return and(
    isNull(listings.removedAt),
    or(isNull(listings.closesAt), gt(listings.closesAt, now)),
  ) as SQL;
}

export { eq };

/**
 * SQL mirror of `radarMatchCondition` for the reverse path: given ONE listing, which active radars match.
 * Used by the engine's matcher (one query per new listing). Tested against `radarMatchCondition` so they do not diverge.
 *
 * The area block mirrors `hasUsableArea` + filter: the `cardinality(...) > 0` and
 * `center_* is not null` guards are redundant with the comparisons that follow (comparing with an empty
 * array or with NULL would already be false), but they stay explicit so the predicate "unfinished radar
 * matches zero" reads on both sides and is not lost in a rewrite. Zero cost in the plan.
 */
export function matchingRadarsCondition(l: {
  segment: string;
  municipality: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  priceNet: number | null;
  bedrooms: number | null;
  dwellingCategory: string;
  labels: string[];
  allocationModel: string;
}): SQL {
  const muni = l.municipality ? normalizeMunicipality(l.municipality) : null;
  const prov = l.province ? normalizeMunicipality(l.province) : null;
  const labels = sql`${sql.raw(`ARRAY[${l.labels.map((x) => `'${x.replace(/'/g, "''")}'`).join(",")}]::text[]`)}`;
  return sql`
    ${radars.active} = true
    and (cardinality(${radars.segments}) = 0 or ${l.segment} = any(${radars.segments}))
    and (
      ${radars.areaType} = 'all'
      or (${radars.areaType} = 'municipalities'
          and (cardinality(${radars.municipalities}) > 0 or cardinality(${radars.provinces}) > 0)
          and (${muni}::text = any(${radars.municipalities}) or ${prov}::text = any(${radars.provinces})))
      or (${radars.areaType} = 'radius' and ${l.lat}::float8 is not null
          and ${radars.centerLat} is not null and ${radars.centerLng} is not null and ${radars.radiusKm} is not null
          and 2 * 6371 * asin(sqrt(power(sin(radians(${l.lat}::float8 - ${radars.centerLat}) / 2), 2)
              + cos(radians(${radars.centerLat})) * cos(radians(${l.lat}::float8)) * power(sin(radians(${l.lng}::float8 - ${radars.centerLng}) / 2), 2))) <= ${radars.radiusKm})
    )
    and (${radars.maxRent} is null or ${l.priceNet}::numeric <= ${radars.maxRent})
    and (${radars.minBedrooms} is null or ${l.bedrooms}::int >= ${radars.minBedrooms})
    and (cardinality(${radars.dwellingCategories}) = 0 or ${l.dwellingCategory} = any(${radars.dwellingCategories}))
    and (cardinality(${radars.includeLabels}) = 0 or ${labels} && ${radars.includeLabels})
    and not (${labels} && ${radars.excludeLabels})
    and (cardinality(${radars.allocationModels}) = 0 or ${l.allocationModel} = any(${radars.allocationModels}))
  `;
}
