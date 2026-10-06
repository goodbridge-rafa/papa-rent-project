// Only for `better-auth generate` (table schema). Not used at runtime.
import { drizzle } from "drizzle-orm/postgres-js";
import { createAuth } from "./auth";

// `LOG_LEVEL: "silent"`: generation writes the schema to stdout, without the e-mail transport warning.
export const auth = createAuth(drizzle.mock(), { NODE_ENV: "development", LOG_LEVEL: "silent" });
