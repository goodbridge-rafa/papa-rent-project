import { expoClient } from "@better-auth/expo/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { config } from "./config";
import { DEMO_USER, demoRefusal } from "./demo";

const additional = inferAdditionalFields({
  user: {
    dateOfBirth: { type: "date", required: true },
    locale: { type: "string", required: false },
    consentVersion: { type: "string", required: true },
    householdSize: { type: "number", required: false },
    incomeBand: { type: "string", required: false },
    isSocialTenant: { type: "boolean", required: false },
    keyProfession: { type: "boolean", required: false },
  },
});

/**
 * Persistent session (ADR-005): on native platforms the Expo plugin keeps the cookie in SecureStore
 * and the user never sees the sign-in screen again. On the web, regular cookies.
 */
const realClient =
  Platform.OS === "web"
    ? createAuthClient({ baseURL: config.apiUrl, plugins: [additional] })
    : createAuthClient({
        baseURL: config.apiUrl,
        plugins: [
          additional,
          expoClient({ scheme: config.scheme, storagePrefix: "paparent", storage: SecureStore }),
        ],
      });

/**
 * Client for the web demo: local session, no server and no account.
 *
 * Why it exists: without a session the demo user would be stuck on the sign-in screen trying to
 * authenticate against an API that is not there. With it they go straight in and see the product.
 *
 * What it deliberately does NOT do: sign up, sign in, sign out, recover a password. All of that
 * needs a server; here it rejects with `DemoUnavailableError` instead of failing silently or
 * pretending. Only `useSession` is replaced: the rest of the client stays as it is, and no screen
 * knows the difference.
 */
function demoClient(base: typeof realClient): typeof realClient {
  const session = {
    user: DEMO_USER,
    session: { id: "demo", userId: "demo", expiresAt: new Date(Date.now() + 864e5) },
  };
  const unavailable = (op: string) => (): Promise<never> => Promise.reject(demoRefusal(op));
  return {
    ...base,
    useSession: () => ({ data: session, isPending: false, error: null, refetch: () => {} }),
    // Every write is refused here, not on the network. Without this these requests would go to an
    // `apiUrl` that does not exist and the user would see a network error, which suggests "try again".
    signOut: unavailable("signOut"),
    signIn: { email: unavailable("signIn"), social: unavailable("signIn.social") },
    signUp: { email: unavailable("signUp") },
    requestPasswordReset: unavailable("requestPasswordReset"),
    resetPassword: unavailable("resetPassword"),
    verifyEmail: unavailable("verifyEmail"),
    sendVerificationEmail: unavailable("sendVerificationEmail"),
    deleteUser: unavailable("deleteUser"),
    // biome-ignore lint/suspicious/noExplicitAny: the demo session mimics Better Auth's shape
  } as any as typeof realClient;
}

export const authClient = config.demo ? demoClient(realClient) : realClient;

export type Session = NonNullable<ReturnType<typeof authClient.useSession>["data"]>;

/* ------------------------------------------------------------------ *
 * Password recovery and e-mail confirmation
 * ------------------------------------------------------------------ */

/**
 * How a recovery step failed, in terms the UI understands.
 * `invalidToken` is the only one that changes screen (the e-mail link died); the others are
 * messages inside the form itself.
 */
export type RecoveryFailure = "invalidToken" | "rateLimited" | "alreadyVerified" | "generic";

export type RecoveryResult = { ok: true } | { ok: false; failure: RecoveryFailure };

interface AuthErrorLike {
  code?: string | undefined;
  status?: number | undefined;
}

/** Better Auth codes that mean "this link is no longer valid". */
const TOKEN_FAILURES: ReadonlySet<string> = new Set(["INVALID_TOKEN", "TOKEN_EXPIRED"]);

function classify(
  error: AuthErrorLike | null | undefined,
  opts: { tokenFlow?: boolean } = {},
): RecoveryFailure {
  if (!error) return "generic";
  if (error.status === 429) return "rateLimited";
  const code = error.code ?? "";
  if (code === "EMAIL_ALREADY_VERIFIED") return "alreadyVerified";
  if (TOKEN_FAILURES.has(code)) return "invalidToken";
  // In a flow that sends a token, a 4xx without a known code is in practice the token being refused.
  if (opts.tokenFlow && error.status !== undefined && error.status >= 400 && error.status < 500) {
    return "invalidToken";
  }
  return "generic";
}

/** The client returns `{ error }`; without network it may throw. Here both fail the same way. */
async function run(
  call: () => Promise<{ error?: AuthErrorLike | null }>,
  opts?: { tokenFlow?: boolean },
): Promise<RecoveryResult> {
  try {
    const res = await call();
    return res.error ? { ok: false, failure: classify(res.error, opts) } : { ok: true };
  } catch {
    return { ok: false, failure: "generic" };
  }
}

/**
 * Requests the recovery e-mail. No `redirectTo`: the API fills in the destination (the web link
 * lands on `WEB_URL/reset-password?token=…`, native on `paparent://reset-password?token=…`).
 *
 * Answers `ok` for existing and non-existing accounts alike, on purpose, so as not to reveal who
 * has an account. The UI can never claim more than "if that account exists".
 */
export const requestPasswordResetEmail = (email: string): Promise<RecoveryResult> =>
  run(() => authClient.requestPasswordReset({ email }));

/** Saves the new password. `invalidToken` = link expired or already used. */
export const resetPasswordWithToken = (
  token: string,
  newPassword: string,
): Promise<RecoveryResult> =>
  run(() => authClient.resetPassword({ token, newPassword }), { tokenFlow: true });

/** Confirms the e-mail from the link's token. With `autoSignInAfterVerification` it may create a session. */
export const verifyEmailWithToken = (token: string): Promise<RecoveryResult> =>
  run(() => authClient.verifyEmail({ query: { token } }), { tokenFlow: true });

/** Resends the confirmation. Without a session the API answers the same for any address. */
export const resendVerificationEmail = (email: string): Promise<RecoveryResult> =>
  run(() => authClient.sendVerificationEmail({ email }));

/**
 * Enough to avoid spending a request (and a rate-limit window) on an obviously invalid address.
 * The real validation is the server's.
 */
export const looksLikeEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
