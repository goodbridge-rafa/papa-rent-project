import { z } from "zod";
import { AllocationModel, DwellingCategory, ListingLabel, Segment } from "./enums";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Radar create/edit input (validation shared by API ↔ app). */
export const RadarBase = z.object({
  name: z.string().trim().min(1).max(60),
  segments: z
    .array(Segment.exclude(["unknown", "free"]))
    .min(1)
    .default(["social", "midden"]),
  areaType: z.enum(["municipalities", "radius", "all"]).default("municipalities"),
  municipalities: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  provinces: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  centerLat: z.number().min(50).max(54).nullable().default(null),
  centerLng: z.number().min(3).max(8).nullable().default(null),
  radiusKm: z.number().min(1).max(100).nullable().default(null),
  maxRent: z.number().positive().max(5000).nullable().default(null),
  minBedrooms: z.number().int().min(0).max(10).nullable().default(null),
  dwellingCategories: z.array(DwellingCategory).default([]),
  includeLabels: z.array(ListingLabel).default([]),
  excludeLabels: z.array(ListingLabel).default([]),
  allocationModels: z.array(AllocationModel.exclude(["unknown"])).default([]),
  pushEnabled: z.boolean().default(true),
  emailMode: z.enum(["instant", "daily", "off"]).default("instant"),
  quietStart: hhmm.nullable().default(null),
  quietEnd: hhmm.nullable().default(null),
  active: z.boolean().default(true),
});

export const RadarInput = RadarBase.refine(
  (r) => r.areaType !== "municipalities" || r.municipalities.length + r.provinces.length > 0,
  {
    message: "choose at least one municipality or province",
    path: ["municipalities"],
  },
)
  .refine(
    (r) =>
      r.areaType !== "radius" ||
      (r.centerLat !== null && r.centerLng !== null && r.radiusKm !== null),
    {
      message: "radius needs a centre and a distance",
      path: ["radiusKm"],
    },
  )
  .refine((r) => (r.quietStart === null) === (r.quietEnd === null), {
    message: "quiet hours need a start and an end",
    path: ["quietEnd"],
  });
export type RadarInput = z.infer<typeof RadarInput>;

/**
 * Strips the `.default(...)` off a field. `RadarBase.partial()` is NOT enough for a PATCH: in Zod the
 * default still fires for a missing key even after `.partial()`, so `{ active: false }`
 * came back with the whole object at its default values — and the API stored it,
 * wiping the filters the user had set up (pausing a radar turned it into a nationwide radar).
 */
type Undefaulted<T> = T extends z.ZodDefault<infer Inner> ? Inner : T;
type UndefaultedShape<S extends z.ZodRawShape> = { [K in keyof S]: Undefaulted<S[K]> };

function withoutDefaults<S extends z.ZodRawShape>(shape: S): UndefaultedShape<S> {
  return Object.fromEntries(
    Object.entries(shape).map(([key, field]) => [
      key,
      field instanceof z.ZodDefault ? field.unwrap() : field,
    ]),
  ) as UndefaultedShape<S>;
}

/**
 * PATCH: truly partial fields — a missing key is `undefined`, never the default value.
 * The API only stores what came in, merges it with the existing radar and revalidates with `RadarInput`.
 */
export const RadarPatch = z.object(withoutDefaults(RadarBase.shape)).partial();
export type RadarPatch = z.infer<typeof RadarPatch>;

export const DeviceInput = z.object({
  expoPushToken: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),
  platform: z.enum(["ios", "android", "web"]),
  locale: z.string().max(10).optional(),
});

export const ProfilePatch = z.object({
  locale: z.enum(["nl", "en"]).optional(),
  householdSize: z.number().int().min(1).max(12).nullable().optional(),
  incomeBand: z
    .enum(["lt_passend", "lt_daeb", "lt_midden", "gt_midden", "unknown"])
    .nullable()
    .optional(),
  isSocialTenant: z.boolean().nullable().optional(),
  keyProfession: z.boolean().nullable().optional(),
});
