import { FlashList } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState } from "@/components/EmptyState";
import { Text } from "@/components/Text";
import { dateShort, euro } from "@/lib/format";
import { keys, markOpened, useInbox } from "@/lib/queries";
import { radius, space, useTheme } from "@/lib/theme";

export default function Inbox() {
  const t = useTheme();
  const { t: tr, i18n } = useTranslation();
  const locale = i18n.language === "nl" ? "nl" : "en";
  const router = useRouter();
  const qc = useQueryClient();
  const inbox = useInbox();
  const items = inbox.data?.pages.flatMap((p) => p.notifications) ?? [];
  const dayLabel = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const y = new Date(Date.now() - 86_400_000);
    if (d.toDateString() === today.toDateString()) return tr("inbox.today");
    if (d.toDateString() === y.toDateString()) return tr("inbox.yesterday");
    return dateShort(iso, locale);
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top"]}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
        <Text variant="h1">{tr("inbox.title")}</Text>
      </View>
      {inbox.isPending ? (
        <ActivityIndicator style={{ marginTop: space.xxl }} color={t.accent} />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(n) => String(n.id)}
          contentContainerStyle={{ padding: space.lg }}
          onEndReached={() =>
            inbox.hasNextPage && !inbox.isFetchingNextPage && inbox.fetchNextPage()
          }
          ListEmptyComponent={<EmptyState title={tr("inbox.empty")} />}
          renderItem={({ item, index }) => {
            const prev = items[index - 1];
            const showDay = !prev || dayLabel(prev.createdAt) !== dayLabel(item.createdAt);
            const closed =
              item.listing.removedAt ||
              (item.listing.closesAt && new Date(item.listing.closesAt) < new Date());
            return (
              <View style={{ gap: 6, paddingBottom: space.sm }}>
                {showDay ? (
                  <Text variant="label" muted style={{ marginTop: space.sm }}>
                    {dayLabel(item.createdAt)}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => {
                    if (!item.openedAt)
                      markOpened(item.id).then(() =>
                        qc.invalidateQueries({ queryKey: keys.inbox }),
                      );
                    router.push(`/listing/${item.listing.id}`);
                  }}
                  style={{
                    backgroundColor: t.surface,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: t.border,
                    padding: space.md,
                    gap: 2,
                    opacity: closed ? 0.6 : 1,
                  }}
                >
                  <Text
                    style={{ fontFamily: item.openedAt ? "Inter_400Regular" : "Inter_600SemiBold" }}
                  >
                    {item.listing.title}
                  </Text>
                  <Text variant="caption" muted>
                    € {euro(item.listing.priceNet)} · {tr(`segment.${item.listing.segment}`)} ·{" "}
                    {tr(`model.${item.listing.allocationModel}`)}
                    {closed ? ` · ${tr("inbox.closed")}` : ""}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
