import { z } from "zod";
import { AllocationModel, DwellingCategory, ListingLabel, Segment } from "./enums";

export const Address = z.object({
  street: z.string().nullable(),
  houseNumber: z.string().nullable(),
  houseNumberAddition: z.string().nullable(),
  postcode: z.string().nullable(), // normalizado: "5625NH"
  city: z.string().nullable(),
  municipality: z.string().nullable(),
  province: z.string().nullable(),
  country: z.string().default("NL"),
});
export type Address = z.infer<typeof Address>;

/**
 * Canonical schema of a listing. Every adapter produces this and nothing else.
 * Dates in ISO-8601 UTC. Prices in euros per month.
 */
export const CanonicalListing = z.object({
  sourceSlug: z.string().min(1),
  sourceListingId: z.string().min(1),
  /** Cross-source dedup key: normalised postcode+huisnummer+toevoeging, or a fallback. */
  canonicalKey: z.string().min(1),
  url: z.string().url(),
  applyUrl: z.string().url().nullable(),
  title: z.string().min(1),
  segment: Segment,
  segmentReason: z.string(),
  allocationModel: AllocationModel,
  closesAfterFirstReaction: z.boolean(),
  priceNet: z.number().nonnegative().nullable(),
  priceTotal: z.number().nonnegative().nullable(),
  serviceCosts: z.number().nonnegative().nullable(),
  address: Address,
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  rooms: z.number().int().nullable(),
  bedrooms: z.number().int().nullable(),
  areaM2: z.number().nullable(),
  dwellingType: z.string().nullable(),
  dwellingCategory: DwellingCategory,
  energyLabel: z.string().nullable(),
  constructionYear: z.number().int().nullable(),
  floor: z.number().int().nullable(),
  availableFrom: z.string().nullable(), // YYYY-MM-DD
  availableFromText: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  closesAt: z.string().datetime().nullable(),
  labels: z.array(ListingLabel),
  targetGroups: z.array(z.string()),
  operator: z.object({ code: z.string().nullable(), name: z.string().nullable() }),
  registrationRequired: z.boolean().nullable(),
  huurtoeslagPossible: z.boolean().nullable(),
  photos: z.array(z.string().url()),
  thumbnail: z.string().url().nullable(),
  isNewBuild: z.boolean(),
  isExchange: z.boolean(),
  /** Textual notices from the source (e.g. "Kernbinding", "Woning voor 55+"). */
  notices: z.array(z.string()),
  /** Explicit criteria from the source (usually from the detail; null = unknown). */
  eligibility: z
    .object({
      minIncome: z.number().nullable(),
      maxIncome: z.number().nullable(),
      minAge: z.number().int().nullable(),
      maxAge: z.number().int().nullable(),
      minHousehold: z.number().int().nullable(),
      maxHousehold: z.number().int().nullable(),
      localBindingPriority: z.boolean().nullable(),
    })
    .nullable(),
  reactionsCount: z.number().int().nonnegative().nullable(),
  /** Listing text without HTML, truncated. */
  description: z.string().nullable(),
  rawHash: z.string().min(1),
});
export type CanonicalListing = z.infer<typeof CanonicalListing>;
