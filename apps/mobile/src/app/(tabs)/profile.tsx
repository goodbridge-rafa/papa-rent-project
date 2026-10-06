import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Platform, Share, View } from "react-native";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { TextField } from "@/components/TextField";
import { authClient } from "@/lib/auth-client";
import { config } from "@/lib/config";
import { enablePush, pushPermissionStatus } from "@/lib/notifications";
import { deleteAccount, exportAccount, useMe, useProfileMutation } from "@/lib/queries";
import { usePrefs } from "@/lib/store";
import { space, useTheme } from "@/lib/theme";

const BANDS = ["lt_passend", "lt_daeb", "lt_midden", "gt_midden", "unknown"] as const;

export default function Profile() {
  const t = useTheme();
  const { t: tr, i18n } = useTranslation();
  const me = useMe();
  const profile = useProfileMutation();
  const router = useRouter();
  const setLocale = usePrefs((s) => s.setLocale);
  const hideNoFit = usePrefs((s) => s.hideNoFit);
  const setHideNoFit = usePrefs((s) => s.setHideNoFit);
  const [push, setPush] = useState("unsupported");
  const [confirm, setConfirm] = useState("");
  useEffect(() => {
    if (Platform.OS !== "web") pushPermissionStatus().then(setPush);
  }, []);
  const u = me.data?.user;
  const yesNo = (v: boolean | null | undefined, set: (b: boolean | null) => void) => (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Chip small label={tr("profile.yes")} selected={v === true} onPress={() => set(true)} />
      <Chip small label={tr("profile.no")} selected={v === false} onPress={() => set(false)} />
    </View>
  );
  const onDelete = () => {
    Alert.alert(tr("profile.deleteAccount"), tr("profile.deleteSub"), [
      { text: tr("common.cancel"), style: "cancel" },
      {
        text: tr("common.delete"),
        style: "destructive",
        onPress: async () => {
          await deleteAccount();
          await authClient.signOut();
        },
      },
    ]);
  };
  return (
    <Screen>
      <Text variant="h1">{tr("profile.title")}</Text>
      {u ? (
        <Text muted>
          {u.name} · {u.email}
        </Text>
      ) : null}

      <Text variant="h3">{tr("profile.language")}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Chip
          small
          label="Nederlands"
          selected={i18n.language === "nl"}
          onPress={() => {
            setLocale("nl");
            profile.mutate({ locale: "nl" });
          }}
        />
        <Chip
          small
          label="English"
          selected={i18n.language !== "nl"}
          onPress={() => {
            setLocale("en");
            profile.mutate({ locale: "en" });
          }}
        />
      </View>

      {Platform.OS !== "web" ? (
        <>
          <Text variant="h3">{tr("profile.notifications")}</Text>
          {push === "granted" ? (
            <Text color={t.success}>{tr("profile.pushOn")}</Text>
          ) : (
            <Text color={t.warning}>{tr("profile.pushOff")}</Text>
          )}
          {push !== "granted" ? (
            <Button
              kind="secondary"
              title={tr("profile.enablePush")}
              onPress={() => enablePush(i18n.language).then(setPush)}
            />
          ) : null}
        </>
      ) : null}

      <Text variant="h3">{tr("profile.eligibility")}</Text>
      <Text variant="caption" muted>
        {tr("profile.eligibilityPromise")}
      </Text>
      <Text>{tr("profile.household")}</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Chip
            key={n}
            small
            label={n === 5 ? "5+" : String(n)}
            selected={u?.householdSize === n}
            onPress={() => profile.mutate({ householdSize: n })}
          />
        ))}
      </View>
      <Text>{tr("profile.income")}</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {BANDS.map((b) => (
          <Chip
            key={b}
            small
            label={tr(`profile.incomeBands.${b}`)}
            selected={u?.incomeBand === b}
            onPress={() => profile.mutate({ incomeBand: b })}
          />
        ))}
      </View>
      <Text>{tr("profile.socialTenant")}</Text>
      {yesNo(u?.isSocialTenant, (b) => profile.mutate({ isSocialTenant: b }))}
      <Text>{tr("profile.keyProfession")}</Text>
      {yesNo(u?.keyProfession, (b) => profile.mutate({ keyProfession: b }))}
      <Text>{tr("profile.hideNoFit")}</Text>
      {yesNo(hideNoFit, (b) => setHideNoFit(b === true))}
      <Text variant="caption" muted>
        {tr("profile.hideNoFitSub")}
      </Text>

      <Text variant="h3">{tr("profile.legal")}</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {/* The three texts meant for the user live inside the app (`src/app/(legal)/`): in-app
            navigation, in their theme and language, and readable offline. */}
        <Chip small label={tr("profile.terms")} onPress={() => router.push("/terms")} />
        <Chip small label={tr("profile.privacy")} onPress={() => router.push("/privacy")} />
        <Chip small label={tr("legal.disclaimer")} onPress={() => router.push("/disclaimer")} />
        {/* `/bot` is the exception and still opens in the browser: that page is the public address
            our bots announce to the sources (see the source policy in the README). What matters there is
            the URL itself: whoever opens it wants to show, copy or verify it outside the app. */}
        <Chip
          small
          label={tr("profile.bot")}
          onPress={() => WebBrowser.openBrowserAsync(`${config.webUrl}/bot`)}
        />
      </View>
      <Text variant="caption" muted>
        {tr("profile.botExternal")}
      </Text>

      <Text variant="h3">{tr("profile.exportData")}</Text>
      <Text variant="caption" muted>
        {tr("profile.exportSub")}
      </Text>
      <Button
        kind="secondary"
        title={tr("profile.exportData")}
        onPress={async () => {
          const data = await exportAccount();
          await Share.share({
            message: JSON.stringify(data, null, 2),
            title: "paparent-export.json",
          });
        }}
      />

      <Text variant="h3" color={t.danger}>
        {tr("profile.deleteAccount")}
      </Text>
      <Text variant="caption" muted>
        {tr("profile.deleteSub")}
      </Text>
      <TextField
        placeholder={tr("profile.deleteConfirm")}
        value={confirm}
        onChangeText={setConfirm}
        autoCapitalize="characters"
      />
      <Button
        kind="danger"
        title={tr("profile.deleteAccount")}
        disabled={confirm.trim().toUpperCase() !== tr("profile.deleteWord")}
        onPress={onDelete}
      />

      <Button kind="ghost" title={tr("profile.signOut")} onPress={() => authClient.signOut()} />
      <Text variant="caption" muted style={{ textAlign: "center", marginBottom: space.xxl }}>
        {tr("profile.version", { v: config.appVersion })}
      </Text>
    </Screen>
  );
}
