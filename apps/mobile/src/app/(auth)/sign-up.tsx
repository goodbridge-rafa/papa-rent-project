import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { TextField } from "@/components/TextField";
import { authClient } from "@/lib/auth-client";
import { config } from "@/lib/config";
import { LEGAL_ROUTE, legalDoc } from "@/lib/legal";
import { LegalBlocks } from "@/lib/legal/render";
import { radius, space, useTheme } from "@/lib/theme";
import { SocialButtons } from "./sign-in";

function parseDob(v: string): Date | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1 ? null : d;
}
const ageOf = (d: Date) => Math.floor((Date.now() - d.getTime()) / (365.25 * 86_400_000));

export default function SignUp() {
  const { t: tr, i18n } = useTranslation();
  const t = useTheme();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dob, setDob] = useState("");
  const [consent, setConsent] = useState(false);
  const [showAllDisclaimer, setShowAllDisclaimer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const router = useRouter();
  /**
   * The disclaimer is the text the user really has to see before accepting
   * (the generated disclaimer text). It sits right above the checkbox, not behind a link: the first
   * points are open already, the rest is one tap away. Reading everything is never mandatory; the
   * onboarding stays below 90 s.
   *
   * If this text ever stops being publishable (an open placeholder or REVIEW marker), the
   * generator does not ship it and the card simply does not appear: we never show half a version
   * of a legal text.
   */
  const disclaimer = legalDoc("disclaimer", i18n.language === "nl" ? "nl" : "en");
  const disclaimerBlocks = disclaimer?.status === "published" ? disclaimer.blocks : null;
  const PREVIEW_BLOCKS = 4;

  const submit = async () => {
    const e: Record<string, string> = {};
    if (password.length < 8) e.password = tr("auth.passwordShort");
    const d = parseDob(dob);
    if (!d) e.dob = tr("auth.dobInvalid");
    else if (ageOf(d) < 16) e.dob = tr("auth.tooYoung");
    if (!consent) e.consent = tr("auth.consentRequired");
    setErr(e);
    if (Object.keys(e).length || !d) return;
    setBusy(true);
    const res = await authClient.signUp.email({
      name: name.trim() || email.split("@")[0] || "—",
      email: email.trim(),
      password,
      dateOfBirth: d,
      consentVersion: config.consentVersion,
      locale: i18n.language === "nl" ? "nl" : "en",
    } as never);
    setBusy(false);
    if (res.error)
      setErr({
        form:
          res.error.code === "USER_ALREADY_EXISTS"
            ? tr("auth.emailInUse")
            : (res.error.message ?? tr("common.error")),
      });
  };

  return (
    <Screen>
      <Text variant="h1">{tr("auth.signUpTitle")}</Text>
      <SocialButtons />
      <TextField
        label={tr("auth.name")}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        textContentType="givenName"
      />
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
        textContentType="newPassword"
        error={err.password}
      />
      <View style={{ gap: 6 }}>
        <Text variant="h3">{tr("auth.dobTitle")}</Text>
        <Text variant="caption" muted>
          {tr("auth.dobHelp")}
        </Text>
        <TextField
          placeholder={tr("auth.dobPlaceholder")}
          value={dob}
          onChangeText={setDob}
          keyboardType="numbers-and-punctuation"
          error={err.dob}
        />
      </View>
      {disclaimerBlocks ? (
        <View
          style={{
            backgroundColor: t.surface,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: radius.md,
            padding: space.lg,
            gap: space.md,
          }}
        >
          <Text variant="h3">{tr("auth.disclaimerTitle")}</Text>
          <LegalBlocks
            blocks={
              showAllDisclaimer ? disclaimerBlocks : disclaimerBlocks.slice(0, PREVIEW_BLOCKS)
            }
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg }}>
            {disclaimerBlocks.length > PREVIEW_BLOCKS ? (
              <Text
                color={t.link}
                accessibilityRole="button"
                onPress={() => setShowAllDisclaimer((v) => !v)}
                style={{ textDecorationLine: "underline" }}
              >
                {showAllDisclaimer ? tr("auth.disclaimerLess") : tr("auth.disclaimerMore")}
              </Text>
            ) : null}
            <Link href={LEGAL_ROUTE.disclaimer}>
              <Text color={t.link} style={{ textDecorationLine: "underline" }}>
                {tr("auth.disclaimerFull")}
              </Text>
            </Link>
          </View>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consent }}
        onPress={() => setConsent((c) => !c)}
        style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: err.consent ? t.danger : t.primary,
            backgroundColor: consent ? t.primary : "transparent",
          }}
        />
        <Text style={{ flex: 1 }}>
          {tr("auth.consent").split(tr("auth.terms"))[0]}
          <Text color={t.link} onPress={() => router.push(LEGAL_ROUTE.terms)}>
            {tr("auth.terms")}
          </Text>
          {tr("auth.consent").split(tr("auth.terms"))[1]?.split(tr("auth.privacy"))[0]}
          <Text color={t.link} onPress={() => router.push(LEGAL_ROUTE.privacy)}>
            {tr("auth.privacy")}
          </Text>
        </Text>
      </Pressable>
      {err.consent ? <Text color={t.danger}>{err.consent}</Text> : null}
      {err.form ? <Text color={t.danger}>{err.form}</Text> : null}
      <Button title={tr("auth.createAccount")} loading={busy} onPress={submit} />
      <Link href="/(auth)/sign-in" style={{ alignSelf: "center" }}>
        <Text color={t.link}>{tr("auth.toSignIn")}</Text>
      </Link>
    </Screen>
  );
}
