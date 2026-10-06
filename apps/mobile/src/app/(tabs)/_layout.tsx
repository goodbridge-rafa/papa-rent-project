import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import type { ColorValue } from "react-native";
import { useTheme } from "@/lib/theme";

export default function TabsLayout() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const icon =
    (name: keyof typeof Ionicons.glyphMap) =>
    ({ color, size }: { color: ColorValue; size: number }) => (
      <Ionicons name={name} color={color} size={size} />
    );
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: tr("tabs.feed"), tabBarIcon: icon("home") }} />
      <Tabs.Screen
        name="radars"
        options={{ title: tr("tabs.radars"), tabBarIcon: icon("radio") }}
      />
      <Tabs.Screen
        name="inbox"
        options={{ title: tr("tabs.inbox"), tabBarIcon: icon("notifications") }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: tr("tabs.profile"), tabBarIcon: icon("person") }}
      />
    </Tabs>
  );
}
