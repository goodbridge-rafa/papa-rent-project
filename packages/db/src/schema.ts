import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

/** Operational state per source (the YAML registry is the configuration; this is runtime). */
export const sources = pgTable("sources", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  stack: text("stack").notNull(),
  tier: text("tier").notNull(),
  status: text("status").notNull(),
  intervalSeconds: integer("interval_seconds"),
  lastOkAt: ts("last_ok_at"),
  lastErrorAt: ts("last_error_at"),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  etag: text("etag"),
  lastModified: text("last_modified"),
  lastHash: text("last_hash"),
  createdAt: ts("created_at").notNull().default(sql`now()`),
  updatedAt: ts("updated_at").notNull().default(sql`now()`),
});

export const listings = pgTable(
  "listings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sourceSlug: text("source_slug")
      .notNull()
      .references(() => sources.slug),
    sourceListingId: text("source_listing_id").notNull(),
    canonicalKey: text("canonical_key").notNull(),
    url: text("url").notNull(),
    applyUrl: text("apply_url"),
    title: text("title").notNull(),
    segment: text("segment").notNull(),
    segmentReason: text("segment_reason").notNull(),
    allocationModel: text("allocation_model").notNull(),
    closesAfterFirstReaction: boolean("closes_after_first_reaction").notNull().default(false),
    priceNet: numeric("price_net", { precision: 10, scale: 2, mode: "number" }),
    priceTotal: numeric("price_total", { precision: 10, scale: 2, mode: "number" }),
    serviceCosts: numeric("service_costs", { precision: 10, scale: 2, mode: "number" }),
    street: text("street"),
    houseNumber: text("house_number"),
    houseNumberAddition: text("house_number_addition"),
    postcode: text("postcode"),
    city: text("city"),
    municipality: text("municipality"),
    province: text("province"),
    country: text("country").notNull().default("NL"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    rooms: integer("rooms"),
    bedrooms: integer("bedrooms"),
    areaM2: numeric("area_m2", { precision: 8, scale: 2, mode: "number" }),
    dwellingType: text("dwelling_type"),
    dwellingCategory: text("dwelling_category").notNull(),
    energyLabel: text("energy_label"),
    constructionYear: integer("construction_year"),
    floor: integer("floor"),
    availableFrom: date("available_from", { mode: "string" }),
    availableFromText: text("available_from_text"),
    publishedAt: ts("published_at"),
    closesAt: ts("closes_at"),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    targetGroups: text("target_groups").array().notNull().default(sql`'{}'::text[]`),
    operatorCode: text("operator_code"),
    operatorName: text("operator_name"),
    registrationRequired: boolean("registration_required"),
    huurtoeslagPossible: boolean("huurtoeslag_possible"),
    photos: text("photos").array().notNull().default(sql`'{}'::text[]`),
    thumbnail: text("thumbnail"),
    isNewBuild: boolean("is_new_build").notNull().default(false),
    isExchange: boolean("is_exchange").notNull().default(false),
    notices: text("notices").array().notNull().default(sql`'{}'::text[]`),
    eligibility: jsonb("eligibility"),
    reactionsCount: integer("reactions_count"),
    description: text("description"),
    enrichedAt: ts("enriched_at"),
    rawHash: text("raw_hash").notNull(),
    raw: jsonb("raw"),
    firstSeenAt: ts("first_seen_at").notNull().default(sql`now()`),
    lastSeenAt: ts("last_seen_at").notNull().default(sql`now()`),
    removedAt: ts("removed_at"),
  },
  (t) => [
    uniqueIndex("listings_source_listing_uq").on(t.sourceSlug, t.sourceListingId),
    index("listings_canonical_key_idx").on(t.canonicalKey),
    index("listings_published_at_idx").on(t.publishedAt),
    index("listings_segment_municipality_idx").on(t.segment, t.municipality),
    index("listings_active_idx").on(t.removedAt, t.closesAt),
  ],
);

/** Change events; the basis of the matcher/notifier (Phase 4). */
export const listingEvents = pgTable(
  "listing_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    listingId: bigint("listing_id", { mode: "number" })
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // new | updated | price_changed | closing_soon | removed
    at: ts("at").notNull().default(sql`now()`),
    payload: jsonb("payload"),
    processedAt: ts("processed_at"),
  },
  (t) => [index("listing_events_unprocessed_idx").on(t.processedAt, t.at)],
);

/** One row per poll; feeds latency and coverage metrics. */
export const sourceRuns = pgTable(
  "source_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sourceSlug: text("source_slug")
      .notNull()
      .references(() => sources.slug),
    startedAt: ts("started_at").notNull(),
    finishedAt: ts("finished_at").notNull(),
    ok: boolean("ok").notNull(),
    notModified: boolean("not_modified").notNull().default(false),
    httpStatus: integer("http_status"),
    items: integer("items").notNull().default(0),
    newItems: integer("new_items").notNull().default(0),
    changedItems: integer("changed_items").notNull().default(0),
    removedItems: integer("removed_items").notNull().default(0),
    durationMs: integer("duration_ms").notNull(),
    error: text("error"),
  },
  (t) => [index("source_runs_source_started_idx").on(t.sourceSlug, t.startedAt)],
);

export type SourceRow = typeof sources.$inferSelect;
export type ListingRow = typeof listings.$inferSelect;
export type NewListingRow = typeof listings.$inferInsert;
export type ListingEventRow = typeof listingEvents.$inferSelect;
export type SourceRunRow = typeof sourceRuns.$inferSelect;

/** A user's saved search ("Radar"). Municipalities stored normalised (lower case). */
export const radars = pgTable(
  "radars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    segments: text("segments").array().notNull().default(sql`'{social,midden}'::text[]`),
    areaType: text("area_type").notNull().default("municipalities"), // municipalities | radius | all
    municipalities: text("municipalities").array().notNull().default(sql`'{}'::text[]`),
    provinces: text("provinces").array().notNull().default(sql`'{}'::text[]`),
    centerLat: doublePrecision("center_lat"),
    centerLng: doublePrecision("center_lng"),
    radiusKm: numeric("radius_km", { precision: 6, scale: 1, mode: "number" }),
    maxRent: numeric("max_rent", { precision: 10, scale: 2, mode: "number" }),
    minBedrooms: integer("min_bedrooms"),
    dwellingCategories: text("dwelling_categories").array().notNull().default(sql`'{}'::text[]`),
    includeLabels: text("include_labels").array().notNull().default(sql`'{}'::text[]`),
    excludeLabels: text("exclude_labels").array().notNull().default(sql`'{}'::text[]`),
    allocationModels: text("allocation_models").array().notNull().default(sql`'{}'::text[]`),
    pushEnabled: boolean("push_enabled").notNull().default(true),
    emailMode: text("email_mode").notNull().default("instant"), // instant | daily | off
    quietStart: text("quiet_start"), // "23:00" (Europe/Amsterdam)
    quietEnd: text("quiet_end"), // "07:00"
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().default(sql`now()`),
    updatedAt: ts("updated_at").notNull().default(sql`now()`),
  },
  (t) => [index("radars_user_idx").on(t.userId), index("radars_active_idx").on(t.active)],
);

/** Expo push token per installation. */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expoPushToken: text("expo_push_token").notNull(),
    platform: text("platform").notNull(), // ios | android | web
    locale: text("locale"),
    lastSeenAt: ts("last_seen_at").notNull().default(sql`now()`),
    disabledAt: ts("disabled_at"),
    createdAt: ts("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("devices_token_uq").on(t.expoPushToken),
    index("devices_user_idx").on(t.userId),
  ],
);

/** One row per (user, listing, channel). `inbox` is the in-app alert feed; `push`/`email` are sends. */
export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    radarId: uuid("radar_id").references(() => radars.id, { onDelete: "set null" }),
    listingId: bigint("listing_id", { mode: "number" })
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    eventId: bigint("event_id", { mode: "number" }).references(() => listingEvents.id, {
      onDelete: "set null",
    }),
    channel: text("channel").notNull(), // inbox | push | email
    status: text("status").notNull().default("pending"), // pending | sent | failed | skipped
    scheduledFor: ts("scheduled_for").notNull().default(sql`now()`),
    sentAt: ts("sent_at"),
    openedAt: ts("opened_at"),
    error: text("error"),
    createdAt: ts("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("notifications_user_listing_channel_uq").on(t.userId, t.listingId, t.channel),
    index("notifications_pending_idx").on(t.status, t.scheduledFor),
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export type RadarRow = typeof radars.$inferSelect;
export type NewRadarRow = typeof radars.$inferInsert;
export type DeviceRow = typeof devices.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
