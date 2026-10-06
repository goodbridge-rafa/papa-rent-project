import { Link, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { space, useTheme } from "@/lib/theme";
import { LEGAL_ROUTE, legalDoc } from "./index";
import { LegalDocView } from "./render";
import type { LegalDocKind } from "./types";
import { LOCALE_NAME, OTHER_LOCALE, useLegalLocale } from "./use-locale";

const ORDER: LegalDocKind[] = ["terms", "privacy", "disclaimer", "bot"];
const NAV_KEY: Record<LegalDocKind, string> = {
  terms: "profile.terms",
  privacy: "profile.privacy",
  disclaimer: "legal.disclaimer",
  bot: "profile.bot",
};

/**
 * A legal page. The four routes are one line each because the only thing that changes is the
 * document; the rest (language, navigation between texts) is shared and lives here.
 *
 * These pages are also the website: in the web export (`expo export --platform web`) each one
 * becomes static HTML at `/terms`, `/privacy`, `/disclaimer` and `/bot`. That is the URL Apple
 * and Google require and what the app opens from the profile and sign-up.
 */
export function LegalScreen({ kind }: { kind: LegalDocKind }) {
  const locale = useLegalLocale();
  const router = useRouter();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const other = OTHER_LOCALE[locale];
  const doc = legalDoc(kind, locale);
  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Text
          color={t.link}
          onPress={() => router.setParams({ lang: other })}
          accessibilityRole="button"
          style={{ textDecorationLine: "underline" }}
        >
          {LOCALE_NAME[other]}
        </Text>
      </View>
      <LegalDocView doc={doc} title={tr(NAV_KEY[kind])} />
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: t.border,
          paddingTop: space.lg,
          gap: space.sm,
        }}
      >
        <Text variant="label" muted>
          {tr("legal.more")}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg }}>
          {ORDER.filter((k) => k !== kind).map((k) => (
            <Link key={k} href={{ pathname: LEGAL_ROUTE[k], params: { lang: locale } }}>
              <Text color={t.link} style={{ textDecorationLine: "underline" }}>
                {tr(NAV_KEY[k])}
              </Text>
            </Link>
          ))}
        </View>
      </View>
    </Screen>
  );
}
