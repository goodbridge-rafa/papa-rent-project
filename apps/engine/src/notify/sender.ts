import { devices, listings, notifications, radars, sources, user } from "@papa/db";
import { and, eq, gt, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { ExpoPushMessage } from "expo-server-sdk";
import type { AnyDb } from "../store";
import { isNeverGrouped, isUrgentListing } from "./matcher";
import {
  emailDigest,
  emailSingle,
  type Links,
  type ListingForTemplate,
  type Locale,
  type PushContent,
  pushClosingSoon,
  pushDailyCapReached,
  pushForListing,
  pushGrouped,
} from "./templates";
import { startOfLocalDay } from "./time";
import type { EmailTransport, PushTransport } from "./transports";

export interface SendStats {
  push: number;
  email: number;
  skipped: number;
  failed: number;
}

/** Push channels stored in `notifications.channel`. All count towards the volume caps. */
export const PUSH_CHANNELS = ["push", "push_closing", "push_cap"] as const;
/** Those with a scheduled send (`push_cap` is created at the moment the cap is hit). */
const DUE_PUSH_CHANNELS = ["push", "push_closing"];

/** §5.2: above 10 individual pushes in the last hour, everything else becomes grouped. */
export const PUSH_HOURLY_CAP = 10;
/** §5.2: 25 pushes per day; once reached, only feed/inbox plus one final summary push. */
export const PUSH_DAILY_CAP = 25;
/** §10.4: at most 1 instant email every 10 min per user. */
export const EMAIL_MIN_INTERVAL_MS = 10 * 60 * 1000;

interface Due {
  id: number;
  userId: string;
  channel: string;
  radarName: string | null;
  email: string;
  locale: string | null;
  listing: ListingForTemplate & { stale?: boolean };
}

const asLocale = (l: string | null | undefined): Locale => (l === "en" ? "en" : "nl");

async function loadDue(db: AnyDb, channels: string[], now: Date, limit: number): Promise<Due[]> {
  const rows = (await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      channel: notifications.channel,
      radarName: radars.name,
      email: user.email,
      locale: user.locale,
      l_id: listings.id,
      l_title: listings.title,
      l_city: listings.city,
      l_municipality: listings.municipality,
      l_priceNet: listings.priceNet,
      l_bedrooms: listings.bedrooms,
      l_areaM2: listings.areaM2,
      l_segment: listings.segment,
      l_model: listings.allocationModel,
      l_first: listings.closesAfterFirstReaction,
      l_closesAt: listings.closesAt,
      l_sourceSlug: listings.sourceSlug,
      l_sourceName: sources.name,
      l_url: listings.url,
      l_removedAt: listings.removedAt,
    })
    .from(notifications)
    .innerJoin(listings, eq(listings.id, notifications.listingId))
    .innerJoin(user, eq(user.id, notifications.userId))
    .leftJoin(radars, eq(radars.id, notifications.radarId))
    .leftJoin(sources, eq(sources.slug, listings.sourceSlug))
    .where(
      and(
        eq(notifications.status, "pending"),
        inArray(notifications.channel, channels),
        lte(notifications.scheduledFor, now.toISOString()),
      ),
    )
    .orderBy(notifications.id)
    .limit(limit)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    userId: r.userId as string,
    channel: r.channel as string,
    radarName: (r.radarName as string | null) ?? null,
    email: r.email as string,
    locale: (r.locale as string | null) ?? null,
    listing: {
      id: r.l_id as number,
      title: r.l_title as string,
      city: r.l_city as string | null,
      municipality: r.l_municipality as string | null,
      priceNet: r.l_priceNet as number | null,
      bedrooms: r.l_bedrooms as number | null,
      areaM2: r.l_areaM2 as number | null,
      segment: r.l_segment as string,
      allocationModel: r.l_model as string,
      closesAfterFirstReaction: (r.l_first as boolean | null) ?? false,
      closesAt: r.l_closesAt as string | null,
      sourceSlug: r.l_sourceSlug as string,
      sourceName: (r.l_sourceName as string | null) ?? null,
      url: r.l_url as string,
      // listings already removed/closed are not worth a late alert — nor a closing reminder
      ...(r.l_removedAt || (r.l_closesAt && new Date(r.l_closesAt as string) <= now)
        ? { stale: true }
        : {}),
    },
  }));
}

async function mark(
  db: AnyDb,
  ids: number[],
  status: "sent" | "failed" | "skipped",
  now: Date,
  error?: string,
) {
  if (!ids.length) return;
  await db
    .update(notifications)
    .set({
      status,
      // the cycle's clock, not the database now(): the volume counts read this column, and all
      // rows delivered in the same physical push share the same instant (see `sentPushCounts`)
      sentAt: status === "sent" ? now.toISOString() : null,
      error: error ?? null,
    })
    .where(inArray(notifications.id, ids));
}

/**
 * Pushes already delivered to the user in the last hour and in the current local day (§5.2).
 *
 * Counts **deliveries**, not notification rows: the §5.2 caps are in pushes ("25 pushes per
 * user per day") and one grouped push covers N rows — counting rows made a single grouped push of
 * 25 listings spend the whole day and silence the following alerts, urgent ones included.
 * Without a batch column in the schema, the delivery key is `sent_at`: `sendDue` gives each physical
 * push its own instant (a distinct ms within the cycle) and stamps every row that push covered
 * with it, so `count(distinct sent_at)` is exactly the number of pushes delivered.
 * `capNotice` still counts rows: the cap notice is always one row for one push.
 */
async function sentPushCounts(
  db: AnyDb,
  userId: string,
  now: Date,
): Promise<{ hour: number; day: number; capNotice: number }> {
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayStart = startOfLocalDay(now).toISOString();
  const [row] = (await db
    .select({
      hour: sql<number>`(count(distinct ${notifications.sentAt}) filter (where ${notifications.sentAt} >= ${hourStart}))::int`,
      day: sql<number>`(count(distinct ${notifications.sentAt}) filter (where ${notifications.sentAt} >= ${dayStart}))::int`,
      capNotice: sql<number>`(count(*) filter (where ${notifications.sentAt} >= ${dayStart} and ${notifications.channel} = 'push_cap'))::int`,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        inArray(notifications.channel, [...PUSH_CHANNELS]),
        eq(notifications.status, "sent"),
        gte(notifications.sentAt, dayStart < hourStart ? dayStart : hourStart),
      ),
    )) as Array<{ hour: number; day: number; capNotice: number }>;
  return { hour: row?.hour ?? 0, day: row?.day ?? 0, capNotice: row?.capNotice ?? 0 };
}

/**
 * Has an email already gone to this user within the §10.4 window? One email delivery stamps N
 * rows with the same instant, so the existence of one delivered `email` row in the window suffices.
 */
async function emailSentWithin(db: AnyDb, userId: string, since: Date): Promise<boolean> {
  const [row] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.channel, "email"),
        eq(notifications.status, "sent"),
        // strictly inside the window: after exactly 10 min the next email may go out
        gt(notifications.sentAt, since.toISOString()),
      ),
    )) as Array<{ n: number }>;
  return (row?.n ?? 0) > 0;
}

/**
 * Sends whatever is pending and due.
 * Push: grouped per user. Closing reminders and `direct` listings always go out individually and
 * immediately (§5.3); > 3 groupable listings become one grouped push, and the same happens when the
 * hourly cap was already hit (§5.2). When the daily cap is hit, the rest stays in the inbox only and
 * a single final push goes out with "N more listings".
 * Email: 1 listing → simple email; several → summary; at most 1 email per 10 min (§10.4).
 * Invalid tokens disable the device.
 */
export async function sendDue(
  db: AnyDb,
  transports: { push: PushTransport; email: EmailTransport },
  links: Links,
  opts: { now?: Date; limit?: number } = {},
): Promise<SendStats> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 500;
  const stats: SendStats = { push: 0, email: 0, skipped: 0, failed: 0 };

  // ---- push
  const duePush = await loadDue(db, DUE_PUSH_CHANNELS, now, limit);
  const byUser = new Map<string, Due[]>();
  for (const d of duePush) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
  for (const [userId, items] of byUser) {
    const stale = items.filter((i) => i.listing.stale);
    const fresh = items.filter((i) => !i.listing.stale);
    await mark(
      db,
      stale.map((i) => i.id),
      "skipped",
      now,
      "stale",
    );
    stats.skipped += stale.length;
    if (!fresh.length) continue;
    const devs = (await db
      .select({ token: devices.expoPushToken })
      .from(devices)
      .where(and(eq(devices.userId, userId), isNull(devices.disabledAt)))) as Array<{
      token: string;
    }>;
    if (!devs.length) {
      await mark(
        db,
        fresh.map((i) => i.id),
        "skipped",
        now,
        "no_device",
      );
      stats.skipped += fresh.length;
      continue;
    }
    const locale = asLocale(fresh[0]?.locale);
    const counts = await sentPushCounts(db, userId, now);
    const closing = fresh.filter((i) => i.channel === "push_closing");
    const alerts = fresh.filter((i) => i.channel !== "push_closing");
    // §5.3: only `direct` (and the unlabelled `direct`) escapes grouping and the hourly cap. A short
    // deadline is urgency for quiet hours (§7), not an exemption from grouping — separate predicates.
    const urgent = alerts.filter((i) => isNeverGrouped(i.listing));
    const rest = alerts.filter((i) => !isNeverGrouped(i.listing));

    const contents: Array<{ ids: number[]; content: PushContent }> = [];
    for (const i of closing)
      contents.push({
        ids: [i.id],
        content: pushClosingSoon(i.listing, i.radarName ?? "Radar", locale, links, now),
      });
    for (const i of urgent)
      contents.push({
        ids: [i.id],
        content: pushForListing(i.listing, i.radarName ?? "Radar", locale, links, now),
      });
    if (rest.length) {
      // hourly cap hit → everything left becomes a single grouped push (§5.2)
      if (counts.hour >= PUSH_HOURLY_CAP || rest.length > 3) {
        const regio = rest[0]?.listing.municipality ?? rest[0]?.listing.city ?? "";
        contents.push({
          ids: rest.map((i) => i.id),
          content: pushGrouped(
            rest.map((i) => i.listing),
            regio,
            locale,
            links,
          ),
        });
      } else
        for (const i of rest)
          contents.push({
            ids: [i.id],
            content: pushForListing(i.listing, i.radarName ?? "Radar", locale, links, now),
          });
    }

    // daily cap: whatever exceeds it stays in the inbox and gets one final summary push (§5.2)
    const budget = Math.max(0, PUSH_DAILY_CAP - counts.day);
    const allowed = contents.slice(0, budget);
    const capped = contents.slice(budget);
    const cappedIds = capped.flatMap((c) => c.ids);
    if (cappedIds.length) {
      await mark(db, cappedIds, "skipped", now, "daily_cap");
      stats.skipped += cappedIds.length;
      const anchorListing = fresh.find((i) => cappedIds.includes(i.id))?.listing.id;
      if (counts.capNotice === 0 && anchorListing !== undefined) {
        // the notice is a real notification: anchored on the 1st cut listing, one per day (the count
        // above guarantees it) and the unique index (user, listing, channel) prevents repeats on one listing
        const [row] = (await db
          .insert(notifications)
          .values({
            userId,
            listingId: anchorListing,
            channel: "push_cap",
            scheduledFor: now.toISOString(),
          })
          .onConflictDoNothing()
          .returning({ id: notifications.id })) as Array<{ id: number }>;
        if (row)
          allowed.push({
            ids: [row.id],
            content: pushDailyCapReached(cappedIds.length, locale, links),
          });
      }
    }
    if (!allowed.length) continue;

    const messages: Array<ExpoPushMessage & { to: string; _ids: number[] }> = [];
    for (const c of allowed) {
      for (const d of devs) {
        const msg: ExpoPushMessage & { to: string; _ids: number[] } = {
          to: d.token,
          title: c.content.title,
          body: c.content.body,
          data: c.content.data,
          sound: "default",
          priority: "high",
          channelId: c.content.channelId,
          _ids: c.ids,
        };
        if (c.content.subtitle) msg.subtitle = c.content.subtitle;
        messages.push(msg);
      }
    }
    const results = await transports.push.send(messages.map(({ _ids, ...m }) => m));
    const okIds = new Set<number>();
    const failIds = new Map<number, string>();
    for (const [i, r] of results.entries()) {
      const m = messages[i];
      if (!m) continue;
      if (r.ok) for (const id of m._ids) okIds.add(id);
      else for (const id of m._ids) if (!okIds.has(id)) failIds.set(id, r.error ?? "push_failed");
      if (!r.ok && r.error === "DeviceNotRegistered") {
        await db
          .update(devices)
          .set({ disabledAt: sql`now()` })
          .where(eq(devices.expoPushToken, r.token));
      }
    }
    for (const id of okIds) failIds.delete(id);
    // One mark per physical push, with its own instant: `sent_at` identifies the delivery for
    // the volume caps (see `sentPushCounts`). Rows covered by a grouped push share the instant
    // of their own push, not the neighbour's.
    for (const [k, c] of allowed.entries()) {
      const ids = c.ids.filter((id) => okIds.has(id));
      await mark(db, ids, "sent", new Date(now.getTime() + k));
    }
    for (const [id, err] of failIds) await mark(db, [id], "failed", now, err);
    stats.push += okIds.size;
    stats.failed += failIds.size;
  }

  // ---- email
  const dueEmail = await loadDue(db, ["email"], now, limit);
  const emailByUser = new Map<string, Due[]>();
  for (const d of dueEmail) emailByUser.set(d.userId, [...(emailByUser.get(d.userId) ?? []), d]);
  for (const [userId, items] of emailByUser) {
    const stale = items.filter((i) => i.listing.stale);
    const fresh = items.filter((i) => !i.listing.stale);
    await mark(
      db,
      stale.map((i) => i.id),
      "skipped",
      now,
      "stale",
    );
    stats.skipped += stale.length;
    const first = fresh[0];
    if (!first) continue;
    // §10.4: 1 email every 10 min. Inside the window nothing goes out and nothing is marked — rows stay
    // `pending` and the next eligible cycle merges them into one summary (the spec's "groups
    // automatically on the next cycle"), instead of one email per notifier cycle (5 s).
    // An urgent listing passes: the slot closes in seconds and, for users without a device, email
    // is the only channel — the same reason the matcher exempts it from quiet hours (§7).
    // Note: `channel = 'email'` also covers the daily digest, which may thus be delayed up to 10 min;
    // separating them needs a dedicated channel in the schema.
    const urgent = fresh.some((i) => isUrgentListing(i.listing, now));
    if (
      !urgent &&
      (await emailSentWithin(db, userId, new Date(now.getTime() - EMAIL_MIN_INTERVAL_MS)))
    )
      continue;
    const locale = asLocale(first.locale);
    const content =
      fresh.length === 1
        ? emailSingle(first.listing, first.radarName ?? "Radar", locale, links, now)
        : emailDigest(
            fresh.map((i) => i.listing),
            locale,
            links,
            now,
          );
    const res = await transports.email.send({ to: first.email, ...content });
    const ids = fresh.map((i) => i.id);
    if (res.ok) {
      await mark(db, ids, "sent", now);
      stats.email += ids.length;
    } else if (res.skipped) {
      // transport without credentials (dev): nothing went out, so nothing is marked as delivered
      await mark(db, ids, "skipped", now, res.error ?? "email_not_configured");
      stats.skipped += ids.length;
    } else {
      await mark(db, ids, "failed", now, res.error);
      stats.failed += ids.length;
    }
  }
  return stats;
}
