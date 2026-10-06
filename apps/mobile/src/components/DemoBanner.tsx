import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/Text";
import { config } from "@/lib/config";
import { DEMO_SNAPSHOT_AT, DEMO_SOURCES, onDemoRefusal } from "@/lib/demo";
import { useTheme } from "@/lib/theme";

/** How long the banner shows the "this does not work here" notice before returning to normal. */
const REFUSAL_MS = 6000;

/**
 * Permanent banner of the web demo.
 *
 * It is not decoration and cannot be closed: a simulated capability must never pass for a real
 * one. It says three things (that this is a demo, that the listings are fictional, and that
 * nothing you write works) and expands into the details for whoever taps it.
 *
 * It is also where a refusal shows up. When someone tries to save something, the screen below
 * either says nothing (saving the profile is a `mutate` without error UI) or says "something went
 * wrong, try again", and trying again will never work. The banner catches the refusal wherever
 * it comes from and tells the truth: this does not exist in the demo.
 */
export function DemoBanner() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [refused, setRefused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!config.demo) return;
    const stop = onDemoRefusal(() => {
      setRefused(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setRefused(false), REFUSAL_MS);
    });
    return () => {
      stop();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!config.demo) return null;

  const day = new Date(DEMO_SNAPSHOT_AT).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      accessibilityRole="button"
      accessibilityLabel={tr("demo.a11y")}
      accessibilityState={{ expanded: open }}
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: refused ? t.danger : t.warningBg,
        paddingTop: insets.top + 8,
        paddingBottom: 10,
        paddingHorizontal: 16,
      }}
    >
      <Text variant="label" style={{ color: "#FFFFFF" }}>
        {refused ? tr("demo.refusedTitle") : tr("demo.title")}
      </Text>
      <Text variant="caption" style={{ color: "#FFFFFF", opacity: 0.92, marginTop: 2 }}>
        {refused
          ? tr("demo.refusedBody")
          : open
            ? tr("demo.less")
            : tr("demo.summary", { date: day })}
      </Text>
      {open && !refused ? (
        <View style={{ marginTop: 8, gap: 6 }}>
          <Text variant="caption" style={{ color: "#FFFFFF", opacity: 0.92 }}>
            {tr("demo.data", { date: day, sources: DEMO_SOURCES.length })}
          </Text>
          <Text variant="caption" style={{ color: "#FFFFFF", opacity: 0.92 }}>
            {tr("demo.works")}
          </Text>
          <Text variant="caption" style={{ color: "#FFFFFF", opacity: 0.92 }}>
            {tr("demo.missing")}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
