import { Link, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { usePrefs } from "@/lib/store";
import { palette, space, useTheme } from "@/lib/theme";

export default function Welcome() {
  const { t: tr, i18n } = useTranslation();
  const t = useTheme();
  const router = useRouter();
  const setLocale = usePrefs((s) => s.setLocale);
  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Chip small label="NL" selected={i18n.language === "nl"} onPress={() => setLocale("nl")} />
        <Chip small label="EN" selected={i18n.language !== "nl"} onPress={() => setLocale("en")} />
      </View>
      <View style={{ marginTop: space.xxl, gap: space.xs }}>
        <Text variant="display" color={t.dark ? palette.orange400 : palette.navy900}>
          PAPA{" "}
          <Text variant="display" color={t.dark ? palette.darkText : palette.orange500}>
            RENT
          </Text>
        </Text>
        <Text variant="h1" style={{ marginTop: space.lg }}>
          {tr("welcome.headline")}
        </Text>
        <Text variant="bodyL" muted>
          {tr("welcome.sub")}
        </Text>
      </View>
      <View style={{ gap: space.md, marginTop: space.lg }}>
        {(["b1", "b2", "b3"] as const).map((k) => (
          <View key={k} style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: palette.orange500,
                marginTop: 8,
              }}
            />
            <Text variant="bodyL" style={{ flex: 1 }}>
              {tr(`welcome.${k}`)}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: space.xxl, gap: space.md }}>
        <Button title={tr("welcome.cta")} onPress={() => router.push("/(auth)/sign-up")} />
        <Link href="/(auth)/sign-in" style={{ alignSelf: "center" }}>
          <Text color={t.link}>{tr("welcome.signIn")}</Text>
        </Link>
      </View>
    </Screen>
  );
}
