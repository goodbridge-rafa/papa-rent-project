import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { config } from "./config";
import { type AppLocale, deviceLocale } from "./i18n";
import { registerDevice } from "./queries";

/**
 * Push channels (docs/product/notifications.md §5.4). The engine tags each push with one of these
 * `channelId`s (apps/engine/src/notify/templates.ts). On Android a channel only exists if the app
 * registers it: without registration the system ignores the `channelId` and everything falls into
 * the default channel (`new`, declared in app.json via the expo-notifications plugin).
 *
 * Importance is chosen per channel, not at random: a listing closing in minutes cannot weigh the
 * same as a daily digest. Note: after the first registration the user is in charge; Android
 * freezes importance, sound and vibration of an existing channel. Changing these values only
 * affects new installs; to really change them you need a channel with a new id.
 */
export type PushChannelId = "new" | "closing" | "digest" | "system";

export const PUSH_CHANNEL_IDS: readonly PushChannelId[] = [
  "new",
  "closing",
  "digest",
  "system",
] as const;

/** The single v0.1 channel, from before the engine sent `channelId`. Removed at startup. */
const LEGACY_CHANNEL_ID = "alerts";

const ACCENT = "#FF6B1A";

type ChannelSettings = Omit<Notifications.NotificationChannelInput, "name" | "description">;

const CHANNEL_SETTINGS: Record<PushChannelId, ChannelSettings> = {
  // New listing: heads-up + sound. The alert that justifies the app's existence.
  new: {
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    enableVibrate: true,
    vibrationPattern: [0, 250, 250, 250],
    enableLights: true,
    lightColor: ACCENT,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  },
  // Closing soon (§6): the window is ending and the user has not applied yet. The most urgent.
  closing: {
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    enableVibrate: true,
    vibrationPattern: [0, 400, 150, 400, 150, 400],
    enableLights: true,
    lightColor: ACCENT,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  },
  // Digest (grouped, hourly cap, daily digest): sound, but without interrupting the screen.
  digest: {
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
    enableVibrate: false,
    vibrationPattern: null,
    enableLights: false,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  },
  // Service notices (e.g. daily cap reached): information, not urgency. Silent.
  system: {
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    enableVibrate: false,
    vibrationPattern: null,
    enableLights: false,
    showBadge: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  },
};

/** Name and description shown in Android settings (NL + EN, like the whole UI). */
const CHANNEL_COPY: Record<
  AppLocale,
  Record<PushChannelId, { name: string; description: string }>
> = {
  nl: {
    new: {
      name: "Nieuwe woningen",
      description: "Een melding zodra een woning die bij je radar past online komt.",
    },
    closing: {
      name: "Sluit bijna",
      description: "Herinnering vlak voor de reactietermijn sluit van een woning die je bekeek.",
    },
    digest: {
      name: "Samenvattingen",
      description: "Eén melding voor meerdere woningen tegelijk en het dagoverzicht.",
    },
    system: {
      name: "Service",
      description: "Berichten over de app zelf, zoals een drukke dag met veel aanbod.",
    },
  },
  en: {
    new: {
      name: "New homes",
      description: "An alert the moment a home matching your radar goes online.",
    },
    closing: {
      name: "Closing soon",
      description: "A reminder just before the deadline of a home you looked at.",
    },
    digest: {
      name: "Summaries",
      description: "One alert covering several homes at once, plus the daily digest.",
    },
    system: {
      name: "Service",
      description: "Messages about the app itself, such as a busy day with lots of supply.",
    },
  },
};

const asAppLocale = (locale: string | undefined): AppLocale =>
  locale?.toLowerCase().startsWith("nl") ? "nl" : "en";

/** Payload the engine sends (`templates.ts`). We only read what we use. */
interface PushData {
  listingId?: unknown;
  grouped?: unknown;
  capped?: unknown;
  closing?: unknown;
}

const dataOf = (content: Notifications.NotificationContent | undefined): PushData =>
  (content?.data ?? {}) as PushData;

/**
 * The channel a push belongs to, inferred from the payload.
 * iOS has no `channelId`, so we use the same flags the engine puts in `data`
 * (`closing`, `capped`, `grouped`): the same decision, on the client side.
 */
function channelOf(data: PushData): PushChannelId {
  if (data.closing) return "closing";
  if (data.capped !== undefined) return "system";
  if (data.grouped) return "digest";
  return "new";
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const channel = channelOf(dataOf(notification.request.content));
    const loud = channel === "new" || channel === "closing";
    return {
      // a service notice does not interrupt someone already in the app
      shouldShowBanner: channel !== "system",
      shouldShowList: true,
      shouldPlaySound: loud,
      shouldSetBadge: false,
      priority: loud
        ? Notifications.AndroidNotificationPriority.HIGH
        : Notifications.AndroidNotificationPriority.DEFAULT,
    };
  },
});

/**
 * Registers the four channels on Android. Idempotent and safe on any platform.
 * Runs at startup (see the bottom of the file) so a user who granted permission in an older
 * version also gets them, and again in `enablePush`.
 */
export async function registerPushChannels(locale?: string): Promise<void> {
  if (Platform.OS !== "android") return;
  const copy = CHANNEL_COPY[asAppLocale(locale ?? deviceLocale())];
  for (const id of PUSH_CHANNEL_IDS) {
    await Notifications.setNotificationChannelAsync(id, {
      ...CHANNEL_SETTINGS[id],
      ...copy[id],
    });
  }
  await Notifications.deleteNotificationChannelAsync(LEGACY_CHANNEL_ID);
}

export async function pushPermissionStatus(): Promise<
  "granted" | "denied" | "undetermined" | "unsupported"
> {
  if (Platform.OS === "web" || !Device.isDevice) return "unsupported";
  const s = await Notifications.getPermissionsAsync();
  return s.granted ? "granted" : s.canAskAgain ? "undetermined" : "denied";
}

/** Asks for permission, registers the Android channels and the Expo token with the API. Returns the final state. */
export async function enablePush(locale: string): Promise<"granted" | "denied" | "unsupported"> {
  if (Platform.OS === "web" || !Device.isDevice) return "unsupported";
  await registerPushChannels(locale);
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return "denied";
  if (!config.easProjectId) {
    console.warn(
      "EAS projectId missing or still a placeholder in app.json: push token not registered. Run `eas init` in apps/mobile.",
    );
    return "granted";
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: config.easProjectId }))
    .data;
  await registerDevice(token, Platform.OS === "ios" ? "ios" : "android", locale);
  return "granted";
}

/** Destination URL of a tapped notification (deep link inside the app). */
export function routeFromNotification(
  response: Notifications.NotificationResponse | null | undefined,
): string | null {
  if (!response) return null;
  const data = dataOf(response.notification.request.content);
  if (typeof data.listingId === "number") return `/listing/${data.listingId}`;
  // grouped (§3.5) and daily-cap notice (§5.2) have no single listing: they open the Inbox
  if (data.grouped || data.capped !== undefined) return "/(tabs)/inbox";
  return null;
}

// Channels registered at startup: the module is loaded by the root layout, and a push may arrive
// before the user opens the notifications screen again. Failing here must never break the app.
void registerPushChannels().catch((e: unknown) => {
  console.warn("Falhou o registo dos canais de push:", e);
});
