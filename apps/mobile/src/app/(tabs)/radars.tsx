import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, Switch, View } from "react-native";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { euro } from "@/lib/format";
import { useRadarMutations, useRadars } from "@/lib/queries";
import { radius, space, useTheme } from "@/lib/theme";
import type { Radar } from "@/lib/types";

export default function Radars() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const radars = useRadars();
  const { update, remove } = useRadarMutations();
  const summary = (r: Radar) => {
    const region =
      r.areaType === "all"
        ? "NL"
        : [...r.provinces, ...r.municipalities]
            .map((x) => x.replace(/\b\w/g, (c) => c.toUpperCase()))
            .slice(0, 3)
            .join(", ");
    const seg = r.segments.length === 2 ? tr("radar.both") : tr(`segment.${r.segments[0]}`);
    return tr("radar.summary", {
      region,
      segment: seg,
      max: r.maxRent === null ? tr("radar.noMax") : euro(r.maxRent),
    });
  };
  const confirmDelete = (r: Radar) =>
    Alert.alert(r.name, tr("radar.deleteConfirm"), [
      { text: tr("common.cancel"), style: "cancel" },
      { text: tr("common.delete"), style: "destructive", onPress: () => remove.mutate(r.id) },
    ]);
  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="h1">{tr("radar.myRadars")}</Text>
        <Button
          kind="secondary"
          title={`+ ${tr("radar.newRadar")}`}
          onPress={() => router.push("/radar/new")}
          style={{ minHeight: 40, paddingVertical: 8 }}
        />
      </View>
      {radars.data?.length === 0 ? (
        <EmptyState
          title={tr("radar.noneYet")}
          cta={tr("radar.newRadar")}
          onPress={() => router.push("/radar/new")}
        />
      ) : null}
      {radars.data?.map((r) => (
        <Pressable
          key={r.id}
          onPress={() => router.push(`/radar/${r.id}`)}
          onLongPress={() => confirmDelete(r)}
          style={{
            backgroundColor: t.surface,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: t.border,
            padding: space.lg,
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
          }}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="h3">{r.name}</Text>
            <Text variant="caption" muted>
              {summary(r)}
            </Text>
            <Text variant="caption" color={r.active ? t.success : t.muted}>
              {r.active ? tr("radar.active") : tr("radar.paused")}
            </Text>
          </View>
          <Switch
            value={r.active}
            onValueChange={(v) => update.mutate({ id: r.id, patch: { active: v } })}
            trackColor={{ true: t.primary }}
          />
        </Pressable>
      ))}
    </Screen>
  );
}
