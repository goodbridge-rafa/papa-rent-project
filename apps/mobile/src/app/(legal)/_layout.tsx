import { Stack } from "expo-router";
import { useTheme } from "@/lib/theme";

/**
 * Group without a URL segment: the files in here serve `/terms`, `/privacy`, `/disclaimer` and
 * `/bot`, both in the app and in the static web export. Outside the session guard on purpose:
 * a privacy policy must be reachable without an account.
 */
export default function LegalLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        title: "",
        headerBackButtonDisplayMode: "minimal",
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
