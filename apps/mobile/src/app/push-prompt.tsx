import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { enablePush } from "@/lib/notifications";
import { usePrefs } from "@/lib/store";
import { palette, space } from "@/lib/theme";

export default function PushPrompt() {
  const router = useRouter();
  const { t: tr, i18n } = useTranslation();
  const setPrompted = usePrefs((s) => s.setPushPrompted);
  const finish = () => {
    setPrompted();
    router.replace("/(tabs)");
  };
  return (
    <Screen>
      <View style={{ alignItems: "center", gap: space.lg, marginTop: space.xxl }}>
        <Ionicons name="notifications" size={56} color={palette.orange500} />
        <Text variant="h1" style={{ textAlign: "center" }}>
          {tr("push.preTitle")}
        </Text>
        <Text variant="bodyL" muted style={{ textAlign: "center" }}>
          {tr("push.preBody")}
        </Text>
        <Button
          title={tr("push.cta")}
          onPress={async () => {
            await enablePush(i18n.language);
            finish();
          }}
          style={{ alignSelf: "stretch" }}
        />
        <Button kind="ghost" title={tr("push.later")} onPress={finish} />
      </View>
    </Screen>
  );
}
