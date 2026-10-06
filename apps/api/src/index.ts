import { serve } from "@hono/node-server";
import { createDb } from "@papa/db";
import pino from "pino";
import { createApp } from "./app";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const port = Number(process.env.PORT ?? 3000);

/**
 * Explicit startup. `createApp` mounts Better Auth, which in production throws if
 * `BETTER_AUTH_SECRET` is missing (or weak), or `BETTER_AUTH_URL` or `RESEND_API_KEY` is missing.
 * Without this block the failure would surface as an unhandled rejection; this way there is one
 * readable line and exit code 1, instead of a container restarting with nobody knowing why.
 */
async function buildAppOrExit() {
  try {
    return createApp(await createDb());
  } catch (err) {
    log.fatal(
      { err: err instanceof Error ? err.message : String(err) },
      "api cannot start: invalid configuration",
    );
    process.exit(1);
  }
}

const app = await buildAppOrExit();

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  log.info({ port: info.port }, "papa-rent api listening");
});
