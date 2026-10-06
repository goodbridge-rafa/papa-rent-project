import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { euro } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import type { FitDetail, FitRule, FitSummary } from "@/lib/types";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Text } from "./Text";

/**
 * The "past bij jou" signal (docs/product/eligibility.md).
 *
 * Two rules this file exists to keep from breaking:
 *  1. It is guidance, not a decision: the portal decides. The §1 notice stays visible next to
 *     the verdict at all times, never folded inside "Waarom?".
 *  2. `UNKNOWN` is missing information, not a refusal: neutral colour, never a warning colour,
 *     and always with the way to resolve it (completing the profile).
 */

/** Card badge. Only `FIT` gets a badge (§5); the rest never becomes a red stamp. */
export function FitBadge({ fit }: { fit: FitSummary | null }) {
  const { t: tr } = useTranslation();
  if (fit?.state !== "FIT") return null;
  return <Badge text={tr("card.fits")} tone="success" />;
}

/**
 * Card line for anything that is not `FIT`. `UNLIKELY` and `NO_FIT` are explained in one neutral
 * line; `UNKNOWN` says nothing on the card: the complete-your-profile prompt lives at the top of
 * the feed, once, instead of repeating on every listing.
 */
export function FitLine({ fit }: { fit: FitSummary | null }) {
  const { t: tr } = useTranslation();
  if (!fit || fit.state === "FIT" || fit.state === "UNKNOWN") return null;
  return (
    <Text variant="caption" muted numberOfLines={2}>
      {tr(`fit.reason.${fit.reason}`)}
    </Text>
  );
}

/** "1 januari 2026": a threshold's effective date deserves the full year. */
function longDate(iso: string, locale: "nl" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** The official source's domain, which is what the user recognises in a link. */
function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Only monthly amounts get cents: a rent is € 932,93, an annual income is a round number. */
function rawValue(rule: FitRule): string {
  if (rule.unit === "eur_month") return euro(rule.value, { decimals: true });
  if (rule.unit === "eur_year") return euro(rule.value);
  return String(rule.value);
}

function RuleRow({ rule }: { rule: FitRule }) {
  const t = useTheme();
  const { t: tr, i18n } = useTranslation();
  const locale = i18n.language === "nl" ? "nl" : "en";
  const line = tr("fit.ruleSource", {
    host: host(rule.source),
    date: longDate(rule.validFrom, locale),
  });
  return (
    <View style={{ gap: 2, paddingVertical: 4 }}>
      <Text variant="caption">
        {tr(`fit.rule.${rule.key}`)} · {tr(`fit.unit.${rule.unit}`, { v: rawValue(rule) })}
      </Text>
      <Text
        variant="caption"
        color={t.link}
        accessibilityRole="link"
        style={{ textDecorationLine: "underline" }}
        onPress={() => void WebBrowser.openBrowserAsync(rule.source)}
      >
        {line}
      </Text>
    </View>
  );
}

/**
 * The detail block: verdict, reason, mandatory notice and the "Waarom?" explanation with the
 * thresholds used, their value, their effective date and the official source (§5).
 */
export function FitPanel({ fit, portal }: { fit: FitDetail | null; portal: string }) {
  const t = useTheme();
  const router = useRouter();
  const { t: tr, i18n } = useTranslation();
  const locale = i18n.language === "nl" ? "nl" : "en";
  const [open, setOpen] = useState(false);
  if (!fit) return null;
  const unknown = fit.state === "UNKNOWN";
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        // Only a fit gets colour. UNKNOWN and the "no"s keep the normal frame: a coloured warning
        // would read as a rejection, and that is not what these states say.
        borderColor: fit.state === "FIT" ? t.success : t.border,
        padding: space.lg,
        gap: space.sm,
      }}
    >
      <Text variant="h3" color={fit.state === "FIT" ? t.success : t.text}>
        {tr(`fit.state.${fit.state}`)}
      </Text>
      <Text>{tr(`fit.reason.${fit.reason}`)}</Text>
      <Text variant="caption" muted>
        {tr("fit.disclaimer", { portal })}
      </Text>

      {unknown ? (
        <>
          <Text variant="caption" muted>
            {tr("fit.completeTitle")}
          </Text>
          <Button
            kind="secondary"
            title={tr("fit.completeCta")}
            onPress={() => router.push("/(tabs)/profile")}
          />
        </>
      ) : null}

      {fit.notes.length ? (
        <View style={{ gap: 2 }}>
          <Text variant="label" muted>
            {tr("fit.notes")}
          </Text>
          {fit.notes.map((n) => (
            <Text key={n} variant="caption" muted>
              • {tr(`fit.note.${n}`)}
            </Text>
          ))}
        </View>
      ) : null}

      {fit.hints.length ? (
        <View style={{ gap: 2 }}>
          <Text variant="label" color={t.accent}>
            {tr("fit.tips")}
          </Text>
          {fit.hints.map((h) => (
            <Text key={h} variant="caption">
              • {tr(`fit.hint.${h}`)}
            </Text>
          ))}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        hitSlop={8}
      >
        <Text color={t.link} style={{ textDecorationLine: "underline" }}>
          {open ? tr("fit.whyHide") : tr("fit.why")}
        </Text>
      </Pressable>

      {open ? (
        <View style={{ gap: space.sm }}>
          <View style={{ gap: 2 }}>
            <Text variant="label" muted>
              {tr("fit.checked")}
            </Text>
            <Text variant="caption" muted>
              {fit.decidedBy === null
                ? tr("fit.reason.all_conditions_match")
                : `${tr(`fit.dimension.${fit.decidedBy}`)} · ${tr(`fit.reason.${fit.reason}`)}`}
            </Text>
          </View>
          {fit.rules.length ? (
            <View>
              <Text variant="label" muted>
                {tr("fit.rules")}
              </Text>
              {fit.rules.map((r) => (
                <RuleRow key={r.key} rule={r} />
              ))}
            </View>
          ) : null}
          <Text variant="caption" muted>
            {tr("fit.readAt", { date: longDate(fit.rulesReadAt, locale) })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
