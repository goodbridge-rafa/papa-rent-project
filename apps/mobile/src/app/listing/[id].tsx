import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Platform, Share, View } from "react-native";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { FitPanel } from "@/components/Fit";
import { MapThumb } from "@/components/MapThumb";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { countdown, dateShort, euro } from "@/lib/format";
import { useListing } from "@/lib/queries";
import { usePrefs } from "@/lib/store";
import { radius, space, useTheme } from "@/lib/theme";

function Fact({ k, v }: { k: string; v: string | null | undefined }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: t.border,
      }}
    >
      <Text muted>{k}</Text>
      <Text>{v ?? tr("common.unknown")}</Text>
    </View>
  );
}

export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { t: tr, i18n } = useTranslation();
  const locale = i18n.language === "nl" ? "nl" : "en";
  const q = useListing(Number(id));
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: async () =>
      (await api<{ sources: Array<{ slug: string; name: string }> }>("/v1/sources")).sources,
    staleTime: 600_000,
  });
  const applied = usePrefs((s) => s.appliedListingIds.includes(Number(id)));
  const markApplied = usePrefs((s) => s.markApplied);
  if (q.isPending)
    return (
      <Screen>
        <ActivityIndicator color={t.accent} />
      </Screen>
    );
  if (!q.data)
    return (
      <Screen>
        <Text muted>{tr("common.error")}</Text>
      </Screen>
    );
  const { listing: l, fit } = q.data;
  const portal = sources.data?.find((s) => s.slug === l.sourceSlug)?.name ?? l.sourceSlug;
  const left = countdown(l.closesAt, locale);
  const closed = !!l.removedAt || (l.closesAt !== null && new Date(l.closesAt) < new Date());
  const open = async () => {
    await WebBrowser.openBrowserAsync(l.applyUrl ?? l.url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
    });
    if (Platform.OS !== "web") {
      Alert.alert(tr("detail.didApply"), tr("detail.trackNote"), [
        { text: tr("detail.notYet"), style: "cancel" },
        { text: tr("detail.yesApplied"), onPress: () => markApplied(l.id, true) },
      ]);
    }
  };
  const e = l.eligibility;
  return (
    <>
      <Stack.Screen options={{ title: l.city ?? "" }} />
      <Screen>
        <MapThumb lat={l.lat} lng={l.lng} height={180} />
        <Text variant="caption" muted>
          {tr("detail.mapCredit")}
        </Text>
        <View style={{ gap: 4 }}>
          <Text variant="h1">{l.title}</Text>
          <Text muted>{[l.postcode, l.municipality, l.province].filter(Boolean).join(" · ")}</Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Badge text={tr(`segment.${l.segment}`)} tone="segment" />
          {l.allocationModel !== "unknown" ? (
            <Badge text={tr(`model.${l.allocationModel}`)} tone="model" />
          ) : null}
          <Badge text={portal} tone="neutral" />
          {l.labels.map((lb) => (
            <Badge key={lb} text={tr(`label.${lb}`, { defaultValue: lb })} tone="label" />
          ))}
          {applied ? <Badge text={tr("card.applied")} tone="success" /> : null}
        </View>
        {/* High on the screen on purpose: the notice that this is only an indication must be
            read before the price and the button, not after. */}
        <FitPanel fit={fit} portal={portal} />
        <View
          style={{
            backgroundColor: t.surface,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: t.border,
            padding: space.lg,
            gap: 4,
          }}
        >
          <Text variant="price">
            € {euro(l.priceNet, { decimals: true })}{" "}
            <Text muted>{tr("card.base", { v: "" }).replace("€  ", "").trim()}</Text>
          </Text>
          {l.serviceCosts !== null ? (
            <Text muted>
              + € {euro(l.serviceCosts, { decimals: true })} {tr("detail.serviceCosts")}
            </Text>
          ) : (
            <Text variant="caption" muted>
              {tr("card.serviceUnknown")}
            </Text>
          )}
          {l.priceTotal !== null && l.priceTotal !== l.priceNet ? (
            <Text>{tr("card.total", { v: euro(l.priceTotal, { decimals: true }) })}</Text>
          ) : null}
          {left ? <Text color={t.accent}>{tr("card.closesIn", { d: left })}</Text> : null}
          {closed ? (
            <Text color={t.danger}>
              {l.removedAt ? tr("detail.removed", { portal }) : tr("detail.closed")}
            </Text>
          ) : null}
          {l.reactionsCount !== null ? (
            <Text variant="caption" muted>
              {tr("detail.reactions", { n: l.reactionsCount })}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            backgroundColor: t.surface2,
            borderRadius: radius.md,
            padding: space.md,
            gap: 4,
          }}
        >
          <Text variant="h3">{tr("detail.how")}</Text>
          <Text>{tr(`modelExplain.${l.allocationModel}`)}</Text>
          {l.registrationRequired ? (
            <Text variant="caption" color={t.accent}>
              {tr("detail.regUnknown", { portal }).replace(
                tr("detail.regUnknown", { portal }),
                tr("detail.regFree", { portal }).replace(" · gratis", "").replace(" · free", ""),
              )}
            </Text>
          ) : null}
        </View>
        {l.notices.length ? (
          <View style={{ gap: 4 }}>
            <Text variant="h3">{tr("detail.notices")}</Text>
            {l.notices.map((n) => (
              <Text key={n} muted>
                • {n}
              </Text>
            ))}
          </View>
        ) : null}
        <View>
          <Text variant="h3" style={{ marginBottom: 4 }}>
            {tr("detail.facts")}
          </Text>
          <Fact k={tr("detail.type")} v={l.dwellingType} />
          <Fact k={tr("detail.area")} v={l.areaM2 !== null ? `${Math.round(l.areaM2)} m²` : null} />
          <Fact k={tr("detail.bedrooms")} v={l.bedrooms !== null ? String(l.bedrooms) : null} />
          <Fact k={tr("detail.floor")} v={l.floor !== null ? String(l.floor) : null} />
          <Fact k={tr("detail.energy")} v={l.energyLabel} />
          <Fact
            k={tr("detail.built")}
            v={l.constructionYear !== null ? String(l.constructionYear) : null}
          />
          <Fact k={tr("detail.available")} v={l.availableFrom ?? l.availableFromText} />
          <Fact
            k={tr("detail.published")}
            v={l.publishedAt ? dateShort(l.publishedAt, locale) : null}
          />
          <Fact
            k={tr("detail.closes")}
            v={
              l.closesAt
                ? `${dateShort(l.closesAt, locale)} ${new Date(l.closesAt).toLocaleTimeString(locale === "nl" ? "nl-NL" : "en-GB", { hour: "2-digit", minute: "2-digit" })}`
                : null
            }
          />
        </View>
        {e &&
        (e.minIncome ||
          e.maxIncome ||
          e.minAge ||
          e.maxAge ||
          e.minHousehold ||
          e.maxHousehold ||
          e.localBindingPriority) ? (
          <View>
            <Text variant="h3" style={{ marginBottom: 4 }}>
              {tr("detail.eligibility")}
            </Text>
            {e.minIncome || e.maxIncome ? (
              <Fact
                k={tr("detail.income")}
                v={`${e.minIncome ? `€ ${euro(e.minIncome)}` : ""} – ${e.maxIncome ? `€ ${euro(e.maxIncome)}` : ""}`}
              />
            ) : null}
            {e.minHousehold || e.maxHousehold ? (
              <Fact
                k={tr("detail.household")}
                v={`${e.minHousehold ?? 1} – ${e.maxHousehold ?? "∞"}`}
              />
            ) : null}
            {e.minAge || e.maxAge ? (
              <Fact k={tr("detail.age")} v={`${e.minAge ?? ""} – ${e.maxAge ?? ""}`} />
            ) : null}
            {e.localBindingPriority ? (
              <Text variant="caption" color={t.accent}>
                {tr("detail.localPriority")}
              </Text>
            ) : null}
          </View>
        ) : null}
        {l.description ? <Text muted>{l.description}</Text> : null}
        <View style={{ gap: space.sm }}>
          <Button title={tr("detail.apply", { portal })} onPress={open} disabled={closed} />
          <Text variant="caption" muted style={{ textAlign: "center" }}>
            {tr("detail.applySub", { portal })}
          </Text>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button
              kind="secondary"
              title={tr("detail.viewOn", { portal })}
              onPress={() => WebBrowser.openBrowserAsync(l.url)}
              style={{ flex: 1 }}
            />
            <Button
              kind="secondary"
              title={tr("detail.share")}
              onPress={() =>
                Share.share({ message: `${l.title} · € ${euro(l.priceNet)} · ${l.url}` })
              }
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </Screen>
    </>
  );
}
