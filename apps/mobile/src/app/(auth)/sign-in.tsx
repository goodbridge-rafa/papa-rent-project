import { Link } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { TextField } from "@/components/TextField";
import { authClient } from "@/lib/auth-client";
import { config } from "@/lib/config";
import { space, useTheme } from "@/lib/theme";

export function SocialButtons() {
  const { t: tr } = useTranslation();
  if (!config.socialProviders.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      {config.socialProviders.includes("apple") ? (
        <Button
          kind="secondary"
          title={tr("auth.apple")}
          onPress={() => authClient.signIn.social({ provider: "apple", callbackURL: "/(tabs)" })}
        />
      ) : null}
      {config.socialProviders.includes("google") ? (
        <Button
          kind="secondary"
          title={tr("auth.google")}
          onPress={() => authClient.signIn.social({ provider: "google", callbackURL: "/(tabs)" })}
        />
      ) : null}
      <Text variant="caption" muted style={{ textAlign: "center" }}>
        {tr("common.or")}
      </Text>
    </View>
  );
}

export default function SignIn() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    const res = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (res.error) setErr(tr("auth.invalid"));
  };
  return (
    <Screen>
      <Text variant="h1">{tr("auth.signInTitle")}</Text>
      <SocialButtons />
      <TextField
        label={tr("auth.email")}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
      />
      <TextField
        label={tr("auth.password")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
      />
      {err ? <Text color={t.danger}>{err}</Text> : null}
      <Button title={tr("auth.signIn")} loading={busy} onPress={submit} />
      {/* S-03 asks for this link. It lives outside `(auth)` because the same screen serves whoever
          arrives through the e-mail link, with or without a session. */}
      <Link href="/forgot-password" style={{ alignSelf: "center" }}>
        <Text color={t.link}>{tr("recover.forgot")}</Text>
      </Link>
      <Link href="/(auth)/sign-up" style={{ alignSelf: "center" }}>
        <Text color={t.link}>{tr("auth.toSignUp")}</Text>
      </Link>
    </Screen>
  );
}
