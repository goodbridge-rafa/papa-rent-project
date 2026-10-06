import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { expo } from "@better-auth/expo";
import * as authSchema from "@papa/db/auth-schema";
import { betterAuth } from "better-auth";
import pino, { type Logger } from "pino";
import { type EmailMessage, type Mailer, mailerFromEnv } from "./mail";

export interface AuthEnv {
  BETTER_AUTH_SECRET?: string | undefined;
  BETTER_AUTH_URL?: string | undefined;
  APP_SCHEME?: string | undefined;
  WEB_URL?: string | undefined;
  WEB_ORIGINS?: string | undefined; // csv
  /** Turns mandatory e-mail verification on. A product decision: see `REQUIRE_EMAIL_VERIFICATION`. */
  REQUIRE_EMAIL_VERIFICATION?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  EMAIL_FROM?: string | undefined;
  LOG_LEVEL?: string | undefined;
  APPLE_CLIENT_ID?: string | undefined;
  APPLE_CLIENT_SECRET?: string | undefined;
  APPLE_APP_BUNDLE_IDENTIFIER?: string | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  NODE_ENV?: string | undefined;
}

/** Version of the terms/privacy the user accepts at sign-up; changes when the texts change. */
export const CONSENT_VERSION = "2026-09-06";

/** Languages of transactional messages (UI and legal texts are NL + EN). */
export type AuthLocale = "nl" | "en";

const DEV_SECRET = "dev-secret-change-me-dev-secret-change-me";
/** Secrets that are no secret at all: our development one and Better Auth's example one. */
const KNOWN_WEAK_SECRETS = new Set([DEV_SECRET, "better-auth-secret-12345678901234567890"]);
const MIN_SECRET_LENGTH = 32;

/** Lifetime of the recovery link. Short: while it exists it is the only key to the account. */
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;
/** Lifetime of the e-mail verification link: more generous, it unlocks nothing on its own. */
export const VERIFICATION_TOKEN_TTL_SECONDS = 60 * 60 * 24;

/** Fallback only; deployments set `WEB_URL` (and `WEB_ORIGINS`) to their own domain. */
const DEFAULT_WEB_URL = "https://example.com";
const DEFAULT_APP_SCHEME = "paparent";

/** `"1"|"true"|"yes"|"on"` turn it on; empty or missing falls back to the default. */
export function envFlag(value: string | undefined, fallback = false): boolean {
  const v = value?.trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** `locale` is a user field (`defaultValue: "nl"`); anything other than `en` speaks NL. */
export function localeOf(user: unknown): AuthLocale {
  const value = (user as { locale?: unknown } | null | undefined)?.locale;
  return value === "en" ? "en" : "nl";
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const htmlDocument = (title: string, paragraphs: string[]) =>
  `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">` +
  `<h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(title)}</h1>` +
  paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join("") +
  `</body></html>`;

const link = (url: string) => `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;

/**
 * Where each link lands. The e-mail carries both because the service has two surfaces:
 * - `web`: goes through the API, which validates the token and only then redirects to `WEB_URL`;
 * - `app`: direct `APP_SCHEME://` deep link, for whoever opens the e-mail on a phone with the app installed.
 */
export interface RecoveryLinks {
  web: string;
  app: string;
}

/**
 * Better Auth hands over `.../reset-password/<token>?callbackURL=<redirectTo>` and leaves
 * `callbackURL` empty when the client asks for no destination: a link that dies on `/error`.
 * Here we fill the empty value (and verification's default `/`) with a destination of our own.
 */
export function withCallback(url: string, fallback: string): string {
  const parsed = new URL(url);
  const current = parsed.searchParams.get("callbackURL");
  if (!current || current === "/") parsed.searchParams.set("callbackURL", fallback);
  return parsed.toString();
}

/**
 * App deep link. Token in the query (not a path segment) so the app reads `token` the same way
 * in the native link and in the web link, which also arrives as `?token=`.
 */
export const appLink = (scheme: string, path: string, token: string) =>
  `${scheme}://${path}?token=${encodeURIComponent(token)}`;

export function resetPasswordLinks(
  data: { url: string; token: string },
  cfg: { webUrl: string; appScheme: string },
): RecoveryLinks {
  return {
    web: withCallback(data.url, `${cfg.webUrl}/reset-password`),
    app: appLink(cfg.appScheme, "reset-password", data.token),
  };
}

export function verifyEmailLinks(
  data: { url: string; token: string },
  cfg: { webUrl: string; appScheme: string },
): RecoveryLinks {
  return {
    // `/verify-email` is the route that exists on both surfaces (web and deep link); `/email-verified`
    // does not exist, and the e-mail link used to land on expo-router's "Unmatched Route" AFTER the
    // confirmation had already run. Better Auth consumes the token and redirects without re-attaching
    // it (and appends `?error=` to this same destination on failure), so we carry `verified=1`: the
    // signal that arriving without a token is a completed confirmation, not a resend request.
    web: withCallback(data.url, `${cfg.webUrl}/verify-email?verified=1`),
    app: appLink(cfg.appScheme, "verify-email", data.token),
  };
}

/** docs/product/screens.md S-03 · "wachtwoord vergeten". NL by default, EN for `locale: "en"`. */
export function resetPasswordEmail(
  locale: AuthLocale,
  links: RecoveryLinks,
  ttlSeconds = RESET_TOKEN_TTL_SECONDS,
): Omit<EmailMessage, "to"> {
  const minutes = Math.round(ttlSeconds / 60);
  if (locale === "en") {
    const title = "Reset your password";
    return {
      subject: `PAPA RENT · ${title}`,
      text: [
        "Hi,",
        "",
        "You asked to reset your PAPA RENT password.",
        "",
        "Open this link in your browser:",
        links.web,
        "",
        "Or open it straight in the app:",
        links.app,
        "",
        `The link works for ${minutes} minutes and can be used once.`,
        "Didn't ask for this? Ignore this email — your password stays as it is.",
        "",
        "PAPA RENT",
      ].join("\n"),
      html: htmlDocument(title, [
        "You asked to reset your PAPA RENT password.",
        `Open this link in your browser:<br>${link(links.web)}`,
        `Or open it straight in the app:<br>${link(links.app)}`,
        `The link works for ${minutes} minutes and can be used once.`,
        "Didn't ask for this? Ignore this email — your password stays as it is.",
      ]),
    };
  }
  const title = "Stel je wachtwoord opnieuw in";
  return {
    subject: `PAPA RENT · ${title}`,
    text: [
      "Hoi,",
      "",
      "Je hebt gevraagd om je wachtwoord van PAPA RENT opnieuw in te stellen.",
      "",
      "Open deze link in je browser:",
      links.web,
      "",
      "Of open hem direct in de app:",
      links.app,
      "",
      `De link werkt ${minutes} minuten en kan één keer gebruikt worden.`,
      "Heb je dit niet aangevraagd? Negeer deze e-mail — je wachtwoord blijft ongewijzigd.",
      "",
      "PAPA RENT",
    ].join("\n"),
    html: htmlDocument(title, [
      "Je hebt gevraagd om je wachtwoord van PAPA RENT opnieuw in te stellen.",
      `Open deze link in je browser:<br>${link(links.web)}`,
      `Of open hem direct in de app:<br>${link(links.app)}`,
      `De link werkt ${minutes} minuten en kan één keer gebruikt worden.`,
      "Heb je dit niet aangevraagd? Negeer deze e-mail — je wachtwoord blijft ongewijzigd.",
    ]),
  };
}

export function verifyEmailMessage(
  locale: AuthLocale,
  links: RecoveryLinks,
  ttlSeconds = VERIFICATION_TOKEN_TTL_SECONDS,
): Omit<EmailMessage, "to"> {
  const hours = Math.round(ttlSeconds / 3600);
  if (locale === "en") {
    const title = "Confirm your email address";
    return {
      subject: `PAPA RENT · ${title}`,
      text: [
        "Hi,",
        "",
        "Confirm your email address so we can send you alerts.",
        "",
        "Open this link in your browser:",
        links.web,
        "",
        "Or open it straight in the app:",
        links.app,
        "",
        `The link works for ${hours} hours.`,
        "",
        "PAPA RENT",
      ].join("\n"),
      html: htmlDocument(title, [
        "Confirm your email address so we can send you alerts.",
        `Open this link in your browser:<br>${link(links.web)}`,
        `Or open it straight in the app:<br>${link(links.app)}`,
        `The link works for ${hours} hours.`,
      ]),
    };
  }
  const title = "Bevestig je e-mailadres";
  return {
    subject: `PAPA RENT · ${title}`,
    text: [
      "Hoi,",
      "",
      "Bevestig je e-mailadres zodat we je meldingen kunnen sturen.",
      "",
      "Open deze link in je browser:",
      links.web,
      "",
      "Of open hem direct in de app:",
      links.app,
      "",
      `De link werkt ${hours} uur.`,
      "",
      "PAPA RENT",
    ].join("\n"),
    html: htmlDocument(title, [
      "Bevestig je e-mailadres zodat we je meldingen kunnen sturen.",
      `Open deze link in je browser:<br>${link(links.web)}`,
      `Of open hem direct in de app:<br>${link(links.app)}`,
      `De link werkt ${hours} uur.`,
    ]),
  };
}

/** Origin of an absolute URL; `undefined` if it is not an absolute URL. */
function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Better Auth embedded in the API (ADR-005): email+password, Apple, Google; persistent sessions
 * (30 days, renewed on every use) so the app never asks for the password again. Expo plugin for
 * SecureStore/deep links.
 *
 * Strict startup in production (nothing degrades silently): without a strong `BETTER_AUTH_SECRET`,
 * without `BETTER_AUTH_URL` (otherwise recovery links would point at `localhost`) and without
 * `RESEND_API_KEY` (`mailerFromEnv`), the API does not start.
 */
export function createAuth(
  db: unknown,
  env: AuthEnv = process.env,
  deps: { mailer?: Mailer; log?: Logger } = {},
) {
  const scheme = env.APP_SCHEME?.trim() || DEFAULT_APP_SCHEME;
  const webUrl = (env.WEB_URL?.trim() || DEFAULT_WEB_URL).replace(/\/+$/, "");
  const webOrigins = (env.WEB_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const isDev = env.NODE_ENV !== "production";
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!isDev) {
    if (!secret)
      throw new Error(
        "BETTER_AUTH_SECRET missing: in production the API does not start without a secret",
      );
    if (secret.length < MIN_SECRET_LENGTH)
      throw new Error(
        `BETTER_AUTH_SECRET too weak: at least ${MIN_SECRET_LENGTH} characters (openssl rand -base64 32)`,
      );
    if (KNOWN_WEAK_SECRETS.has(secret))
      throw new Error("BETTER_AUTH_SECRET is an example value: generate your own secret");
    if (!env.BETTER_AUTH_URL?.trim())
      throw new Error("BETTER_AUTH_URL missing: recovery links would point at localhost");
  }
  // A transactional e-mail that fails to go out must leave a trace even when no logger was injected.
  const log = deps.log ?? pino({ level: env.LOG_LEVEL ?? "info", name: "api-auth" });
  const mailer = deps.mailer ?? mailerFromEnv(env, log);
  const requireEmailVerification = envFlag(env.REQUIRE_EMAIL_VERIFICATION, false);

  const sendMail = async (to: string, message: Omit<EmailMessage, "to">, kind: string) => {
    const result = await mailer.send({ to, ...message });
    // Better Auth swallows whatever this callback throws (enumeration protection): logging here
    // is the only way to know a transactional e-mail did not go out.
    if (!result.ok)
      log.error({ kind, error: result.error, skipped: result.skipped }, "email not delivered");
  };

  const social: Record<string, unknown> = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    social.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
    social.apple = {
      clientId: env.APPLE_CLIENT_ID,
      clientSecret: env.APPLE_CLIENT_SECRET,
      appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER,
    };
  }
  return betterAuth({
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle instance (postgres-js or PGlite)
    database: drizzleAdapter(db as any, { provider: "pg", schema: authSchema }),
    secret: secret ?? (isDev ? DEV_SECRET : undefined),
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:3000",
    basePath: "/api/auth",
    // `originOf(webUrl)`: the recovery callback validates `callbackURL` against this list, and
    // WEB_URL may be absent from WEB_ORIGINS; without it the e-mail link would land on `/error`.
    trustedOrigins: [
      `${scheme}://`,
      ...new Set([...webOrigins, originOf(webUrl)].filter((o): o is string => Boolean(o))),
      ...(isDev ? ["exp://", "exp://**", "http://localhost:8081"] : []),
    ],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      autoSignIn: true,
      requireEmailVerification,
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      // The way back for whoever forgot their password (S-03 "wachtwoord vergeten"). The endpoint
      // always answers the same whether or not the account exists; this callback only runs when it does.
      sendResetPassword: async (data) => {
        const links = resetPasswordLinks(data, { webUrl, appScheme: scheme });
        await sendMail(
          data.user.email,
          resetPasswordEmail(localeOf(data.user), links),
          "reset-password",
        );
      },
      // Old sessions survive a recovery: revoking them contradicts ADR-002's persistent sessions
      // and is a product decision (see owner_action), not a value to invent here.
      revokeSessionsOnPasswordReset: false,
    },
    /**
     * E-mail verification: the whole path exists (send, resend, `/verify-email`), but
     * `requireEmailVerification` is off by default: requiring it at sign-up kills ADR-002's
     * "onboarding ≤ 90 s". Turn it on with `REQUIRE_EMAIL_VERIFICATION=1`.
     */
    emailVerification: {
      expiresIn: VERIFICATION_TOKEN_TTL_SECONDS,
      sendOnSignUp: requireEmailVerification,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async (data) => {
        const links = verifyEmailLinks(data, { webUrl, appScheme: scheme });
        await sendMail(
          data.user.email,
          verifyEmailMessage(localeOf(data.user), links),
          "verify-email",
        );
      },
    },
    socialProviders: social,
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    // Better Auth already ships tight windows for /sign-in, /sign-up and /request-password-reset
    // (3 per 60 s). Kept in memory: enough for one instance, see needs_outside.
    rateLimit: { enabled: !isDev },
    // `useSecureCookies` follows the NODE_ENV of **this** configuration, not the global one Better Auth reads.
    advanced: { useSecureCookies: !isDev },
    user: {
      additionalFields: {
        dateOfBirth: { type: "date", required: true, input: true },
        locale: { type: "string", required: false, defaultValue: "nl", input: true },
        consentVersion: { type: "string", required: true, input: true },
        consentAt: { type: "date", required: false, input: false, defaultValue: () => new Date() },
        householdSize: { type: "number", required: false, input: true },
        incomeBand: { type: "string", required: false, input: true },
        isSocialTenant: { type: "boolean", required: false, input: true },
        keyProfession: { type: "boolean", required: false, input: true },
      },
      deleteUser: { enabled: true },
    },
    plugins: [expo()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
