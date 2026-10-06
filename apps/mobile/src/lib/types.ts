import type {
  EligibilityDimension,
  EligibilityHint,
  EligibilityNote,
  EligibilityReason,
  EligibilityState,
  MarketRule,
  RadarInput,
  RuleKey,
} from "@papa/core/shared";

export interface Listing {
  id: number;
  sourceSlug: string;
  sourceListingId: string;
  url: string;
  applyUrl: string | null;
  title: string;
  segment: "social" | "midden" | "free" | "unknown";
  allocationModel:
    | "inschrijfduur"
    | "punten"
    | "loting"
    | "direct"
    | "motivatie"
    | "optie"
    | "unknown";
  closesAfterFirstReaction: boolean;
  priceNet: number | null;
  priceTotal: number | null;
  serviceCosts: number | null;
  street: string | null;
  houseNumber: string | null;
  postcode: string | null;
  city: string | null;
  municipality: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  rooms: number | null;
  bedrooms: number | null;
  areaM2: number | null;
  dwellingType: string | null;
  dwellingCategory: string;
  energyLabel: string | null;
  constructionYear: number | null;
  floor: number | null;
  availableFrom: string | null;
  availableFromText: string | null;
  publishedAt: string | null;
  closesAt: string | null;
  labels: string[];
  targetGroups: string[];
  operatorCode: string | null;
  operatorName: string | null;
  registrationRequired: boolean | null;
  huurtoeslagPossible: boolean | null;
  photos: string[];
  thumbnail: string | null;
  isNewBuild: boolean;
  isExchange: boolean;
  notices: string[];
  eligibility: {
    minIncome: number | null;
    maxIncome: number | null;
    minAge: number | null;
    maxAge: number | null;
    minHousehold: number | null;
    maxHousehold: number | null;
    localBindingPriority: boolean | null;
  } | null;
  reactionsCount: number | null;
  description: string | null;
  firstSeenAt: string;
  removedAt: string | null;
}

/**
 * "past bij jou" signal as the API sends it (`fitSummary` in apps/api/src/app.ts): the feed card
 * only needs the state and the reason that decided it. Codes come from `@papa/core`; the NL/EN
 * translation lives in `src/lib/i18n.ts`.
 */
export interface FitSummary {
  state: EligibilityState;
  reason: EligibilityReason;
}

/** Market rule cited in the "Waarom?" explanation: the subset `fitDetail` sends. */
export interface FitRule {
  key: RuleKey;
  value: number;
  unit: MarketRule["unit"];
  validFrom: string;
  source: string;
}

/** The detail's full verdict (`fitDetail`): what the "Waarom?" screen needs to cite. */
export interface FitDetail extends FitSummary {
  decidedBy: EligibilityDimension | null;
  notes: EligibilityNote[];
  hints: EligibilityHint[];
  /** Date (YYYY-MM-DD) the thresholds were read at. */
  rulesReadAt: string;
  rules: FitRule[];
}

/**
 * Listing as the authenticated feed returns it. `fit` is `null` defensively: if a response ever
 * arrives without a verdict, the card shows no badge instead of crashing.
 */
export type FeedListing = Listing & { fit: FitSummary | null };

/** `GET /v1/listings/:id`: `fit` is `null` when there is no session (public catalogue). */
export interface ListingDetail {
  listing: Listing;
  fit: FitDetail | null;
}

export interface Radar extends RadarInput {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  listings: T[];
  nextCursor: number | null;
}

export interface InboxItem {
  id: number;
  radarId: string | null;
  createdAt: string;
  openedAt: string | null;
  listing: Pick<
    Listing,
    | "id"
    | "title"
    | "priceNet"
    | "segment"
    | "allocationModel"
    | "city"
    | "thumbnail"
    | "closesAt"
    | "publishedAt"
    | "removedAt"
  >;
}

export interface Me {
  user: {
    id: string;
    name: string;
    email: string;
    locale: string | null;
    dateOfBirth: string;
    consentVersion: string;
    householdSize: number | null;
    incomeBand: string | null;
    isSocialTenant: boolean | null;
    keyProfession: boolean | null;
  };
  radarCount: number;
}

/**
 * Response of `POST /v1/radars/estimate`: the wizard's live count ("≈ N woningen per week",
 * ux-flows §3). `perWeek` is `null` when the engine has not collected enough history yet: then the
 * level is `unknown` and we show no number at all.
 */
export type RadarEstimateLevel = "unknown" | "none" | "normal" | "high";

export type RadarSuggestionCode =
  | "widen_radius"
  | "raise_max_rent"
  | "add_segment"
  | "daily_digest";

/** Widening the API already measured: the patch is exactly what was counted. */
export interface RadarSuggestion {
  code: RadarSuggestionCode;
  patch: Partial<RadarInput>;
  matched?: number;
  perWeek?: number | null;
}

export interface RadarEstimate {
  windowDays: number;
  /** Days of history the rate was measured over; `null` = the engine never collected. */
  observedDays: number | null;
  matched: number;
  perWeek: number | null;
  level: RadarEstimateLevel;
  suggestions: RadarSuggestion[];
}

/** Only the fields that change matching: the name or the alerts do not move the estimate. */
export type RadarEstimateInput = Pick<
  RadarInput,
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
>;
