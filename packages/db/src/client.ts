import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";

const schema = { ...appSchema, ...authSchema };

export type Db = ReturnType<typeof drizzlePg<typeof schema>>;

/**
 * Database client.
 * - `postgres://…`  → real Postgres (production, VPS, local docker).
 * - `pglite://<dir>` → Postgres in WASM persisted to disk (dev without Docker, web sandbox). Migrates itself.
 * For tests use `createTestDb()` (in-memory PGlite).
 */
export async function createDb(url = process.env.DATABASE_URL): Promise<Db> {
  if (!url) throw new Error("DATABASE_URL is not set");
  if (url.startsWith("pglite://")) {
    // relative to the directory `pnpm` was invoked from (repo root), not the package cwd
    const dir = resolve(
      process.env.INIT_CWD ?? process.cwd(),
      url.slice("pglite://".length) || ".data/pglite",
    );
    const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
      import("@electric-sql/pglite"),
      import("drizzle-orm/pglite"),
      import("drizzle-orm/pglite/migrator"),
    ]);
    mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
    return db as unknown as Db;
  }
  const client = postgres(url, { max: 10, prepare: false });
  return drizzlePg(client, { schema });
}
