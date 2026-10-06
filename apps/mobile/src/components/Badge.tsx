import { View } from "react-native";
import { radius, useTheme } from "@/lib/theme";
import { Text } from "./Text";

type Tone = "segment" | "model" | "label" | "success" | "warning" | "neutral";

export function Badge({ text, tone = "neutral" }: { text: string; tone?: Tone }) {
  const t = useTheme();
  const bg = {
    segment: t.primary,
    model: t.surface2,
    label: t.surface2,
    success: t.successBg,
    warning: t.warningBg,
    neutral: t.surface2,
  }[tone];
  const fg = {
    segment: t.primaryText,
    model: t.text,
    label: t.muted,
    success: "#fff",
    warning: "#fff",
    neutral: t.muted,
  }[tone];
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: radius.sm,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}
    >
      <Text variant="caption" color={fg}>
        {text}
      </Text>
    </View>
  );
}
