/**
 * Builds the DEMO dataset of the static web demo (`src/lib/demo/dataset.json`).
 *
 * Why this way: the public demo has no server, database or accounts, yet it must not fake the
 * API either. This script runs the **real API** against an **in-memory** database (PGlite),
 * seeded with the small **fictional** listing set in `demo-listings.ts`. The recorded responses
 * are, byte for byte, what the API would return for that data: the contract cannot drift because
 * there is no second contract.
 *
 * The data is invented on purpose: no real addresses, landlords, photos or people end up in a
 * public build. Offline by construction: no network, no accounts, no paid services, no scraping.
 *
 * Run (tsx comes from the API package, so the mobile app needs no extra dependency):
 *   pnpm --filter @papa/api exec tsx ../mobile/scripts/build-demo-dataset.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Relative imports on purpose: the mobile app does not depend on the database package.
import { createTestDb } from "../../../packages/db/src/test-db";
import { createApp } from "../../api/src/app";
import { CONSENT_VERSION, createAuth } from "../../api/src/auth";
import { applyListings, syncSources } from "../../engine/src/store";
import { DEMO_SOURCES, demoListings } from "./demo-listings";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const OUT = resolve(HERE, "../src/lib/demo/dataset.json");

/**
 * Snapshot date. Fixed and explicit: the demo tells the user which date its example data
 * describes. See `DemoBanner` in the app.
 */
const SNAPSHOT_AT = "2026-10-01T00:00:00.000Z";

async function main() {
  const { db, close } = await createTestDb();
  try {
    await syncSources(db, DEMO_SOURCES);

    const all = demoListings();
    for (const source of DEMO_SOURCES) {
      const own = all.filter((l) => l.sourceSlug === source.slug);
      await applyListings(db, source.slug, own, new Map(), new Date(0).toISOString());
      console.log(`  ${source.slug.padEnd(20)} ${String(own.length).padStart(4)} listings`);
    }
    console.log(`\n  ${all.length} fictional listings seeded\n`);

    // Development NODE_ENV: the strict production checks (strong secret, URL, mandatory e-mail
    // transport) stay intact; they just do not apply to an offline generator.
    const auth = createAuth(db, { NODE_ENV: "development", LOG_LEVEL: "silent" });
    const app = createApp(db, { auth });

    // A fictional demo user, created through the real API (same flow as a real user).
    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "demo@example.com",
        password: "demo-only-password",
        name: "Demo User",
        dateOfBirth: "1990-01-01",
        locale: "nl",
        consentVersion: CONSENT_VERSION,
        householdSize: 2,
        incomeBand: "lt_midden",
        isSocialTenant: false,
        keyProfession: false,
      }),
    });
    if (!signUp.ok) throw new Error(`sign-up failed: ${signUp.status} ${await signUp.text()}`);
    const cookie = signUp.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (!cookie) throw new Error("sign-up returned no cookie");
    const h = { cookie, "content-type": "application/json" };

    // Radars chosen so that together they cover every fictional listing: an empty demo radar
    // demonstrates nothing. `segments` only accepts social|midden: the product is the regulated
    // market (packages/core/src/radar.ts).
    const radarDefs = [
      {
        name: "Amsterdam & omgeving",
        segments: ["midden"],
        municipalities: ["Amsterdam", "Amstelveen", "Haarlem"],
      },
      {
        name: "Randstad sociaal",
        segments: ["social"],
        municipalities: ["Utrecht", "Rotterdam", "'s-Gravenhage"],
      },
      {
        name: "Oost-Nederland",
        segments: ["social", "midden"],
        municipalities: ["Arnhem", "Deventer", "Zwolle"],
      },
      {
        name: "Noord & Zuid",
        segments: ["social", "midden"],
        municipalities: ["Groningen", "Eindhoven", "Maastricht"],
      },
    ];
    const radarIds: string[] = [];
    for (const def of radarDefs) {
      const res = await app.request("/v1/radars", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ ...def, areaType: "municipalities" }),
      });
      if (!res.ok) throw new Error(`radar "${def.name}" failed: ${res.status} ${await res.text()}`);
      radarIds.push(((await res.json()) as { radar: { id: string } }).radar.id);
    }

    const get = async (path: string) => {
      const res = await app.request(path, { headers: { cookie } });
      if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
      return res.json();
    };

    const routes: Record<string, unknown> = {};
    // `/v1/sources` is public, but the feed and the detail ask for it to swap the source slug for
    // its readable name. Without it recorded, every one of those pages would hit a refusal and
    // show the slug.
    routes["/v1/sources"] = await get("/v1/sources");
    routes["/v1/me"] = await get("/v1/me");
    routes["/v1/radars"] = await get("/v1/radars");
    routes["/v1/feed"] = await get("/v1/feed?limit=60");
    routes["/v1/notifications"] = await get("/v1/notifications");
    for (const id of radarIds) {
      routes[`/v1/radars/${id}/feed`] = await get(`/v1/radars/${id}/feed?limit=60`);
    }

    // Detail of every listing that appears in any feed: that is where the user taps.
    const ids = new Set<number>();
    for (const [path, body] of Object.entries(routes)) {
      if (!path.includes("feed")) continue;
      for (const l of (body as { listings?: Array<{ id: number }> }).listings ?? []) ids.add(l.id);
    }
    if (ids.size < all.length)
      throw new Error(`only ${ids.size} of ${all.length} listings reach a radar feed`);
    for (const id of ids) routes[`/v1/listings/${id}`] = await get(`/v1/listings/${id}`);

    const dataset = {
      generatedBy: "apps/mobile/scripts/build-demo-dataset.ts",
      snapshotAt: SNAPSHOT_AT,
      note:
        "Demo snapshot with FICTIONAL listings (apps/mobile/scripts/demo-listings.ts): invented " +
        "streets, example.com links, no photos, a placeholder user. Generated offline by the " +
        "real API against an in-memory database; no network, accounts or paid services.",
      sources: DEMO_SOURCES.map((s) => s.slug),
      listingCount: ids.size,
      radarIds,
      routes,
    };
    writeFileSync(OUT, `${JSON.stringify(dataset, null, 2)}\n`);
    console.log(
      `  ${ids.size} listings · ${radarIds.length} radars · ${Object.keys(routes).length} responses`,
    );
    console.log(`  written to ${OUT.replace(ROOT, ".")}\n`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
