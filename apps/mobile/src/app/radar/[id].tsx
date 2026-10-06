import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { Button } from "@/components/Button";
import { RadarForm } from "@/components/RadarForm";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { useRadarMutations, useRadars } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

export default function EditRadar() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t: tr } = useTranslation();
  const t = useTheme();
  const radars = useRadars();
  const { update, remove } = useRadarMutations();
  const r = radars.data?.find((x) => x.id === id);
  if (!r)
    return (
      <Screen>
        <Text muted>{tr("common.loading")}</Text>
      </Screen>
    );
  const { id: _i, userId: _u, createdAt: _c, updatedAt: _t, ...initial } = r;
  return (
    <Screen>
      <Text variant="h2">{tr("radar.edit")}</Text>
      <RadarForm
        initial={initial}
        submitting={update.isPending}
        submitLabel={tr("common.save")}
        onSubmit={(d) => update.mutate({ id: r.id, patch: d }, { onSuccess: () => router.back() })}
      />
      <Button
        kind="ghost"
        title={tr("common.delete")}
        onPress={() =>
          Alert.alert(r.name, tr("radar.deleteConfirm"), [
            { text: tr("common.cancel"), style: "cancel" },
            {
              text: tr("common.delete"),
              style: "destructive",
              onPress: () =>
                remove.mutate(r.id, { onSuccess: () => router.replace("/(tabs)/radars") }),
            },
          ])
        }
      />
      {update.isError ? <Text color={t.danger}>{tr("common.error")}</Text> : null}
    </Screen>
  );
}
