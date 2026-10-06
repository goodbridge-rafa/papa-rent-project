import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { RadarForm } from "@/components/RadarForm";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { useRadarMutations } from "@/lib/queries";
import { usePrefs } from "@/lib/store";
import { useTheme } from "@/lib/theme";

export default function NewRadar() {
  const router = useRouter();
  const { t: tr } = useTranslation();
  const t = useTheme();
  const { create } = useRadarMutations();
  const pushPrompted = usePrefs((s) => s.pushPrompted);
  return (
    <Screen>
      <RadarForm
        submitting={create.isPending}
        onSubmit={(d) =>
          create.mutate(d, {
            onSuccess: () => {
              if (Platform.OS !== "web" && !pushPrompted) router.replace("/push-prompt");
              else router.replace("/(tabs)");
            },
          })
        }
      />
      {create.isError ? <Text color={t.danger}>{tr("common.error")}</Text> : null}
    </Screen>
  );
}
