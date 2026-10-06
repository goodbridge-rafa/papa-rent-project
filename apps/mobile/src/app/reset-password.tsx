import { useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { TextField } from "@/components/TextField";
import { authClient, type RecoveryFailure, resetPasswordWithToken } from "@/lib/auth-client";
import { radius, space, useTheme } from "@/lib/theme";

const MIN_PASSWORD = 8;

/**
 * End of S-03's "wachtwoord vergeten", for both surfaces:
 * - web: `WEB_URL/reset-password?token=…` (the API validates the token and only then redirects);
 * - native: `paparent://reset-password?token=…` (the `scheme` from `app.json`).
 *
 * The same parameter name in both cases, on purpose. When the API refuses the token before it
 * gets here, it redirects with `?error=INVALID_TOKEN` instead of `?token=`; that case lands in the
 * same "dead link" state, which always has a way out: requesting a new link.
 */
export default function ResetPassword() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const router = useRouter();
  const { token, error } = useLocalSearchParams<{ token?: string; error?: string }>();
  const { data: session } = authClient.useSession();

  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<{ password?: string; repeat?: string; form?: string }>({});
  const [tokenDead, setTokenDead] = useState(false);
  const [done, setDone] = useState(false);

  const usable = !!token && !error && !tokenDead;
  /** Someone with a session cannot enter `(auth)`: that group sits behind the `!session` guard. */
  const leave = () => router.replace(session ? "/(tabs)" : "/(auth)/sign-in");
  const leaveLabel = session ? tr("recover.toApp") : tr("recover.toSignIn");

  const failureText = (failure: RecoveryFailure) =>
    failure === "rateLimited" ? tr("recover.err.rateLimited") : tr("recover.err.generic");

  const submit = async () => {
    if (!token) return;
    const next: { password?: string; repeat?: string } = {};
    if (password.length < MIN_PASSWORD) next.password = tr("auth.passwordShort");
    else if (password !== repeat) next.repeat = tr("recover.mismatch");
    setErrs(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    const res = await resetPasswordWithToken(token, password);
    setBusy(false);
    if (res.ok) {
      setDone(true);
      return;
    }
    if (res.failure === "invalidToken") setTokenDead(true);
    else setErrs({ form: failureText(res.failure) });
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

  if (done) {
    return (
      <Screen>
        <Text variant="h1" accessibilityRole="header">
          {tr("recover.doneTitle")}
        </Text>
        {card(
          <Text variant="bodyL">
            {session ? tr("recover.doneBodySignedIn") : tr("recover.doneBody")}
          </Text>,
        )}
        <Button title={leaveLabel} onPress={leave} />
      </Screen>
    );
  }

  if (!usable) {
    return (
      <Screen>
        <Text variant="h1" accessibilityRole="header">
          {tr("recover.badLinkTitle")}
        </Text>
        {card(<Text variant="bodyL">{tr("recover.badLinkBody")}</Text>)}
        <Button title={tr("recover.newLink")} onPress={() => router.replace("/forgot-password")} />
        <Button kind="ghost" title={leaveLabel} onPress={leave} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="h1" accessibilityRole="header">
        {tr("recover.resetTitle")}
      </Text>
      <Text variant="bodyL" muted>
        {tr("recover.resetBody")}
      </Text>
      <TextField
        label={tr("recover.newPassword")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        error={errs.password}
      />
      <TextField
        label={tr("recover.repeatPassword")}
        value={repeat}
        onChangeText={setRepeat}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        error={errs.repeat}
      />
      {errs.form ? (
        <Text color={t.danger} accessibilityRole="alert">
          {errs.form}
        </Text>
      ) : null}
      <Button title={tr("recover.resetCta")} loading={busy} onPress={submit} />
    </Screen>
  );
}
