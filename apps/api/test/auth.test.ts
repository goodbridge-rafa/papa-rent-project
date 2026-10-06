import { existsSync } from "node:fs";
import { createTestDb, type TestDb } from "@papa/db/test-db";
import { describe, expect, it } from "vitest";
import {
  type AuthEnv,
  CONSENT_VERSION,
  createAuth,
  envFlag,
  localeOf,
  RESET_TOKEN_TTL_SECONDS,
  resetPasswordEmail,
  resetPasswordLinks,
  verifyEmailLinks,
  withCallback,
} from "../src/auth";
import { FakeMailer, mailerFromEnv, NoopMailer } from "../src/mail";

const BASE_ENV: AuthEnv = {
  NODE_ENV: "development",
  BETTER_AUTH_URL: "http://localhost:3000",
  WEB_URL: "https://example.com",
  WEB_ORIGINS: "https://app.example.com",
  APP_SCHEME: "paparent",
};

const build = (db: TestDb, env: Partial<AuthEnv> = {}) => {
  const mailer = new FakeMailer();
  return { mailer, auth: createAuth(db, { ...BASE_ENV, ...env }, { mailer }) };
};

type Auth = ReturnType<typeof createAuth>;

const signUp = (auth: Auth, email: string, locale: "nl" | "en", password = "geheim-wachtwoord") =>
  auth.api.signUpEmail({
    body: {
      name: "Ana",
      email,
      password,
      dateOfBirth: new Date("1994-05-01"),
      consentVersion: CONSENT_VERSION,
      locale,
    } as never,
  });

/** The token lives in the app deep link: `paparent://<route>?token=…`. */
const tokenFrom = (text: string) => {
  const match = /paparent:\/\/[a-z-]+\?token=([^\s]+)/.exec(text);
  if (!match?.[1]) throw new Error(`no deep link with a token in:\n${text}`);
  return decodeURIComponent(match[1]);
};

describe("password recovery", () => {
  it("sends the link, the token works and the password really changes", async () => {
    const { db, close } = await createTestDb();
    try {
      const { auth, mailer } = build(db);
      await signUp(auth, "ana@example.com", "nl");

      const res = await auth.api.requestPasswordReset({ body: { email: "ana@example.com" } });
      expect(res.status).toBe(true);
      expect(mailer.sent).toHaveLength(1);
      const mail = mailer.last();
      if (!mail) throw new Error("no e-mail");
      expect(mail.to).toBe("ana@example.com");

      const token = tokenFrom(mail.text);
      expect(mail.text).toContain(`paparent://reset-password?token=${encodeURIComponent(token)}`);
      // The web link goes through the API, which validates the token before returning the user to the site.
      expect(mail.text).toContain(
        `http://localhost:3000/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent("https://example.com/reset-password")}`,
      );

      await auth.api.resetPassword({ body: { token, newPassword: "nieuw-wachtwoord-2026" } });

      await expect(
        auth.api.signInEmail({ body: { email: "ana@example.com", password: "geheim-wachtwoord" } }),
      ).rejects.toThrow();
      const signedIn = await auth.api.signInEmail({
        body: { email: "ana@example.com", password: "nieuw-wachtwoord-2026" },
      });
      expect(signedIn.user.email).toBe("ana@example.com");
    } finally {
      await close();
    }
  });

  it("the token works only once and a short password is refused", async () => {
    const { db, close } = await createTestDb();
    try {
      const { auth, mailer } = build(db);
      await signUp(auth, "ana@example.com", "nl");
      await auth.api.requestPasswordReset({ body: { email: "ana@example.com" } });
      const token = tokenFrom(mailer.last()?.text ?? "");

      await expect(
        auth.api.resetPassword({ body: { token, newPassword: "kort" } }),
      ).rejects.toThrow();
      await auth.api.resetPassword({ body: { token, newPassword: "nieuw-wachtwoord-2026" } });
      await expect(
        auth.api.resetPassword({ body: { token, newPassword: "nog-een-wachtwoord" } }),
      ).rejects.toThrow();
      await expect(
        auth.api.resetPassword({
          body: { token: "made-up", newPassword: "nieuw-wachtwoord-2026" },
        }),
      ).rejects.toThrow();
    } finally {
      await close();
    }
  });

  it("does not reveal whether the account exists: same answer, no e-mail", async () => {
    const { db, close } = await createTestDb();
    try {
      const { auth, mailer } = build(db);
      await signUp(auth, "ana@example.com", "nl");

      const unknown = await auth.api.requestPasswordReset({
        body: { email: "nobody@example.com" },
      });
      expect(mailer.sent).toHaveLength(0);
      const known = await auth.api.requestPasswordReset({ body: { email: "ana@example.com" } });
      expect(mailer.sent).toHaveLength(1);
      expect(unknown).toEqual(known);
    } finally {
      await close();
    }
  });

  it("speaks the user's language", async () => {
    const { db, close } = await createTestDb();
    try {
      const { auth, mailer } = build(db);
      await signUp(auth, "nl@example.com", "nl");
      await signUp(auth, "en@example.com", "en");

      await auth.api.requestPasswordReset({ body: { email: "nl@example.com" } });
      expect(mailer.last()?.subject).toContain("Stel je wachtwoord opnieuw in");
      expect(mailer.last()?.text).toContain("Heb je dit niet aangevraagd?");

      await auth.api.requestPasswordReset({ body: { email: "en@example.com" } });
      expect(mailer.last()?.subject).toContain("Reset your password");
      expect(mailer.last()?.text).toContain("Didn't ask for this?");
    } finally {
      await close();
    }
  });

  it("honours the destination requested by the client when it is a trusted origin", async () => {
    const { db, close } = await createTestDb();
    try {
      const { auth, mailer } = build(db);
      await signUp(auth, "ana@example.com", "nl");
      await auth.api.requestPasswordReset({
        body: { email: "ana@example.com", redirectTo: "https://app.example.com/nieuw-wachtwoord" },
      });
      expect(mailer.last()?.text).toContain(
        `callbackURL=${encodeURIComponent("https://app.example.com/nieuw-wachtwoord")}`,
      );
    } finally {
      await close();
    }
  });
});

describe("e-mail verification", () => {
  it("off by default: sign-up gets in without verifying and sends no e-mail", async () => {
    const { db, close } = await createTestDb();
    try {
      const { auth, mailer } = build(db);
      const signedUp = await signUp(auth, "ana@example.com", "nl");
      expect(signedUp.user.emailVerified).toBe(false);
      expect(mailer.sent).toHaveLength(0);
      const signedIn = await auth.api.signInEmail({
        body: { email: "ana@example.com", password: "geheim-wachtwoord" },
      });
      expect(signedIn.user.email).toBe("ana@example.com");
    } finally {
      await close();
    }
  });

  it("on via REQUIRE_EMAIL_VERIFICATION: sends the e-mail and locks sign-in until verified", async () => {
    const { db, close } = await createTestDb();
    try {
      const { auth, mailer } = build(db, { REQUIRE_EMAIL_VERIFICATION: "1" });
      await signUp(auth, "ana@example.com", "nl");
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.last()?.subject).toContain("Bevestig je e-mailadres");
      const token = tokenFrom(mailer.last()?.text ?? "");

      await expect(
        auth.api.signInEmail({ body: { email: "ana@example.com", password: "geheim-wachtwoord" } }),
      ).rejects.toThrow();

      await auth.api.verifyEmail({ query: { token } });
      const signedIn = await auth.api.signInEmail({
        body: { email: "ana@example.com", password: "geheim-wachtwoord" },
      });
      expect(signedIn.user.emailVerified).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("startup", () => {
  const prod: AuthEnv = {
    ...BASE_ENV,
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: "s".repeat(40),
    RESEND_API_KEY: "re_test_key",
  };

  it("in production refuses to start without RESEND_API_KEY", async () => {
    const { db, close } = await createTestDb();
    try {
      const { RESEND_API_KEY: _drop, ...withoutKey } = prod;
      expect(() => createAuth(db, withoutKey)).toThrow(/RESEND_API_KEY/);
      expect(() => createAuth(db, { ...withoutKey, RESEND_API_KEY: "  " })).toThrow(
        /RESEND_API_KEY/,
      );
      expect(() => createAuth(db, prod)).not.toThrow();
    } finally {
      await close();
    }
  });

  it("in production refuses a missing, short or example secret, and a missing URL", async () => {
    const { db, close } = await createTestDb();
    try {
      expect(() => createAuth(db, { ...prod, BETTER_AUTH_SECRET: undefined })).toThrow(
        /BETTER_AUTH_SECRET missing/,
      );
      expect(() => createAuth(db, { ...prod, BETTER_AUTH_SECRET: "short" })).toThrow(
        /BETTER_AUTH_SECRET too weak/,
      );
      expect(() =>
        createAuth(db, {
          ...prod,
          BETTER_AUTH_SECRET: "dev-secret-change-me-dev-secret-change-me",
        }),
      ).toThrow(/example value/);
      expect(() => createAuth(db, { ...prod, BETTER_AUTH_URL: undefined })).toThrow(
        /BETTER_AUTH_URL missing/,
      );
    } finally {
      await close();
    }
  });

  it("in development starts with nothing configured", async () => {
    const { db, close } = await createTestDb();
    try {
      expect(() => createAuth(db, { NODE_ENV: "development" })).not.toThrow();
    } finally {
      await close();
    }
  });
});

describe("e-mail transport", () => {
  it("throws in production without a key; without a key outside production never returns ok", async () => {
    expect(() => mailerFromEnv({ NODE_ENV: "production" })).toThrow(/RESEND_API_KEY/);
    const mailer = mailerFromEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    expect(mailer).toBeInstanceOf(NoopMailer);
    const result = await mailer.send({ to: "a@b.nl", subject: "s", text: "t", html: "<p>t</p>" });
    expect(result).toEqual({ ok: false, skipped: true, error: "email_not_configured" });
  });
});

describe("helpers", () => {
  it("withCallback fills an empty callbackURL and the default `/`, and keeps a real destination", () => {
    expect(
      withCallback("http://api.test/api/auth/reset-password/t1?callbackURL=", "https://w.nl/r"),
    ).toBe("http://api.test/api/auth/reset-password/t1?callbackURL=https%3A%2F%2Fw.nl%2Fr");
    expect(
      withCallback(
        "http://api.test/api/auth/verify-email?token=t1&callbackURL=%2F",
        "https://w.nl/v",
      ),
    ).toBe("http://api.test/api/auth/verify-email?token=t1&callbackURL=https%3A%2F%2Fw.nl%2Fv");
    expect(
      withCallback(
        "http://api.test/api/auth/reset-password/t1?callbackURL=https%3A%2F%2Fx.nl",
        "https://w.nl/r",
      ),
    ).toContain("callbackURL=https%3A%2F%2Fx.nl");
  });

  it("both links come from the same origin and the same token", () => {
    const links = resetPasswordLinks(
      { url: "http://api.test/api/auth/reset-password/tok-1?callbackURL=", token: "tok-1" },
      { webUrl: "https://example.com", appScheme: "paparent" },
    );
    expect(links.app).toBe("paparent://reset-password?token=tok-1");
    expect(links.web.startsWith("http://api.test/api/auth/reset-password/tok-1?")).toBe(true);
    const body = resetPasswordEmail("nl", links);
    expect(body.text).toContain(links.web);
    expect(body.text).toContain(links.app);
    expect(body.html).toContain(`href="${links.app}"`);
    expect(body.text).toContain(`${RESET_TOKEN_TTL_SECONDS / 60} minuten`);
  });

  it("recovery links land on routes the app really has", () => {
    const cfg = { webUrl: "https://example.com", appScheme: "paparent" };
    const appRoutes = new URL("../../mobile/src/app/", import.meta.url);
    const webPath = (url: string) => {
      const callback = new URL(url).searchParams.get("callbackURL");
      if (!callback) throw new Error(`no callbackURL: ${url}`);
      return new URL(callback);
    };

    const verify = verifyEmailLinks(
      { url: "http://api.test/api/auth/verify-email?token=t1&callbackURL=%2F", token: "t1" },
      cfg,
    );
    const verifyWeb = webPath(verify.web);
    expect(verifyWeb.pathname).toBe("/verify-email");
    // Better Auth consumes the token and does not re-attach it: without this marker the landing
    // screen would ask someone who just confirmed to resend
    expect(verifyWeb.searchParams.get("verified")).toBe("1");
    expect(verify.app).toBe("paparent://verify-email?token=t1");

    const reset = resetPasswordLinks(
      { url: "http://api.test/api/auth/reset-password/t1?callbackURL=", token: "t1" },
      cfg,
    );
    expect(webPath(reset.web).pathname).toBe("/reset-password");

    // the route must exist in the Expo web export (that is what serves WEB_URL)
    for (const path of ["/verify-email", "/reset-password"])
      expect(existsSync(new URL(`.${path}.tsx`, appRoutes))).toBe(true);
  });

  it("envFlag and localeOf have safe defaults", () => {
    expect(envFlag(undefined)).toBe(false);
    expect(envFlag("")).toBe(false);
    expect(envFlag("  ")).toBe(false);
    expect(envFlag("0")).toBe(false);
    expect(envFlag("false")).toBe(false);
    expect(envFlag(undefined, true)).toBe(true);
    for (const v of ["1", "true", "TRUE", "yes", "on"]) expect(envFlag(v)).toBe(true);
    expect(localeOf({ locale: "en" })).toBe("en");
    expect(localeOf({ locale: "nl" })).toBe("nl");
    expect(localeOf({ locale: "pt" })).toBe("nl");
    expect(localeOf({})).toBe("nl");
    expect(localeOf(null)).toBe("nl");
    expect(localeOf(undefined)).toBe("nl");
  });
});
