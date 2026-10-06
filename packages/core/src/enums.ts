import { z } from "zod";

/** Regulated segment. `unknown` when it cannot be classified safely. */
export const Segment = z.enum(["social", "midden", "free", "unknown"]);
export type Segment = z.infer<typeof Segment>;

/** Allocation models. `direct` covers DirectKans / Direct te huur / eerste reageerder. */
export const AllocationModel = z.enum([
  "inschrijfduur",
  "punten",
  "loting",
  "direct",
  "motivatie",
  "optie",
  "unknown",
]);
export type AllocationModel = z.infer<typeof AllocationModel>;

/** Restrictive or priority labels. */
export const ListingLabel = z.enum([
  "jongeren",
  "senioren",
  "student",
  "grote_gezinnen",
  "doorstromers",
  "sleutelberoepen",
  "nultreden",
  "urgentie",
  "nieuwbouw",
  "woningruil",
  "voorrang_lokaal",
  "motivatie_gevraagd",
]);
export type ListingLabel = z.infer<typeof ListingLabel>;

export const DwellingCategory = z.enum(["apartment", "house", "studio", "room", "senior", "other"]);
export type DwellingCategory = z.infer<typeof DwellingCategory>;

export const SourceKind = z.enum([
  "consortium",
  "manager",
  "corporation",
  "newbuild",
  "niche",
  "aggregator",
]);
export const SourceStack = z.enum(["zig365", "dak", "woonmatch", "bespoke", "unknown"]);
export const SourceTier = z.enum(["A", "B", "C", "pending"]);
export const SourceStatus = z.enum(["planned", "recon", "live", "paused", "excluded"]);
export const SourceSegment = z.enum(["social", "midden", "free", "student", "senior"]);
