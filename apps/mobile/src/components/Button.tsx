import { ActivityIndicator, Pressable, type PressableProps, type ViewStyle } from "react-native";
import { radius, space, useTheme } from "@/lib/theme";
import { Text } from "./Text";

type Kind = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  title,
  kind = "primary",
  loading,
  disabled,
  style,
  ...rest
}: PressableProps & { title: string; kind?: Kind; loading?: boolean; style?: ViewStyle }) {
  const t = useTheme();
  const bg = { primary: t.primary, secondary: t.surface2, ghost: "transparent", danger: t.danger }[
    kind
  ];
  const fg = { primary: t.primaryText, secondary: t.text, ghost: t.link, danger: "#fff" }[kind];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      {...rest}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          paddingVertical: 14,
          paddingHorizontal: space.xl,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          minHeight: 50,
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text variant="body" color={fg} style={{ fontFamily: "Inter_600SemiBold" }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
