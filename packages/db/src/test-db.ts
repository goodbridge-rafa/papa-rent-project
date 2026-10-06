import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";

const schema = { ...appSchema, ...authSchema };

/** Real Postgres in WASM, in memory, with migrations applied. Tests and CI only. */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
