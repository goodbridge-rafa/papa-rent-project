import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { useNetworkState } from "expo-network";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Platform, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { ListingCard } from "@/components/ListingCard";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { pushPermissionStatus } from "@/lib/notifications";
import { useFeed, useMe, useRadars } from "@/lib/queries";
import { usePrefs, usePrefsHydrated } from "@/lib/store";
import { radius, space, useTheme } from "@/lib/theme";
import type { FeedListing } from "@/lib/types";

/**
 * Quick filters of the feed (screens.md S-09).
 *
 * None of them goes to the network: `/v1/feed` and `/v1/radars/:id/feed` only accept `limit` and
 * `cursor` (apps/api/src/app.ts), so they filter what is already loaded. That is honest because
 * the feed is sorted by date and we load whole pages: what is hidden here is already on screen.
 */
type QuickFilter = "social" | "midden" | "loting" | "direct" | "fit";

/** Chips of the same family add up (OR); different families intersect (AND). */
const FAMILY: Record<QuickFilter, "segment" | "model" | "fit"> = {
  social: "segment",
  midden: "segment",
  loting: "model",
  direct: "model",
  fit: "fit",
};

const MATCHES: Record<QuickFilter, (l: FeedListing) => boolean> = {
  social: (l) => l.segment === "social",
  midden: (l) => l.segment === "midden",
  loting: (l) => l.allocationModel === "loting",
  // DirectKans: first to apply gets it. A listing that closes on the first reaction is the same case.
  direct: (l) => l.allocationModel === "direct" || l.closesAfterFirstReaction,
  fit: (l) => l.fit?.state === "FIT",
};

const FILTER_ORDER: QuickFilter[] = ["social", "midden", "loting", "direct", "fit"];

function matchesFilters(l: FeedListing, active: QuickFilter[]): boolean {
  const byFamily = new Map<string, boolean>();
  for (const f of active) {
    const family = FAMILY[f];
    byFamily.set(family, (byFamily.get(family) ?? false) || MATCHES[f](l));
  }
  for (const ok of byFamily.values()) if (!ok) return false;
  return true;
}

/** An absence long enough to deserve a "Terwijl je weg was" (ux-flows §2). */
const AWAY_MS = 24 * 3_600_000;
/** The complete-your-profile prompt comes back at most once a week (ux-flows §10). */
const NUDGE_COOLDOWN_MS = 7 * 24 * 3_600_000;

export default function Feed() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const [radarId, setRadarId] = useState<string | "all">("all");
  const [filters, setFilters] = useState<QuickFilter[]>([]);
  const radars = useRadars();
  const me = useMe();
  const feed = useFeed(radarId);
  const listRef = useRef<FlashListRef<FeedListing>>(null);
  const network = useNetworkState();
  const offline = network.isInternetReachable === false || network.isConnected === false;
  const hideNoFit = usePrefs((s) => s.hideNoFit);
  const setHideNoFit = usePrefs((s) => s.setHideNoFit);
  const nudgeDismissedAt = usePrefs((s) => s.profileNudgeDismissedAt);
  const dismissNudge = usePrefs((s) => s.dismissProfileNudge);
  const hydrated = usePrefsHydrated();
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: async () =>
      (await api<{ sources: Array<{ slug: string; name: string }> }>("/v1/sources")).sources,
    staleTime: 600_000,
  });
  const sourceName = useMemo(
    () => new Map((sources.data ?? []).map((s) => [s.slug, s.name])),
    [sources.data],
  );
  const [pushState, setPushState] = useState<string>("unsupported");
  useEffect(() => {
    if (Platform.OS !== "web") pushPermissionStatus().then(setPushState);
  }, []);

  const items = useMemo(
    () => feed.data?.pages.flatMap((p) => p.listings) ?? [],
    [feed.data?.pages],
  );
  const topId = items[0]?.id ?? null;

  /**
   * "Terwijl je weg was": how long since the feed was last opened. Read only once, and only after
   * the preferences have come from disk: before that "never opened" and "not loaded yet" are
   * indistinguishable, and a wrong block at the top of the feed is worse than none.
   */
  const [awaySince, setAwaySince] = useState<string | null>(null);
  const seenCaptured = useRef(false);
  useEffect(() => {
    if (!hydrated || seenCaptured.current) return;
    seenCaptured.current = true;
    setAwaySince(usePrefs.getState().feedSeenAt);
    usePrefs.getState().markFeedSeen(new Date().toISOString());
  }, [hydrated]);

  const awayCount = useMemo(() => {
    if (awaySince === null) return 0;
    const since = new Date(awaySince).getTime();
    if (Number.isNaN(since) || Date.now() - since < AWAY_MS) return 0;
    return items.filter((l) => new Date(l.publishedAt ?? l.firstSeenAt).getTime() > since).length;
  }, [awaySince, items]);

  /** "{n} nieuw": what arrived after the feed opened. Ids grow over time. */
  const [baselineId, setBaselineId] = useState<number | null>(null);
  useEffect(() => {
    if (baselineId === null && topId !== null) setBaselineId(topId);
  }, [baselineId, topId]);
  const newCount = baselineId === null ? 0 : items.filter((l) => l.id > baselineId).length;

  const visible = useMemo(
    () =>
      items.filter(
        (l) =>
          matchesFilters(l, filters) &&
          // The toggle only hides what was judged: UNKNOWN is missing data, not a refusal.
          !(hideNoFit && (l.fit?.state === "NO_FIT" || l.fit?.state === "UNLIKELY")),
      ),
    [items, filters, hideNoFit],
  );

  const toggle = (f: QuickFilter) =>
    setFilters((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const filterLabel: Record<QuickFilter, string> = {
    social: tr("segment.social"),
    midden: tr("segment.midden"),
    loting: tr("model.loting"),
    direct: tr("feed.filterDirect"),
    fit: tr("feed.filterFit"),
  };

  const profileIncomplete =
    me.data !== undefined &&
    (me.data.user.householdSize === null || me.data.user.incomeBand === null);
  const nudgeCooled =
    nudgeDismissedAt === null ||
    Date.now() - new Date(nudgeDismissedAt).getTime() > NUDGE_COOLDOWN_MS;
  const showNudge = hydrated && profileIncomplete && nudgeCooled;

  const noRadars = radars.isSuccess && radars.data.length === 0;

  const header = (
    <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
      {awayCount > 0 ? (
        <View
          style={{
            backgroundColor: t.surface2,
            borderRadius: radius.md,
            padding: space.md,
          }}
        >
          <Text>{tr("feed.away", { n: awayCount })}</Text>
        </View>
      ) : null}
      {showNudge ? (
        <View
          style={{
            backgroundColor: t.surface,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: radius.md,
            padding: space.md,
            gap: space.sm,
          }}
        >
          <Text variant="h3">{tr("feed.nudgeTitle")}</Text>
          <Text variant="caption" muted>
            {tr("feed.nudgeBody")}
          </Text>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button
              kind="secondary"
              title={tr("feed.nudgeCta")}
              onPress={() => router.push("/(tabs)/profile")}
              style={{ flex: 1 }}
            />
            <Button
              kind="ghost"
              title={tr("feed.nudgeDismiss")}
              onPress={() => dismissNudge(new Date().toISOString())}
            />
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top"]}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text variant="h1" style={{ flex: 1 }}>
            {tr("feed.title")}
          </Text>
          {newCount > 0 ? (
            <Chip
              small
              selected
              label={tr("feed.newSince", { n: newCount })}
              onPress={() => {
                setBaselineId(topId);
                listRef.current?.scrollToOffset({ offset: 0, animated: true });
              }}
            />
          ) : null}
        </View>
        {offline ? (
          <Text variant="caption" color={t.warning}>
            {tr("common.offline")}
          </Text>
        ) : null}
        {radars.data?.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            <Chip
              small
              label={tr("feed.all")}
              selected={radarId === "all"}
              onPress={() => setRadarId("all")}
            />
            {radars.data.map((r) => (
              <Chip
                key={r.id}
                small
                label={r.name}
                selected={radarId === r.id}
                onPress={() => setRadarId(r.id)}
              />
            ))}
          </ScrollView>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {FILTER_ORDER.map((f) => (
            <Chip
              key={f}
              small
              label={filterLabel[f]}
              selected={filters.includes(f)}
              onPress={() => toggle(f)}
            />
          ))}
          <Chip
            small
            label={tr("feed.hideNoFit")}
            selected={hideNoFit}
            onPress={() => setHideNoFit(!hideNoFit)}
          />
        </ScrollView>
        {pushState === "denied" ? (
          <Text variant="caption" color={t.warning}>
            {tr("profile.pushOff")}
          </Text>
        ) : null}
      </View>
      {noRadars ? (
        <EmptyState
          title={tr("radar.noneYet")}
          cta={tr("feed.createRadar")}
          onPress={() => router.push("/radar/new")}
        />
      ) : feed.isPending ? (
        <ActivityIndicator style={{ marginTop: space.xxl }} color={t.accent} />
      ) : (
        <FlashList
          ref={listRef}
          data={visible}
          extraData={offline}
          keyExtractor={(l) => String(l.id)}
          renderItem={({ item }) => (
            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
              <ListingCard
                listing={item}
                fit={item.fit}
                offline={offline}
                sourceName={sourceName.get(item.sourceSlug)}
                onPress={() => router.push(`/listing/${item.id}`)}
              />
            </View>
          )}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingTop: space.md, paddingBottom: space.xxl }}
          onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              refreshing={feed.isRefetching}
              onRefresh={() => feed.refetch()}
              tintColor={t.accent}
            />
          }
          ListEmptyComponent={
            items.length ? (
              <EmptyState
                title={tr("feed.filtered")}
                body={tr("feed.filteredSub")}
                cta={tr("feed.clearFilters")}
                onPress={() => {
                  setFilters([]);
                  setHideNoFit(false);
                }}
              />
            ) : (
              <EmptyState
                title={tr("feed.empty")}
                body={tr("feed.emptySub")}
                cta={tr("radar.edit")}
                onPress={() => router.push("/(tabs)/radars")}
              />
            )
          }
          ListFooterComponent={
            feed.isFetchingNextPage ? <ActivityIndicator color={t.accent} /> : null
          }
        />
      )}
    </SafeAreaView>
  );
}
