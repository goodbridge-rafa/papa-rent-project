CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" text NOT NULL,
	"locale" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" bigint NOT NULL,
	"type" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_slug" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"canonical_key" text NOT NULL,
	"url" text NOT NULL,
	"apply_url" text,
	"title" text NOT NULL,
	"segment" text NOT NULL,
	"segment_reason" text NOT NULL,
	"allocation_model" text NOT NULL,
	"closes_after_first_reaction" boolean DEFAULT false NOT NULL,
	"price_net" numeric(10, 2),
	"price_total" numeric(10, 2),
	"service_costs" numeric(10, 2),
	"street" text,
	"house_number" text,
	"house_number_addition" text,
	"postcode" text,
	"city" text,
	"municipality" text,
	"province" text,
	"country" text DEFAULT 'NL' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"rooms" integer,
	"bedrooms" integer,
	"area_m2" numeric(8, 2),
	"dwelling_type" text,
	"dwelling_category" text NOT NULL,
	"energy_label" text,
	"construction_year" integer,
	"floor" integer,
	"available_from" date,
	"available_from_text" text,
	"published_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"target_groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"operator_code" text,
	"operator_name" text,
	"registration_required" boolean,
	"huurtoeslag_possible" boolean,
	"photos" text[] DEFAULT '{}'::text[] NOT NULL,
	"thumbnail" text,
	"is_new_build" boolean DEFAULT false NOT NULL,
	"is_exchange" boolean DEFAULT false NOT NULL,
	"notices" text[] DEFAULT '{}'::text[] NOT NULL,
	"eligibility" jsonb,
	"reactions_count" integer,
	"description" text,
	"enriched_at" timestamp with time zone,
	"raw_hash" text NOT NULL,
	"raw" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"radar_id" uuid,
	"listing_id" bigint NOT NULL,
	"event_id" bigint,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"segments" text[] DEFAULT '{social,midden}'::text[] NOT NULL,
	"area_type" text DEFAULT 'municipalities' NOT NULL,
	"municipalities" text[] DEFAULT '{}'::text[] NOT NULL,
	"provinces" text[] DEFAULT '{}'::text[] NOT NULL,
	"center_lat" double precision,
	"center_lng" double precision,
	"radius_km" numeric(6, 1),
	"max_rent" numeric(10, 2),
	"min_bedrooms" integer,
	"dwelling_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"include_labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"exclude_labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"allocation_models" text[] DEFAULT '{}'::text[] NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"email_mode" text DEFAULT 'instant' NOT NULL,
	"quiet_start" text,
	"quiet_end" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_slug" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"ok" boolean NOT NULL,
	"not_modified" boolean DEFAULT false NOT NULL,
	"http_status" integer,
	"items" integer DEFAULT 0 NOT NULL,
	"new_items" integer DEFAULT 0 NOT NULL,
	"changed_items" integer DEFAULT 0 NOT NULL,
	"removed_items" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"stack" text NOT NULL,
	"tier" text NOT NULL,
	"status" text NOT NULL,
	"interval_seconds" integer,
	"last_ok_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"etag" text,
	"last_modified" text,
	"last_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"date_of_birth" timestamp NOT NULL,
	"locale" text DEFAULT 'nl',
	"consent_version" text NOT NULL,
	"consent_at" timestamp DEFAULT now(),
	"household_size" integer,
	"income_band" text,
	"is_social_tenant" boolean,
	"key_profession" boolean,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_source_slug_sources_slug_fk" FOREIGN KEY ("source_slug") REFERENCES "public"."sources"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_radar_id_radars_id_fk" FOREIGN KEY ("radar_id") REFERENCES "public"."radars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_listing_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."listing_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radars" ADD CONSTRAINT "radars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_runs" ADD CONSTRAINT "source_runs_source_slug_sources_slug_fk" FOREIGN KEY ("source_slug") REFERENCES "public"."sources"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_uq" ON "devices" USING btree ("expo_push_token");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "listing_events_unprocessed_idx" ON "listing_events" USING btree ("processed_at","at");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_source_listing_uq" ON "listings" USING btree ("source_slug","source_listing_id");--> statement-breakpoint
CREATE INDEX "listings_canonical_key_idx" ON "listings" USING btree ("canonical_key");--> statement-breakpoint
CREATE INDEX "listings_published_at_idx" ON "listings" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "listings_segment_municipality_idx" ON "listings" USING btree ("segment","municipality");--> statement-breakpoint
CREATE INDEX "listings_active_idx" ON "listings" USING btree ("removed_at","closes_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_listing_channel_uq" ON "notifications" USING btree ("user_id","listing_id","channel");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "radars_user_idx" ON "radars" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "radars_active_idx" ON "radars" USING btree ("active");--> statement-breakpoint
CREATE INDEX "source_runs_source_started_idx" ON "source_runs" USING btree ("source_slug","started_at");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");