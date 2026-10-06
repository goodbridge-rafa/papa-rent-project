import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { ago, countdown, dateShort, euro, isClosingSoon } from "@/lib/format";
import { usePrefs } from "@/lib/store";
import { palette, radius, space, useTheme } from "@/lib/theme";
import type { FitSummary, Listing } from "@/lib/types";
import { Badge } from "./Badge";
import { FitBadge, FitLine } from "./Fit";
import { MapThumb } from "./MapThumb";
import { Text } from "./Text";

export function ListingCard({
  listing: l,
  sourceName,
  fit = null,
  offline = false,
  onPress,
}: {
  listing: Listing;
  sourceName?: string;
  /** "past bij jou" verdict from the authenticated feed; `null` when absent (public catalogue). */
  fit?: FitSummary | null;
  /** Offline, a countdown would lie: we show the closing date instead (ux-flows §9). */
  offline?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const { t: tr, i18n } = useTranslation();
  const locale = i18n.language === "nl" ? "nl" : "en";
  const applied = usePrefs((s) => s.appliedListingIds.includes(l.id));
  const isNew = l.publishedAt
    ? Date.now() - new Date(l.publishedAt).getTime() < 15 * 60_000
    : false;
  const closing = isClosingSoon(l.closesAt);
  const left = countdown(l.closesAt, locale);
  const place = [l.city, l.municipality && l.municipality !== l.city ? l.municipality : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: t.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: t.border,
        padding: space.md,
        gap: space.sm,
        // §5: what is not for you fades, but stays readable and still opens.
        opacity: applied || fit?.state === "NO_FIT" ? 0.7 : pressed ? 0.92 : 1,
      })}
    >
      <MapThumb lat={l.lat} lng={l.lng} height={120} zoom={14} />
      <View
        style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm, flexWrap: "wrap" }}
      >
        <Text variant="price">€ {euro(l.priceNet)}</Text>
        {l.priceTotal !== null && l.priceTotal !== l.priceNet ? (
          <Text variant="caption" muted>
            {tr("card.total", { v: euro(l.priceTotal) })}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {isNew ? (
          <View
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.orange500 }}
          />
        ) : null}
      </View>
      <Text variant="body" numberOfLines={1}>
        {l.title}
      </Text>
      <Text variant="caption" muted numberOfLines={1}>
        {place}
        {l.bedrooms !== null
          ? ` · ${l.bedrooms === 0 ? tr("card.studio") : tr("card.rooms", { n: l.bedrooms })}`
          : ""}
        {l.areaM2 !== null ? ` · ${Math.round(l.areaM2)} m²` : ""}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <FitBadge fit={fit} />
        <Badge text={tr(`segment.${l.segment}`)} tone="segment" />
        {l.allocationModel !== "unknown" ? (
          <Badge text={tr(`model.${l.allocationModel}`)} tone="model" />
        ) : null}
        {sourceName ? <Badge text={sourceName} tone="neutral" /> : null}
        {l.labels.slice(0, 2).map((lb) => (
          <Badge key={lb} text={tr(`label.${lb}`, { defaultValue: lb })} tone="label" />
        ))}
        {applied ? <Badge text={tr("card.applied")} tone="success" /> : null}
      </View>
      <FitLine fit={fit} />
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text variant="caption" muted>
          {l.publishedAt ? tr("card.newAgo", { t: ago(l.publishedAt, locale) }) : ""}
        </Text>
        {offline && l.closesAt ? (
          <Text variant="caption" muted>
            {tr("card.closesOn", { d: dateShort(l.closesAt, locale) })}
          </Text>
        ) : left ? (
          <Text variant="caption" color={closing ? t.accent : t.muted}>
            {tr("card.closesIn", { d: left })}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
