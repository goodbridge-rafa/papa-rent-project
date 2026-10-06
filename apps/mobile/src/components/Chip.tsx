import { Pressable } from "react-native";
import { radius, space, useTheme } from "@/lib/theme";
import { Text } from "./Text";

export function Chip({
  label,
  selected,
  onPress,
  small,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  small?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: small ? space.md : space.lg,
        paddingVertical: small ? 6 : 10,
        borderRadius: radius.pill,
        backgroundColor: selected ? t.primary : t.surface2,
        borderWidth: 1,
        borderColor: selected ? t.primary : t.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text variant={small ? "caption" : "body"} color={selected ? t.primaryText : t.text}>
        {label}
      </Text>
    </Pressable>
  );
}
