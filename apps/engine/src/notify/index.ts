import type { Logger } from "pino";
import type { AnyDb } from "../store";
import { matchNewEvents, scheduleClosingReminders } from "./matcher";
import { sendDue } from "./sender";
import type { Links } from "./templates";
import {
  type EmailTransport,
  ExpoPushTransport,
  NoopEmailTransport,
  type PushTransport,
  ResendEmailTransport,
} from "./transports";

export * from "./matcher";
export * from "./sender";
export * from "./templates";
export * from "./time";
export * from "./transports";

/**
 * In production without `RESEND_API_KEY` we fail at startup: degrading silently would lose every
 * email without anyone noticing. In development the Noop keeps going, but marks nothing as
 * delivered (see `NoopEmailTransport`).
 */
export function transportsFromEnv(
  env = process.env,
  log?: Logger,
): { push: PushTransport; email: EmailTransport } {
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === "production")
      throw new Error(
        "RESEND_API_KEY missing: in production we refuse to start without an email transport (silent loss)",
      );
    log?.warn(
      "RESEND_API_KEY missing: emails are not sent, they stay skipped (NoopEmailTransport)",
    );
    return { push: new ExpoPushTransport(), email: new NoopEmailTransport() };
  }
  return {
    push: new ExpoPushTransport(),
    email: new ResendEmailTransport(
      env.RESEND_API_KEY,
      env.EMAIL_FROM ?? "PAPA RENT <alerts@example.com>",
    ),
  };
}

export function linksFromEnv(env = process.env): Links {
  return {
    appScheme: env.APP_SCHEME ?? "paparent",
    webUrl: env.WEB_URL ?? "https://app.example.com",
  };
}

/** One cycle: match new events, schedule closing reminders and send whatever is due. */
export async function notifyOnce(
  db: AnyDb,
  deps: { transports: ReturnType<typeof transportsFromEnv>; links: Links; log: Logger },
  now = new Date(),
) {
  const m = await matchNewEvents(db, { now });
  const c = await scheduleClosingReminders(db, { now });
  const s = await sendDue(db, deps.transports, deps.links, { now });
  if (m.events || c.closingReminders || s.push || s.email || s.failed)
    deps.log.info({ ...m, ...c, ...s }, "notify cycle");
  return { ...m, ...c, ...s };
}

/** Continuous loop (production): every `intervalMs`. Returns a stop function. */
export function startNotifier(
  db: AnyDb,
  deps: { transports: ReturnType<typeof transportsFromEnv>; links: Links; log: Logger },
  intervalMs = 5_000,
) {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await notifyOnce(db, deps);
    } catch (err) {
      deps.log.error({ err: String(err) }, "notify cycle failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
