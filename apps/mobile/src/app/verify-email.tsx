import { useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, View } from "react-native";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { TextField } from "@/components/TextField";
import {
  authClient,
  looksLikeEmail,
  type RecoveryFailure,
  resendVerificationEmail,
  verifyEmailWithToken,
} from "@/lib/auth-client";
import { radius, space, useTheme } from "@/lib/theme";

/** What the screen is showing. `ask` is the state without a token: only the resend. */
type Phase = "checking" | "verified" | "already" | "dead" | "ask";

/**
 * E-mail confirmation, on both surfaces (`WEB_URL/…?token=…` and `paparent://verify-email?token=…`).
 *
 * `requireEmailVerification` is off by default (requiring it at sign-up would kill ADR-002's
 * "onboarding ≤ 90 s"), but the path has to exist: the confirmation e-mail already goes out once
 * the operator turns the flag on, and the resend is needed even with the flag off. Without this
 * route the e-mail link would land nowhere.
 */
export default function VerifyEmail() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const router = useRouter();
  const { token, error } = useLocalSearchParams<{ token?: string; error?: string }>();
  const { data: session, refetch } = authClient.useSession();

  const [phase, setPhase] = useState<Phase>(token && !error ? "checking" : "ask");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const checked = useRef(false);

  // The session address is the best guess for the resend; it does not override what the user types.
  const sessionEmail = session?.user.email;
  useEffect(() => {
    if (sessionEmail) setEmail((v) => v || sessionEmail);
  }, [sessionEmail]);

  /**
   * The token works only once: `checked` guarantees a single request, even with strict mode's
   * double mount. No "unmounted" flag on purpose: discarding the response would leave the screen
   * stuck on "verifying" when the effect runs twice.
   */
  useEffect(() => {
    if (checked.current || !token || error) return;
    checked.current = true;
    void (async () => {
      const res = await verifyEmailWithToken(token);
      if (res.ok) {
        // `autoSignInAfterVerification` may have created a session: re-read before offering the way out.
        await refetch();
        setPhase("verified");
        return;
      }
      setPhase(res.failure === "alreadyVerified" ? "already" : "dead");
    })();
  }, [token, error, refetch]);

  const failureText = (failure: RecoveryFailure) =>
    failure === "rateLimited" ? tr("recover.err.rateLimited") : tr("recover.err.generic");

  const resend = async () => {
    const value = email.trim();
    setFormErr(null);
    if (!looksLikeEmail(value)) {
      setFieldErr(tr("recover.emailInvalid"));
      return;
    }
    setFieldErr(null);
    setBusy(true);
    const res = await resendVerificationEmail(value);
    setBusy(false);
    if (res.ok) {
      setSentTo(value);
      return;
    }
    if (res.failure === "alreadyVerified") setPhase("already");
    else setFormErr(failureText(res.failure));
  };

  const card = (children: ReactNode) => (
    <View
      style={{
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: t.border,
        borderRadius: radius.md,
        padding: space.lg,
        gap: space.sm,
      }}
    >
      {children}
    </View>
  );

  /** Someone with a session cannot enter `(auth)`: that group sits behind the `!session` guard. */
  const leave = () => router.replace(session ? "/(tabs)" : "/(auth)/sign-in");
  const leaveLabel = session ? tr("recover.toApp") : tr("recover.toSignIn");
  const exit = <Button title={leaveLabel} onPress={leave} />;

  if (phase === "checking") {
    return (
      <Screen>
        <Text variant="h1" accessibilityRole="header">
          {tr("recover.verifyTitle")}
        </Text>
        <View style={{ alignItems: "center", gap: space.md, paddingVertical: space.xl }}>
          <ActivityIndicator color={t.accent} />
          <Text muted accessibilityRole="alert">
            {tr("recover.verifyChecking")}
          </Text>
        </View>
      </Screen>
    );
  }

  if (phase === "verified" || phase === "already") {
    const verified = phase === "verified";
    return (
      <Screen>
        <Text variant="h1" accessibilityRole="header">
          {verified ? tr("recover.verifiedTitle") : tr("recover.alreadyVerifiedTitle")}
        </Text>
        {card(
          <Text variant="bodyL">
            {verified ? tr("recover.verifiedBody") : tr("recover.alreadyVerifiedBody")}
          </Text>,
        )}
        {exit}
      </Screen>
    );
  }

  if (sentTo) {
    return (
      <Screen>
        <Text variant="h1" accessibilityRole="header">
          {tr("recover.sentTitle")}
        </Text>
        {card(
          <>
            <Text variant="bodyL">{tr("recover.resendSent", { email: sentTo })}</Text>
            <Text variant="caption" muted>
              {tr("recover.sentHint")}
            </Text>
          </>,
        )}
        <Button
          kind="secondary"
          title={tr("recover.sendAgain")}
          onPress={() => {
            setSentTo(null);
            setFormErr(null);
          }}
        />
        {exit}
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="h1" accessibilityRole="header">
        {phase === "dead" ? tr("recover.badLinkTitle") : tr("recover.verifyTitle")}
      </Text>
      <Text variant="bodyL" muted>
        {phase === "dead" ? tr("recover.verifyBadLinkBody") : tr("recover.verifyNoToken")}
      </Text>
      <TextField
        label={tr("auth.email")}
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (fieldErr) setFieldErr(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        returnKeyType="send"
        onSubmitEditing={() => void resend()}
        error={fieldErr}
      />
      {formErr ? (
        <Text color={t.danger} accessibilityRole="alert">
          {formErr}
        </Text>
      ) : null}
      <Button title={tr("recover.resend")} loading={busy} onPress={resend} />
      <Button kind="ghost" title={leaveLabel} onPress={leave} />
    </Screen>
  );
}
