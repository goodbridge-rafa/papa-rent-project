import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { TextField } from "@/components/TextField";
import {
  authClient,
  looksLikeEmail,
  type RecoveryFailure,
  requestPasswordResetEmail,
} from "@/lib/auth-client";
import { radius, space, useTheme } from "@/lib/theme";

/**
 * Start of S-03's "wachtwoord vergeten". The end is in `reset-password`.
 *
 * The API answers exactly the same for an address with and without an account: that is the
 * defence against account enumeration. So the confirmation screen says "if an account exists…"
 * and never "we sent an e-mail": promising what we do not know would lie to whoever mistyped.
 */
export default function ForgotPassword() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  const failureText = (failure: RecoveryFailure) =>
    failure === "rateLimited" ? tr("recover.err.rateLimited") : tr("recover.err.generic");

  const submit = async () => {
    const value = email.trim();
    setFormErr(null);
    if (!looksLikeEmail(value)) {
      setFieldErr(tr("recover.emailInvalid"));
      return;
    }
    setFieldErr(null);
    setBusy(true);
    const res = await requestPasswordResetEmail(value);
    setBusy(false);
    if (res.ok) setSentTo(value);
    else setFormErr(failureText(res.failure));
  };

  /** Someone with a session cannot enter `(auth)`: that group sits behind the `!session` guard. */
  const leave = () => router.replace(session ? "/(tabs)" : "/(auth)/sign-in");
  const leaveLabel = session ? tr("recover.toApp") : tr("recover.backToSignIn");

  if (sentTo) {
    return (
      <Screen>
        <Text variant="h1" accessibilityRole="header">
          {tr("recover.sentTitle")}
        </Text>
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
          <Text variant="bodyL">{tr("recover.sentBody", { email: sentTo })}</Text>
          <Text variant="caption" muted>
            {tr("recover.sentHint")}
          </Text>
        </View>
        <Button
          kind="secondary"
          title={tr("recover.sendAgain")}
          onPress={() => {
            setSentTo(null);
            setFormErr(null);
          }}
        />
        <Button kind="ghost" title={leaveLabel} onPress={leave} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="h1" accessibilityRole="header">
        {tr("recover.forgotTitle")}
      </Text>
      <Text variant="bodyL" muted>
        {tr("recover.forgotBody")}
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
        onSubmitEditing={() => void submit()}
        error={fieldErr}
      />
      {formErr ? (
        <Text color={t.danger} accessibilityRole="alert">
          {formErr}
        </Text>
      ) : null}
      <Button title={tr("recover.send")} loading={busy} onPress={submit} />
      <Button kind="ghost" title={leaveLabel} onPress={leave} />
    </Screen>
  );
}
