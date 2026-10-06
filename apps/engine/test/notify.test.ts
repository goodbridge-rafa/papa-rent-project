import { devices, listingEvents, listings, notifications, radars, sources, user } from "@papa/db";
import { createTestDb, type TestDb } from "@papa/db/test-db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  inQuietHours,
  isUrgentListing,
  nextAllowed,
  nextDigestAt,
  PUSH_DAILY_CAP,
  PUSH_HOURLY_CAP,
  pushForListing,
  startOfLocalDay,
  transportsFromEnv,
} from "../src/notify/index";
import { matchNewEvents, scheduleClosingReminders } from "../src/notify/matcher";
import { sendDue } from "../src/notify/sender";
import {
  FakeEmailTransport,
  FakePushTransport,
  NoopEmailTransport,
} from "../src/notify/transports";

const links = { appScheme: "paparent", webUrl: "https://app.example.com" };

let seq = 0;

async function seedBase(db: TestDb) {
  await db.insert(sources).values({
    slug: "example-portal",
    name: "Example Portal",
    kind: "consortium",
    stack: "zig365",
    tier: "A",
    status: "live",
  });
  await db.insert(user).values({
    id: "u1",
    name: "Ana",
    email: "ana@x.nl",
    dateOfBirth: new Date("1990-01-01"),
    consentVersion: "v1",
    locale: "nl",
  });
  await db
    .insert(devices)
    .values({ userId: "u1", expoPushToken: "ExponentPushToken[ok]", platform: "ios" });
}

async function addListing(db: TestDb, over: Partial<typeof listings.$inferInsert> = {}) {
  seq++;
  const [l] = await db
    .insert(listings)
    .values({
      sourceSlug: "example-portal",
      sourceListingId: `s${seq}`,
      canonicalKey: `k${seq}`,
      url: `https://w/${seq}`,
      title: `Garnichweg ${seq}, Eindhoven`,
      segment: "social",
      segmentReason: "t",
      allocationModel: "inschrijfduur",
      dwellingCategory: "apartment",
      rawHash: "h",
      priceNet: 700,
      bedrooms: 2,
      city: "Eindhoven",
      municipality: "Eindhoven",
      ...over,
    })
    .returning();
  if (!l) throw new Error("no listing");
  return l;
}

/**
 * N pushes already delivered (durable, as the engine stores them) to feed the volume caps.
 * Each physical push has its own `sentAt` — that instant identifies the delivery for
 * `sentPushCounts`, and two distinct pushes never share it.
 */
async function seedSentPushes(db: TestDb, userId: string, n: number, sentAt: Date) {
  for (let i = 0; i < n; i++) {
    const l = await addListing(db);
    const at = new Date(sentAt.getTime() + i).toISOString();
    await db.insert(notifications).values({
      userId,
      listingId: l.id,
      channel: "push",
      status: "sent",
      scheduledFor: at,
      sentAt: at,
    });
  }
}

const statusesOf = async (db: TestDb) =>
  (
    await db
      .select({
        c: notifications.channel,
        s: notifications.status,
        u: notifications.userId,
        e: notifications.error,
      })
      .from(notifications)
  )
    .map((r) => `${r.u}:${r.c}:${r.s}${r.e ? `:${r.e}` : ""}`)
    .sort();

describe("time helpers (Europe/Amsterdam)", () => {
  it("quiet hours across midnight and digest scheduling", () => {
    const night = new Date("2026-09-06T22:30:00Z"); // 00:30 local (CEST)
    expect(inQuietHours(night, "23:00", "07:00")).toBe(true);
    expect(nextAllowed(night, "23:00", "07:00").toISOString()).toBe("2026-09-07T05:00:00.000Z"); // 07:00 local
    const day = new Date("2026-09-06T10:00:00Z");
    expect(inQuietHours(day, "23:00", "07:00")).toBe(false);
    expect(nextAllowed(day, "23:00", "07:00")).toBe(day);
    expect(nextDigestAt(day).toISOString()).toBe("2026-09-07T06:00:00.000Z"); // 08:00 local next day
    expect(nextDigestAt(new Date("2026-09-06T04:00:00Z")).toISOString()).toBe(
      "2026-09-06T06:00:00.000Z",
    );
  });

  it("start of the local day, also in winter time", () => {
    // 00:30 local on the 7th → the local day started at 22:00Z on the 6th (CEST, UTC+2)
    expect(startOfLocalDay(new Date("2026-09-06T22:30:00Z")).toISOString()).toBe(
      "2026-09-06T22:00:00.000Z",
    );
    // winter time (CET, UTC+1)
    expect(startOfLocalDay(new Date("2026-01-15T10:00:00Z")).toISOString()).toBe(
      "2026-01-14T23:00:00.000Z",
    );
  });

  it("push templates follow the product spec", () => {
    const l = {
      id: 1,
      title: "Garnichweg 46, Eindhoven",
      city: "Eindhoven",
      municipality: "Eindhoven",
      priceNet: 932.93,
      bedrooms: 2,
      areaM2: 70,
      segment: "social",
      allocationModel: "loting",
      closesAt: "2026-09-07T10:00:00Z",
      sourceSlug: "example-portal",
      sourceName: "Example Portal",
      url: "https://x",
    };
    const p = pushForListing(l, "Eindhoven", "nl", links, new Date("2026-09-06T10:00:00Z"));
    expect(p.title).toBe("Loting: € 933 in Eindhoven");
    expect(p.body).toBe("Inschrijfduur telt niet mee. Sluit over 1d 0u.");
    expect(p.channelId).toBe("new");
    expect(pushForListing({ ...l, allocationModel: "direct" }, "R", "en", links).body).toMatch(
      /^First to respond/,
    );
    expect(pushForListing({ ...l, allocationModel: "inschrijfduur" }, "R", "nl", links).body).toBe(
      "3 kamers · 70 m² · sociale huur · via Example Portal",
    );
  });
});

describe("listing urgency (§5.3 / §7)", () => {
  const now = new Date("2026-09-06T22:30:00Z");
  const l = (over: Record<string, unknown>) => ({ allocationModel: "inschrijfduur", ...over });

  it("direct, close on first reaction and a short deadline are urgent", () => {
    expect(isUrgentListing(l({ allocationModel: "direct", closesAt: null }), now)).toBe(true);
    expect(isUrgentListing(l({ closesAfterFirstReaction: true, closesAt: null }), now)).toBe(true);
    expect(isUrgentListing(l({ closesAt: "2026-09-07T00:00:00Z" }), now)).toBe(true); // 1h30
  });

  it("a long, missing, past or unreadable deadline is not urgent", () => {
    expect(isUrgentListing(l({ closesAt: "2026-09-08T10:00:00Z" }), now)).toBe(false);
    expect(isUrgentListing(l({ closesAt: null }), now)).toBe(false);
    expect(isUrgentListing(l({ closesAt: "2026-09-06T21:00:00Z" }), now)).toBe(false); // already closed
    expect(isUrgentListing(l({ closesAt: "2026-09-06T22:30:00Z" }), now)).toBe(false); // closes right now
    expect(isUrgentListing(l({ closesAt: "nonsense" }), now)).toBe(false);
    expect(isUrgentListing(l({ closesAfterFirstReaction: false, closesAt: null }), now)).toBe(
      false,
    );
  });
});

describe("matcher + sender", () => {
  it("creates inbox/push/email once, respects quiet hours and digest, sends and disables dead tokens", async () => {
    const { db, close } = await createTestDb();
    try {
      await db.insert(sources).values({
        slug: "example-portal",
        name: "Example Portal",
        kind: "consortium",
        stack: "zig365",
        tier: "A",
        status: "live",
      });
      await db.insert(user).values([
        {
          id: "u1",
          name: "Ana",
          email: "ana@x.nl",
          dateOfBirth: new Date("1990-01-01"),
          consentVersion: "v1",
          locale: "nl",
        },
        {
          id: "u2",
          name: "Bob",
          email: "bob@x.nl",
          dateOfBirth: new Date("1990-01-01"),
          consentVersion: "v1",
          locale: "en",
        },
      ]);
      await db.insert(devices).values([
        { userId: "u1", expoPushToken: "ExponentPushToken[ok]", platform: "ios" },
        { userId: "u1", expoPushToken: "ExponentPushToken[dead]", platform: "android" },
      ]);
      await db.insert(radars).values([
        {
          userId: "u1",
          name: "Eindhoven",
          segments: ["social"],
          municipalities: ["eindhoven"],
          emailMode: "instant",
        },
        {
          userId: "u2",
          name: "Alles",
          areaType: "all",
          segments: ["social", "midden"],
          emailMode: "daily",
          quietStart: "23:00",
          quietEnd: "07:00",
        },
      ]);
      const l = await addListing(db, {
        title: "Garnichweg 46, Eindhoven",
        closesAt: "2026-09-08T10:00:00Z",
      });
      await db.insert(listingEvents).values({ listingId: l.id, type: "new" });

      const night = new Date("2026-09-06T22:30:00Z"); // 00:30 local
      const m1 = await matchNewEvents(db, { now: night });
      expect(m1).toEqual({ events: 1, matchedListings: 1, notifications: 6 });
      expect(await matchNewEvents(db, { now: night })).toEqual({
        events: 0,
        matchedListings: 0,
        notifications: 0,
      });
      const rows = await db.select().from(notifications);
      const u2push = rows.find((r) => r.userId === "u2" && r.channel === "push");
      const u2mail = rows.find((r) => r.userId === "u2" && r.channel === "email");
      expect(new Date(u2push?.scheduledFor ?? 0).toISOString()).toBe("2026-09-07T05:00:00.000Z"); // end of quiet hours
      expect(new Date(u2mail?.scheduledFor ?? 0).toISOString()).toBe("2026-09-07T06:00:00.000Z"); // resumo 08:00

      const push = new FakePushTransport({ "ExponentPushToken[dead]": "DeviceNotRegistered" });
      const email = new FakeEmailTransport();
      const s1 = await sendDue(db, { push, email }, links, { now: night });
      expect(s1).toEqual({ push: 1, email: 1, skipped: 0, failed: 0 }); // only u1 is outside quiet hours
      expect(push.sent).toHaveLength(2);
      expect(push.sent[0]?.channelId).toBe("new");
      expect(email.sent[0]?.subject).toBe("Nieuw: € 700 in Eindhoven · Eindhoven");
      const dead = await db.select().from(devices);
      expect(dead.find((d) => d.expoPushToken.includes("dead"))?.disabledAt).not.toBeNull();

      const morning = new Date("2026-09-07T06:30:00Z");
      const s2 = await sendDue(db, { push, email }, links, { now: morning });
      expect(s2.push).toBe(0); // u2 has no device → skipped
      expect(s2.skipped).toBe(1);
      expect(s2.email).toBe(1);
      expect(email.sent[1]?.subject).toBe("New: € 700 in Eindhoven · Alles");
      expect(await statusesOf(db)).toEqual([
        "u1:email:sent",
        "u1:inbox:pending",
        "u1:push:sent",
        "u2:email:sent",
        "u2:inbox:pending",
        "u2:push:skipped:no_device",
      ]);
    } finally {
      await close();
    }
  });

  it("an urgent listing breaks through quiet hours; a normal one waits for the morning", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      await db.insert(radars).values({
        userId: "u1",
        name: "Eindhoven",
        segments: ["social"],
        municipalities: ["eindhoven"],
        emailMode: "instant",
        quietStart: "23:00",
        quietEnd: "07:00",
      });
      const night = new Date("2026-09-07T00:00:00Z"); // 02:00 local, inside quiet hours
      const direct = await addListing(db, { allocationModel: "direct" });
      const firstReaction = await addListing(db, { closesAfterFirstReaction: true });
      const closingSoon = await addListing(db, { closesAt: "2026-09-07T01:00:00Z" }); // 1h
      const normal = await addListing(db, { closesAt: "2026-09-10T10:00:00Z" });
      for (const l of [direct, firstReaction, closingSoon, normal])
        await db.insert(listingEvents).values({ listingId: l.id, type: "new" });

      await matchNewEvents(db, { now: night });
      const at = async (listingId: number, channel: string) => {
        const [r] = await db
          .select({ s: notifications.scheduledFor })
          .from(notifications)
          .where(and(eq(notifications.listingId, listingId), eq(notifications.channel, channel)));
        return new Date(r?.s ?? 0).toISOString();
      };
      expect(await at(direct.id, "push")).toBe(night.toISOString());
      expect(await at(direct.id, "email")).toBe(night.toISOString());
      expect(await at(firstReaction.id, "push")).toBe(night.toISOString());
      expect(await at(closingSoon.id, "push")).toBe(night.toISOString());
      expect(await at(normal.id, "push")).toBe("2026-09-07T05:00:00.000Z"); // 07:00 local

      const push = new FakePushTransport();
      const s = await sendDue(db, { push, email: new FakeEmailTransport() }, links, { now: night });
      expect(s.push).toBe(3); // the three urgent ones go out at 2 a.m., individually (§5.3)
      expect(push.sent.map((m) => m.channelId)).toEqual(["new", "new", "new"]);
      expect(push.sent.some((m) => String(m.title).startsWith("Direct:"))).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("volume caps (§5.2)", () => {
  it("the 11th push of the hour becomes a grouped summary", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const now = new Date("2026-09-07T12:00:00Z"); // 14:00 local
      await seedSentPushes(db, "u1", PUSH_HOURLY_CAP, new Date("2026-09-07T11:30:00Z"));
      const l = await addListing(db, { closesAt: "2026-09-10T10:00:00Z" });
      await db.insert(notifications).values({
        userId: "u1",
        listingId: l.id,
        channel: "push",
        scheduledFor: now.toISOString(),
      });

      const push = new FakePushTransport();
      const s = await sendDue(db, { push, email: new FakeEmailTransport() }, links, { now });
      expect(s.push).toBe(1);
      expect(push.sent).toHaveLength(1);
      expect(push.sent[0]?.channelId).toBe("digest");
      expect(push.sent[0]?.title).toBe("1 nieuwe woning in Eindhoven");
    } finally {
      await close();
    }
  });

  it("with 9 pushes in the hour it still goes out individually", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const now = new Date("2026-09-07T12:00:00Z");
      await seedSentPushes(db, "u1", PUSH_HOURLY_CAP - 1, new Date("2026-09-07T11:30:00Z"));
      const l = await addListing(db, { closesAt: "2026-09-10T10:00:00Z" });
      await db.insert(notifications).values({
        userId: "u1",
        listingId: l.id,
        channel: "push",
        scheduledFor: now.toISOString(),
      });

      const push = new FakePushTransport();
      await sendDue(db, { push, email: new FakeEmailTransport() }, links, { now });
      expect(push.sent[0]?.channelId).toBe("new");
      expect(push.sent[0]?.title).toBe("Nieuw: € 700 in Eindhoven");
    } finally {
      await close();
    }
  });

  it("pushes outside the one-hour window do not count", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const now = new Date("2026-09-07T12:00:00Z");
      await seedSentPushes(db, "u1", PUSH_HOURLY_CAP, new Date("2026-09-07T10:30:00Z")); // 1h30 ago
      const l = await addListing(db, { closesAt: "2026-09-10T10:00:00Z" });
      await db.insert(notifications).values({
        userId: "u1",
        listingId: l.id,
        channel: "push",
        scheduledFor: now.toISOString(),
      });

      const push = new FakePushTransport();
      await sendDue(db, { push, email: new FakeEmailTransport() }, links, { now });
      expect(push.sent[0]?.channelId).toBe("new");
    } finally {
      await close();
    }
  });

  it("daily cap reached: inbox only and a single final summary push", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const now = new Date("2026-09-07T12:00:00Z");
      await seedSentPushes(db, "u1", PUSH_DAILY_CAP, new Date("2026-09-07T09:00:00Z"));
      const a = await addListing(db, { allocationModel: "direct" });
      const b = await addListing(db, { closesAt: "2026-09-10T10:00:00Z" });
      for (const l of [a, b])
        await db.insert(notifications).values({
          userId: "u1",
          listingId: l.id,
          channel: "push",
          scheduledFor: now.toISOString(),
        });

      const push = new FakePushTransport();
      const s = await sendDue(db, { push, email: new FakeEmailTransport() }, links, { now });
      expect(s.skipped).toBe(2);
      expect(push.sent).toHaveLength(1);
      expect(push.sent[0]?.channelId).toBe("system");
      expect(push.sent[0]?.title).toBe("Veel aanbod vandaag");
      expect(push.sent[0]?.body).toBe("Nog 2 woningen — bekijk alles in de app.");
      const capped = await db
        .select({ s: notifications.status, e: notifications.error })
        .from(notifications)
        .where(eq(notifications.listingId, b.id));
      expect(capped[0]).toEqual({ s: "skipped", e: "daily_cap" });

      // second cycle on the same day: no second notice
      const c = await addListing(db, { closesAt: "2026-09-10T10:00:00Z" });
      await db.insert(notifications).values({
        userId: "u1",
        listingId: c.id,
        channel: "push",
        scheduledFor: now.toISOString(),
      });
      const s2 = await sendDue(db, { push, email: new FakeEmailTransport() }, links, { now });
      expect(s2).toEqual({ push: 0, email: 0, skipped: 1, failed: 0 });
      expect(push.sent).toHaveLength(1);

      // next local day: budget is available again
      const tomorrow = new Date("2026-09-08T12:00:00Z");
      const d = await addListing(db, { closesAt: "2026-09-10T10:00:00Z" });
      await db.insert(notifications).values({
        userId: "u1",
        listingId: d.id,
        channel: "push",
        scheduledFor: tomorrow.toISOString(),
      });
      const s3 = await sendDue(db, { push, email: new FakeEmailTransport() }, links, {
        now: tomorrow,
      });
      expect(s3.push).toBe(1);
      expect(push.sent[1]?.channelId).toBe("new");
    } finally {
      await close();
    }
  });

  it("a partial daily budget delivers what fits and summarises the rest", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const now = new Date("2026-09-07T12:00:00Z");
      await seedSentPushes(db, "u1", PUSH_DAILY_CAP - 1, new Date("2026-09-07T09:00:00Z"));
      const a = await addListing(db, { allocationModel: "direct" }); // urgent goes first
      const b = await addListing(db, { closesAt: "2026-09-10T10:00:00Z" });
      for (const l of [a, b])
        await db.insert(notifications).values({
          userId: "u1",
          listingId: l.id,
          channel: "push",
          scheduledFor: now.toISOString(),
        });

      const push = new FakePushTransport();
      const s = await sendDue(db, { push, email: new FakeEmailTransport() }, links, { now });
      expect(s.push).toBe(2); // the urgent one + the final notice
      expect(s.skipped).toBe(1);
      expect(push.sent.map((m) => m.channelId)).toEqual(["new", "system"]);
      expect(push.sent[0]?.title).toBe("Direct: € 700 in Eindhoven");
      expect(push.sent[1]?.body).toBe("Nog 1 woning — bekijk alles in de app.");
    } finally {
      await close();
    }
  });
});

describe("closing reminders (§6)", () => {
  const now = new Date("2026-09-07T12:00:00Z");

  async function seedAlerted(db: TestDb, over: Partial<typeof listings.$inferInsert>) {
    const l = await addListing(db, over);
    await db.insert(notifications).values({
      userId: "u1",
      listingId: l.id,
      channel: "push",
      status: "sent",
      scheduledFor: "2026-09-06T09:00:00Z",
      sentAt: "2026-09-06T09:00:00Z",
    });
    return l;
  }

  it("schedules per model, only once, and sends on the closing channel", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const loting = await seedAlerted(db, {
        allocationModel: "loting",
        closesAt: "2026-09-07T13:00:00Z", // 1h → within 2h
      });
      const punten = await seedAlerted(db, {
        allocationModel: "punten",
        closesAt: "2026-09-07T23:00:00Z", // 11h → within 12h
      });

      const c1 = await scheduleClosingReminders(db, { now });
      expect(c1).toEqual({ closingListings: 2, closingReminders: 2 });
      // idempotent: 1 reminder per listing per user, always
      expect(await scheduleClosingReminders(db, { now })).toEqual({
        closingListings: 2,
        closingReminders: 0,
      });
      const evs = await db
        .select({ t: listingEvents.type, l: listingEvents.listingId })
        .from(listingEvents);
      expect(evs.map((e) => `${e.t}:${e.l}`).sort()).toEqual(
        [`closing_soon:${loting.id}`, `closing_soon:${punten.id}`].sort(),
      );

      const push = new FakePushTransport();
      const s = await sendDue(db, { push, email: new FakeEmailTransport() }, links, { now });
      expect(s.push).toBe(2);
      expect(push.sent.map((m) => m.channelId)).toEqual(["closing", "closing"]);
      expect(push.sent[0]?.title).toBe("Sluit over 1u 0m: Eindhoven");
      expect(push.sent[0]?.body).toBe("€ 700 · 3 kamers · je hebt nog niet gereageerd");
    } finally {
      await close();
    }
  });

  it("outside the window, no deadline, model without reminder or no prior alert: nothing", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      await seedAlerted(db, { allocationModel: "loting", closesAt: "2026-09-07T18:00:00Z" }); // 6h > 2h
      await seedAlerted(db, {
        allocationModel: "inschrijfduur",
        closesAt: "2026-09-08T01:00:00Z",
      }); // 13h > 12h
      await seedAlerted(db, { allocationModel: "direct", closesAt: "2026-09-07T12:30:00Z" }); // §6: no reminder
      await seedAlerted(db, { allocationModel: "optie", closesAt: "2026-09-07T12:30:00Z" });
      await seedAlerted(db, { allocationModel: "unknown", closesAt: "2026-09-07T12:30:00Z" });
      await seedAlerted(db, { allocationModel: "loting", closesAt: null });
      // alerted but already removed from the source
      await seedAlerted(db, {
        allocationModel: "loting",
        closesAt: "2026-09-07T13:00:00Z",
        removedAt: "2026-09-07T11:00:00Z",
      });
      // inside the window, but the user never received the initial alert
      await addListing(db, { allocationModel: "loting", closesAt: "2026-09-07T13:00:00Z" });

      expect(await scheduleClosingReminders(db, { now })).toEqual({
        closingListings: 0,
        closingReminders: 0,
      });
    } finally {
      await close();
    }
  });

  it("a past deadline never creates nor sends a reminder", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const past = await seedAlerted(db, {
        allocationModel: "loting",
        closesAt: "2026-09-07T11:00:00Z", // closed an hour ago
      });
      expect(await scheduleClosingReminders(db, { now })).toEqual({
        closingListings: 0,
        closingReminders: 0,
      });

      // and if a reminder was scheduled before the close, it does not go out after it
      const later = await seedAlerted(db, {
        allocationModel: "loting",
        closesAt: "2026-09-07T13:00:00Z",
      });
      await scheduleClosingReminders(db, { now });
      const push = new FakePushTransport();
      const afterClose = new Date("2026-09-07T13:30:00Z");
      const s = await sendDue(db, { push, email: new FakeEmailTransport() }, links, {
        now: afterClose,
      });
      expect(s).toEqual({ push: 0, email: 0, skipped: 1, failed: 0 });
      expect(push.sent).toHaveLength(0);
      const [row] = await db
        .select({ s: notifications.status, e: notifications.error })
        .from(notifications)
        .where(
          and(eq(notifications.listingId, later.id), eq(notifications.channel, "push_closing")),
        );
      expect(row).toEqual({ s: "skipped", e: "stale" });
      const none = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(eq(notifications.listingId, past.id), eq(notifications.channel, "push_closing")),
        );
      expect(none).toHaveLength(0);
    } finally {
      await close();
    }
  });
});

describe("email transport", () => {
  it("fails at startup in production without a key and keeps the Noop in development", () => {
    expect(() => transportsFromEnv({ NODE_ENV: "production" })).toThrow(/RESEND_API_KEY/);
    expect(transportsFromEnv({ NODE_ENV: "development" }).email).toBeInstanceOf(NoopEmailTransport);
    expect(
      transportsFromEnv({ NODE_ENV: "production", RESEND_API_KEY: "re_x" }).email,
    ).not.toBeInstanceOf(NoopEmailTransport);
  });

  it("what the Noop does not send stays skipped, never delivered", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const now = new Date("2026-09-07T12:00:00Z");
      const l = await addListing(db, { closesAt: "2026-09-10T10:00:00Z" });
      await db.insert(notifications).values({
        userId: "u1",
        listingId: l.id,
        channel: "email",
        scheduledFor: now.toISOString(),
      });
      const email = new NoopEmailTransport();
      const s = await sendDue(db, { push: new FakePushTransport(), email }, links, { now });
      expect(s).toEqual({ push: 0, email: 0, skipped: 1, failed: 0 });
      expect(email.sent).toHaveLength(1); // visible in dev
      expect(await statusesOf(db)).toEqual(["u1:email:skipped:email_not_configured"]);
    } finally {
      await close();
    }
  });

  it("a real transport failure stays failed, with the error", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const now = new Date("2026-09-07T12:00:00Z");
      const l = await addListing(db, { closesAt: "2026-09-10T10:00:00Z" });
      await db.insert(notifications).values({
        userId: "u1",
        listingId: l.id,
        channel: "email",
        scheduledFor: now.toISOString(),
      });
      const s = await sendDue(
        db,
        { push: new FakePushTransport(), email: new FakeEmailTransport("resend_500") },
        links,
        { now },
      );
      expect(s).toEqual({ push: 0, email: 0, skipped: 0, failed: 1 });
      expect(await statusesOf(db)).toEqual(["u1:email:failed:resend_500"]);
    } finally {
      await close();
    }
  });
});

describe("caps count delivered pushes, not rows (§5.2)", () => {
  /** Creates n pending `push` rows, all due at `now`. */
  async function seedPending(db: TestDb, n: number, now: Date, over = {}) {
    for (let i = 0; i < n; i++) {
      const l = await addListing(db, { closesAt: "2026-09-20T10:00:00Z", ...over });
      await db.insert(notifications).values({
        userId: "u1",
        listingId: l.id,
        channel: "push",
        scheduledFor: now.toISOString(),
      });
    }
  }

  it("a grouped push spends 1 of the daily cap, not N: the next urgent one still goes out", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const morning = new Date("2026-09-07T06:00:00Z"); // 08:00 local
      await seedPending(db, 26, morning); // a consortium batch: > 3 → a single grouped push
      const push = new FakePushTransport();
      const email = new FakeEmailTransport();
      const s1 = await sendDue(db, { push, email }, links, { now: morning });
      expect(s1.push).toBe(26); // 26 linhas entregues...
      expect(push.sent).toHaveLength(1); // ...in a single physical push
      expect(push.sent[0]?.title).toBe("26 nieuwe woningen in Eindhoven");

      // two hours later a `direct` arrives: the slot closes in seconds and the day has barely started
      const later = new Date("2026-09-07T08:00:00Z"); // 10:00 local
      const d = await addListing(db, { allocationModel: "direct" });
      await db.insert(notifications).values({
        userId: "u1",
        listingId: d.id,
        channel: "push",
        scheduledFor: later.toISOString(),
      });
      const s2 = await sendDue(db, { push, email }, links, { now: later });
      expect(s2).toEqual({ push: 1, email: 0, skipped: 0, failed: 0 });
      expect(push.sent).toHaveLength(2);
      expect(push.sent[1]?.title).toBe("Direct: € 700 in Eindhoven");
      const [row] = await db
        .select({ s: notifications.status, e: notifications.error })
        .from(notifications)
        .where(eq(notifications.listingId, d.id));
      expect(row).toEqual({ s: "sent", e: null });
    } finally {
      await close();
    }
  });

  it("a grouped push spends 1 of the hourly cap, not N", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const now = new Date("2026-09-07T12:00:00Z");
      await seedPending(db, 10, now);
      const push = new FakePushTransport();
      const email = new FakeEmailTransport();
      await sendDue(db, { push, email }, links, { now });
      expect(push.sent).toHaveLength(1);

      // ten minutes later, a single listing: one push in the last hour, far from the cap of 10
      const later = new Date("2026-09-07T12:10:00Z");
      await seedPending(db, 1, later);
      await sendDue(db, { push, email }, links, { now: later });
      expect(push.sent).toHaveLength(2);
      expect(push.sent[1]?.channelId).toBe("new");
      expect(push.sent[1]?.title).toBe("Nieuw: € 700 in Eindhoven");
    } finally {
      await close();
    }
  });
});

describe("grouping: only `direct` escapes (§5.3)", () => {
  it("15 loting closing within 2 h become one grouped push; the direct goes out individually", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const now = new Date("2026-09-07T12:00:00Z");
      const closesAt = "2026-09-07T13:30:00Z"; // 90 min: urgent for quiet hours, groupable all the same
      for (let i = 0; i < 15; i++) {
        const l = await addListing(db, { allocationModel: "loting", closesAt });
        await db.insert(notifications).values({
          userId: "u1",
          listingId: l.id,
          channel: "push",
          scheduledFor: now.toISOString(),
        });
      }
      const d = await addListing(db, { allocationModel: "direct", closesAt });
      await db.insert(notifications).values({
        userId: "u1",
        listingId: d.id,
        channel: "push",
        scheduledFor: now.toISOString(),
      });

      const push = new FakePushTransport();
      await sendDue(db, { push, email: new FakeEmailTransport() }, links, { now });
      expect(push.sent.map((m) => m.channelId)).toEqual(["new", "digest"]);
      expect(push.sent[0]?.title).toBe("Direct: € 700 in Eindhoven");
      expect(push.sent[1]?.title).toBe("15 nieuwe woningen in Eindhoven");
    } finally {
      await close();
    }
  });

  it("with the hourly cap reached, a loting closing in 90 min is grouped too", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const now = new Date("2026-09-07T12:00:00Z");
      await seedSentPushes(db, "u1", PUSH_HOURLY_CAP, new Date("2026-09-07T11:30:00Z"));
      const l = await addListing(db, {
        allocationModel: "loting",
        closesAt: "2026-09-07T13:30:00Z",
      });
      await db.insert(notifications).values({
        userId: "u1",
        listingId: l.id,
        channel: "push",
        scheduledFor: now.toISOString(),
      });

      const push = new FakePushTransport();
      await sendDue(db, { push, email: new FakeEmailTransport() }, links, { now });
      expect(push.sent).toHaveLength(1);
      expect(push.sent[0]?.channelId).toBe("digest");
    } finally {
      await close();
    }
  });
});

describe("instant email frequency (§10.4)", () => {
  async function seedEmailRow(db: TestDb, now: Date, over = {}) {
    const l = await addListing(db, { closesAt: "2026-09-20T10:00:00Z", ...over });
    await db.insert(notifications).values({
      userId: "u1",
      listingId: l.id,
      channel: "email",
      scheduledFor: now.toISOString(),
    });
    return l;
  }

  it("at most 1 email every 10 min: the rest waits and goes out grouped", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const t0 = new Date("2026-09-07T12:00:00Z");
      await seedEmailRow(db, t0);
      const push = new FakePushTransport();
      const email = new FakeEmailTransport();
      expect(await sendDue(db, { push, email }, links, { now: t0 })).toEqual({
        push: 0,
        email: 1,
        skipped: 0,
        failed: 0,
      });
      expect(email.sent).toHaveLength(1);

      // five minutes later, two more listings: inside the window, nothing goes out and nothing is lost
      const t5 = new Date("2026-09-07T12:05:00Z");
      await seedEmailRow(db, t5);
      await seedEmailRow(db, t5);
      expect(await sendDue(db, { push, email }, links, { now: t5 })).toEqual({
        push: 0,
        email: 0,
        skipped: 0,
        failed: 0,
      });
      expect(email.sent).toHaveLength(1);
      const pending = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.channel, "email"), eq(notifications.status, "pending")));
      expect(pending).toHaveLength(2);

      // after the window, both go out in a single summary
      const t10 = new Date("2026-09-07T12:10:00Z");
      expect(await sendDue(db, { push, email }, links, { now: t10 })).toEqual({
        push: 0,
        email: 2,
        skipped: 0,
        failed: 0,
      });
      expect(email.sent).toHaveLength(2);
      expect(email.sent[1]?.subject).toBe("2 nieuwe woningen vandaag");
    } finally {
      await close();
    }
  });

  it("an urgent listing does not wait for the window", async () => {
    const { db, close } = await createTestDb();
    try {
      await seedBase(db);
      const t0 = new Date("2026-09-07T12:00:00Z");
      await seedEmailRow(db, t0);
      const push = new FakePushTransport();
      const email = new FakeEmailTransport();
      await sendDue(db, { push, email }, links, { now: t0 });
      expect(email.sent).toHaveLength(1);

      const t2 = new Date("2026-09-07T12:02:00Z");
      await seedEmailRow(db, t2, { allocationModel: "direct" });
      expect(await sendDue(db, { push, email }, links, { now: t2 })).toEqual({
        push: 0,
        email: 1,
        skipped: 0,
        failed: 0,
      });
      expect(email.sent).toHaveLength(2);
    } finally {
      await close();
    }
  });
});
