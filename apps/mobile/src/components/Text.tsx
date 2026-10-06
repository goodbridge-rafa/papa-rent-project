import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { fonts, useTheme } from "@/lib/theme";

type Variant = "display" | "h1" | "h2" | "h3" | "bodyL" | "body" | "price" | "label" | "caption";
const styles: Record<Variant, TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40 },
  h1: { fontFamily: fonts.heading, fontSize: 28, lineHeight: 34 },
  h2: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 28 },
  h3: { fontFamily: fonts.heading, fontSize: 18, lineHeight: 24 },
  bodyL: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  price: {
    fontFamily: fonts.semibold,
    fontSize: 20,
    lineHeight: 26,
    fontVariant: ["tabular-nums"],
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
};

export function Text({
  variant = "body",
  muted,
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; muted?: boolean; color?: string }) {
  const t = useTheme();
  return (
    <RNText
      {...rest}
      style={[styles[variant], { color: color ?? (muted ? t.muted : t.text) }, style]}
      maxFontSizeMultiplier={2}
    />
  );
}
