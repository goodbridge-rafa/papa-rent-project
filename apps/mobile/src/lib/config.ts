import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Values still to be filled in `app.json`/`eas.json` start with this (e.g. `REPLACE_ME-eas-project-id`).
 * We treat them as missing: a placeholder must fail as "not configured", never be used as if it
 * were real (a fake projectId would make `getExpoPushTokenAsync` blow up at runtime).
 */
const PLACEHOLDER_PREFIX = "REPLACE_ME";

/** Returns the value when it is real; `null` when it is empty or still a placeholder. */
function configured(value: string | null | undefined): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  return v.length > 0 && !v.startsWith(PLACEHOLDER_PREFIX) ? v : null;
}

/** `expo.scheme` may be a string or a list; the first value is the app's canonical scheme. */
function appScheme(): string {
  const s = Constants.expoConfig?.scheme;
  const first = Array.isArray(s) ? s[0] : s;
  return configured(first) ?? "paparent";
}

const easProjectId = configured(
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
);

/** `EXPO_PUBLIC_DEMO=1` turns on the serverless public demo. See `src/lib/demo/`. */
const demo = String(process.env.EXPO_PUBLIC_DEMO ?? "").trim() === "1";

/**
 * Public prefix when the app is served from a sub-path (e.g. `/demo`; see `PAPA_WEB_BASE_PATH`
 * in `app.config.js`). It comes from `expo.experiments.baseUrl`, which Expo applies to the web
 * export's assets; we keep it here for what is ours: absolute links and routes.
 * Empty on native, in development and when served from the root: native has NO prefix and must
 * never get one.
 */
function basePath(): string {
  if (Platform.OS !== "web") return "";
  const raw = (Constants.expoConfig?.experiments as { baseUrl?: string } | undefined)?.baseUrl;
  const v = configured(raw) ?? "";
  return v.replace(/\/$/, "");
}

export const config = {
  demo,
  basePath: basePath(),
  apiUrl: String(process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  webUrl: String(process.env.EXPO_PUBLIC_WEB_URL ?? "https://example.com").replace(/\/$/, ""),
  scheme: appScheme(),
  socialProviders: String(process.env.EXPO_PUBLIC_SOCIAL ?? "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean) as ("apple" | "google")[],
  easProjectId,
  appVersion: Constants.expoConfig?.version ?? "0.0.0",
  consentVersion: "2026-09-06",
};
