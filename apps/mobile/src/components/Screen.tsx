import type { ReactNode } from "react";
import { ScrollView, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { space, useTheme } from "@/lib/theme";

export function Screen({
  children,
  scroll = true,
  style,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  padded?: boolean;
}) {
  const t = useTheme();
  const inner = {
    padding: padded ? space.lg : 0,
    gap: space.lg,
    maxWidth: 720,
    width: "100%" as const,
    alignSelf: "center" as const,
  };
  return (
    <SafeAreaView
      style={[{ flex: 1, backgroundColor: t.bg }, style]}
      edges={["top", "left", "right"]}
    >
      {scroll ? (
        <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[inner, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}
