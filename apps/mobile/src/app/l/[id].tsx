import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Linking, Platform, View } from "react-native";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { ApiError, api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { config } from "@/lib/config";
import { countdown, dateShort, euro } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import type { Listing } from "@/lib/types";

/**
 * Web fallback destination of every alert (`<WEB_URL>/l/{id}` in the push and the e-mail).
 *
 * It must open without a session: whoever taps the e-mail link may be on someone else's phone, in
 * a browser without a login, or may never have installed the app. So it reads `/v1/listings/:id`,
 * which is public, and touches nothing that requires an account.
 *
 * On a phone with the app installed the universal link opens here inside the app; in that case,
 * with a session, we deliver the full detail (eligibility, "already applied") instead of this
 * reduced version.
 */
export default function PublicListing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const numericId = Number(id);
  const t = useTheme();
  const router = useRouter();
  const { t: tr, i18n } = useTranslation();
  const locale = i18n.language === "nl" ? "nl" : "en";
  const { data: session } = authClient.useSession();

  const q = useQuery({
    queryKey: ["public-listing", numericId],
    queryFn: async () => (await api<{ listing: Listing }>(`/v1/listings/${numericId}`)).listing,
    enabled: Number.isInteger(numericId),
    // 404 and 400 are final answers: retrying only delays the "does not exist" screen.
    retry: (count, error) =>
      count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: async () =>
      (await api<{ sources: Array<{ slug: string; name: string }> }>("/v1/sources")).sources,
    staleTime: 600_000,
  });

  if (Platform.OS !== "web" && session && Number.isInteger(numericId))
    return <Redirect href={`/listing/${numericId}`} />;

  const header = <Stack.Screen options={{ headerShown: true, title: "" }} />;

  if (!Number.isInteger(numericId))
    return (
      <>
        {header}
        <Screen>
          <EmptyState
            title={tr("pub.notFound")}
            body={tr("pub.notFoundBody")}
            cta={tr("pub.home")}
            onPress={() => router.replace("/")}
          />
        </Screen>
      </>
    );

  if (q.isPending)
    return (
      <>
        {header}
        <Screen>
          <ActivityIndicator color={t.accent} />
        </Screen>
      </>
    );

  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        {header}
        <Screen>
          <EmptyState
            title={gone ? tr("pub.notFound") : tr("pub.loadError")}
            body={gone ? tr("pub.notFoundBody") : tr("common.error")}
            cta={gone ? tr("pub.home") : tr("common.retry")}
            onPress={() => {
              if (gone) router.replace("/");
              else void q.refetch();
            }}
          />
        </Screen>
      </>
    );
  }

  const l = q.data;
  const portal = sources.data?.find((s) => s.slug === l.sourceSlug)?.name ?? l.sourceSlug;
  const left = countdown(l.closesAt, locale);
  const closed = !!l.removedAt || (l.closesAt !== null && new Date(l.closesAt) < new Date());
  const facts = [
    l.dwellingType,
    l.areaM2 !== null ? `${Math.round(l.areaM2)} m²` : null,
    l.bedrooms !== null ? tr("card.rooms", { n: l.bedrooms }) : null,
    l.energyLabel,
  ].filter((v): v is string => !!v);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: l.city ?? "" }} />
      <Screen>
        <Text variant="caption" muted>
          {tr("pub.via")}
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
        </View>
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
          <Text variant="price">€ {euro(l.priceNet, { decimals: true })}</Text>
          {l.serviceCosts !== null ? (
            <Text muted>
              + € {euro(l.serviceCosts, { decimals: true })} {tr("detail.serviceCosts")}
            </Text>
          ) : (
            <Text variant="caption" muted>
              {tr("card.serviceUnknown")}
            </Text>
          )}
          {facts.length ? <Text muted>{facts.join(" · ")}</Text> : null}
          {left ? <Text color={t.accent}>{tr("card.closesIn", { d: left })}</Text> : null}
          {l.publishedAt ? (
            <Text variant="caption" muted>
              {tr("detail.published")} · {dateShort(l.publishedAt, locale)}
            </Text>
          ) : null}
        </View>
        {closed ? (
          <View style={{ backgroundColor: t.surface2, borderRadius: radius.md, padding: space.md }}>
            <Text color={t.danger}>
              {l.removedAt ? tr("detail.removed", { portal }) : tr("detail.closed")}
            </Text>
          </View>
        ) : null}
        <Text muted>{tr(`modelExplain.${l.allocationModel}`)}</Text>
        <View style={{ gap: space.sm }}>
          <Button
            title={tr("detail.apply", { portal })}
            disabled={closed}
            onPress={() =>
              WebBrowser.openBrowserAsync(l.applyUrl ?? l.url, {
                presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
              })
            }
          />
          <Text variant="caption" muted style={{ textAlign: "center" }}>
            {tr("detail.applySub", { portal })}
          </Text>
          {Platform.OS === "web" ? (
            <Button
              kind="secondary"
              title={tr("pub.openInApp")}
              // Tries the app scheme. If it is not installed nothing happens and the page stays
              // where it is, which is why this button is never the only way to reach the listing.
              onPress={() =>
                void Linking.openURL(`${config.scheme}://listing/${l.id}`).catch(() => {})
              }
            />
          ) : null}
          <Button kind="ghost" title={tr("pub.home")} onPress={() => router.replace("/")} />
        </View>
      </Screen>
    </>
  );
}
