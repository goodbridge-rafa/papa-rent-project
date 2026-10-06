import { TextInput, type TextInputProps, View } from "react-native";
import { fonts, radius, space, useTheme } from "@/lib/theme";
import { Text } from "./Text";

export function TextField({
  label,
  error,
  style,
  ...rest
}: TextInputProps & { label?: string; error?: string | null }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text variant="caption" muted>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={t.muted}
        {...rest}
        style={[
          {
            fontFamily: fonts.body,
            fontSize: 16,
            color: t.text,
            backgroundColor: t.surface,
            borderWidth: 1,
            borderColor: error ? t.danger : t.border,
            borderRadius: radius.md,
            paddingHorizontal: space.lg,
            paddingVertical: 12,
            minHeight: 48,
          },
          style,
        ]}
      />
      {error ? (
        <Text variant="caption" color={t.danger}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
