import { listingEvents, listings, matchingRadarsCondition, notifications, radars } from "@papa/db";
import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import type { AnyDb } from "../store";
import { nextAllowed, nextDigestAt } from "./time";

export interface MatchStats {
  events: number;
  matchedListings: number;
  notifications: number;
}

export interface ClosingStats {
  closingListings: number;
  closingReminders: number;
}

/** Urgency signals carried by the listing itself. */
export interface UrgencySignals {
  allocationModel: string;
  closesAfterFirstReaction?: boolean | null;
  closesAt?: string | Date | null;
}

/**
 * Window below which a closing deadline is urgent on its own. It is the shortest reminder lead
 * time in the spec (§6: loting, 2 h): below that the spec already says to break through quiet
 * hours, so holding such a listing until morning would deliver a home that has already closed.
 * Product parameter (docs/product/notifications.md), not a market value.
 */
export const URGENT_CLOSES_WITHIN_MS = 2 * 60 * 60 * 1000;

/**
 * Listing that is **never** grouped nor held back by the hourly cap: it goes out alone, at once.
 * §5.3 gives a single exception to grouping — `direct` — and says the opposite for the other
 * models: "`loting`, `punten`, `inschrijfduur`, `motivatie` and `optie` may be grouped". We add
 * `closesAfterFirstReaction` because it is a `direct` without the label (the source says it closes
 * on the first reaction). A short deadline does **not** belong here: a `loting` closing in 90 min
 * can still be grouped — the deadline is announced by the closing reminder (§6), which is
 * individual, carries the "sluit over" and exists for every groupable model with a deadline.
 */
export function isNeverGrouped(l: UrgencySignals): boolean {
  return l.allocationModel === "direct" || l.closesAfterFirstReaction === true;
}

/**
 * An urgent listing **breaks through** quiet hours (§7): holding it until morning would deliver a
 * home that has already closed. This is a different decision from grouping (§5.3, `isNeverGrouped`)
 * and has one extra signal — the short deadline:
 * - `direct`: whoever reacts first gets the home, the slot closes in seconds
 *   (`docs/knowledge/allocation-models.md`);
 * - `closesAfterFirstReaction`: the source says it closes on the first reaction — a `direct` without the label;
 * - `closesAt` within `URGENT_CLOSES_WITHIN_MS`.
 * A deadline already past is not urgent: it is dead, and dead does not raise an alert.
 */
export function isUrgentListing(l: UrgencySignals, now: Date): boolean {
  if (isNeverGrouped(l)) return true;
  if (!l.closesAt) return false;
  const closes = new Date(l.closesAt).getTime();
  if (!Number.isFinite(closes)) return false;
  const left = closes - now.getTime();
  return left > 0 && left <= URGENT_CLOSES_WITHIN_MS;
}

/**
 * Processes unhandled `new` events: for each listing, finds the active radars that match,
 * groups by user and creates (at most) one notification per channel: `inbox` always; `push` if any
 * radar has push; `email` depending on the mode (instant/daily). Quiet hours postpone push and
 * instant email — except for urgent listings (§7), which go out right away.
 * Idempotent: (user, listing, channel) is unique.
 */
export async function matchNewEvents(
  db: AnyDb,
  opts: { limit?: number; now?: Date } = {},
): Promise<MatchStats> {
  const now = opts.now ?? new Date();
  const stats: MatchStats = { events: 0, matchedListings: 0, notifications: 0 };
  const events = (await db
    .select({ id: listingEvents.id, listingId: listingEvents.listingId })
    .from(listingEvents)
    .where(and(isNull(listingEvents.processedAt), eq(listingEvents.type, "new")))
    .orderBy(asc(listingEvents.at))
    .limit(opts.limit ?? 200)) as Array<{ id: number; listingId: number }>;

  for (const ev of events) {
    stats.events++;
    const [l] = (await db
      .select()
      .from(listings)
      .where(eq(listings.id, ev.listingId))
      .limit(1)) as Array<typeof listings.$inferSelect>;
    const active = l && !l.removedAt && (!l.closesAt || new Date(l.closesAt) > now);
    if (active) {
      const hits = (await db
        .select({
          id: radars.id,
          userId: radars.userId,
          pushEnabled: radars.pushEnabled,
          emailMode: radars.emailMode,
          quietStart: radars.quietStart,
          quietEnd: radars.quietEnd,
        })
        .from(radars)
        .where(matchingRadarsCondition(l))) as Array<{
        id: string;
        userId: string;
        pushEnabled: boolean;
        emailMode: string;
        quietStart: string | null;
        quietEnd: string | null;
      }>;
      if (hits.length) stats.matchedListings++;
      // Urgent: quiet hours do not apply. Held at 23:00, a `direct` arrives dead at 07:00.
      const urgent = isUrgentListing(l, now);
      const byUser = new Map<string, typeof hits>();
      for (const h of hits) byUser.set(h.userId, [...(byUser.get(h.userId) ?? []), h]);
      for (const [userId, rs] of byUser) {
        const first = rs[0];
        if (!first) continue;
        const quiet = rs.find((r) => r.quietStart && r.quietEnd) ?? first;
        const allowedAt = urgent ? now : nextAllowed(now, quiet.quietStart, quiet.quietEnd);
        const rows: Array<{ channel: string; scheduledFor: string }> = [
          { channel: "inbox", scheduledFor: now.toISOString() },
        ];
        if (rs.some((r) => r.pushEnabled))
          rows.push({ channel: "push", scheduledFor: allowedAt.toISOString() });
        const modes = rs.map((r) => r.emailMode);
        if (modes.includes("instant"))
          rows.push({ channel: "email", scheduledFor: allowedAt.toISOString() });
        else if (modes.includes("daily"))
          rows.push({ channel: "email", scheduledFor: nextDigestAt(now).toISOString() });
        for (const r of rows) {
          const inserted = (await db
            .insert(notifications)
            .values({
              userId,
              radarId: first.id,
              listingId: l.id,
              eventId: ev.id,
              channel: r.channel,
              scheduledFor: r.scheduledFor,
            })
            .onConflictDoNothing()
            .returning({ id: notifications.id })) as Array<{ id: number }>;
          stats.notifications += inserted.length;
        }
      }
    }
    await db
      .update(listingEvents)
      .set({ processedAt: sql`now()` })
      .where(eq(listingEvents.id, ev.id));
  }
  return stats;
}

/**
 * Closing-reminder lead time per allocation model (§6). Missing models have no reminder on
 * purpose: `direct` closes in seconds (the initial alert was already the urgency),
 * `optie` is not a listing with a deadline, and `unknown` cannot be justified.
 */
export const CLOSING_REMINDER_LEAD_MS: Readonly<Record<string, number>> = {
  loting: 2 * 60 * 60 * 1000,
  inschrijfduur: 12 * 60 * 60 * 1000,
  punten: 12 * 60 * 60 * 1000,
  motivatie: 24 * 60 * 60 * 1000,
};

const MAX_CLOSING_LEAD_MS = Math.max(...Object.values(CLOSING_REMINDER_LEAD_MS));

/**
 * Closing reminders (§6): emits the listing's `closing_soon` event and schedules one push per user
 * who **already received** the initial alert (push with state `sent`) and whose listing is still active.
 * Own channel `push_closing`: the unique index (user, listing, channel) guarantees the spec's maximum
 * of **1 reminder per listing per user** without extra state.
 * Breaks through quiet hours by default (§6) — `scheduledFor` is now.
 * Never reminds of a past deadline: the close must be in the future here, and the sender re-checks on send.
 *
 * Deliberate deviation from §6: the spec also asks for "the user opened the detail or saved the listing"
 * and "has not yet marked gereageerd". There is no saved or reactions table, so the condition
 * used is "received the alert and the listing is still open".
 */
export async function scheduleClosingReminders(
  db: AnyDb,
  opts: { limit?: number; now?: Date } = {},
): Promise<ClosingStats> {
  const now = opts.now ?? new Date();
  const stats: ClosingStats = { closingListings: 0, closingReminders: 0 };
  const candidates = (await db
    .select({
      id: listings.id,
      closesAt: listings.closesAt,
      allocationModel: listings.allocationModel,
    })
    .from(listings)
    .where(
      and(
        isNull(listings.removedAt),
        gt(listings.closesAt, now.toISOString()),
        lte(listings.closesAt, new Date(now.getTime() + MAX_CLOSING_LEAD_MS).toISOString()),
        inArray(listings.allocationModel, Object.keys(CLOSING_REMINDER_LEAD_MS)),
      ),
    )
    .orderBy(asc(listings.closesAt))
    .limit(opts.limit ?? 200)) as Array<{
    id: number;
    closesAt: string | null;
    allocationModel: string;
  }>;

  const due = candidates.filter((c) => {
    const lead = CLOSING_REMINDER_LEAD_MS[c.allocationModel];
    if (lead === undefined || !c.closesAt) return false;
    const left = new Date(c.closesAt).getTime() - now.getTime();
    return left > 0 && left <= lead;
  });
  if (!due.length) return stats;

  const ids = due.map((d) => d.id);
  const existing = (await db
    .select({ listingId: listingEvents.listingId, id: listingEvents.id })
    .from(listingEvents)
    .where(
      and(eq(listingEvents.type, "closing_soon"), inArray(listingEvents.listingId, ids)),
    )) as Array<{ listingId: number; id: number }>;
  const eventByListing = new Map(existing.map((e) => [e.listingId, e.id]));

  const recipients = (await db
    .select({
      listingId: notifications.listingId,
      userId: notifications.userId,
      radarId: notifications.radarId,
    })
    .from(notifications)
    .where(
      and(
        inArray(notifications.listingId, ids),
        eq(notifications.channel, "push"),
        eq(notifications.status, "sent"),
      ),
    )) as Array<{ listingId: number; userId: string; radarId: string | null }>;

  for (const l of due) {
    const targets = recipients.filter((r) => r.listingId === l.id);
    if (!targets.length) continue;
    stats.closingListings++;
    let eventId = eventByListing.get(l.id);
    if (eventId === undefined) {
      const [ins] = (await db
        .insert(listingEvents)
        .values({
          listingId: l.id,
          type: "closing_soon",
          at: now.toISOString(),
          processedAt: now.toISOString(), // handled right here, there is no second pass
          payload: { closesAt: l.closesAt, leadMs: CLOSING_REMINDER_LEAD_MS[l.allocationModel] },
        })
        .returning({ id: listingEvents.id })) as Array<{ id: number }>;
      if (!ins) continue;
      eventId = ins.id;
      eventByListing.set(l.id, eventId);
    }
    for (const t of targets) {
      const inserted = (await db
        .insert(notifications)
        .values({
          userId: t.userId,
          radarId: t.radarId,
          listingId: l.id,
          eventId,
          channel: "push_closing",
          scheduledFor: now.toISOString(),
        })
        .onConflictDoNothing()
        .returning({ id: notifications.id })) as Array<{ id: number }>;
      stats.closingReminders += inserted.length;
    }
  }
  return stats;
}
