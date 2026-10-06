import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { Manrope_700Bold, Manrope_800ExtraBold } from "@expo-google-fonts/manrope";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { DemoBanner } from "@/components/DemoBanner";
import { authClient } from "@/lib/auth-client";
import { deviceLocale, initI18n } from "@/lib/i18n";
import { routeFromNotification } from "@/lib/notifications";
import { usePrefs } from "@/lib/store";
import { type Theme, useTheme } from "@/lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * i18n before the first render, not inside a `useEffect`.
 *
 * In a `useEffect` initialization only happened after painting: the web export's pre-rendered
 * HTML came out with the keys showing ("feed.title", "tabs.feed") and only hydration swapped them
 * for text. The `useEffect` below still exists, but only to switch language; `initI18n` is
 * idempotent.
 */
initI18n(deviceLocale());

/** Maximum time startup waits for fonts and session before painting anyway. */
const BOOT_TIMEOUT_MS = 2500;

/** `true` once the deadline passes. Only there to guarantee startup always finishes. */
function useDeadline(ms: number): boolean {
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setPassed(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return passed;
}

/** Native only: takes the user to the listing when they tap a notification. */
function NotificationRouter() {
  const router = useRouter();
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const route = routeFromNotification(lastResponse);
    if (route) router.push(route as never);
  }, [lastResponse, router]);
  return null;
}

/** Empty header with a back arrow when there is somewhere to go back to (a deep link enters without history). */
const recoveryScreen = (t: Theme) => ({
  headerShown: true,
  title: "",
  headerBackButtonDisplayMode: "minimal" as const,
  headerStyle: { backgroundColor: t.bg },
  headerTintColor: t.text,
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  const { data: session, isPending } = authClient.useSession();
  const locale = usePrefs((s) => s.locale);
  const t = useTheme();
  const qc = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } }),
    [],
  );

  useEffect(() => {
    initI18n(locale ?? deviceLocale());
  }, [locale]);

  /**
   * Startup must always finish. `useFonts` fetches Google Fonts from the network and fails
   * silently on the web: while this returned `null` until `fontsLoaded`, such a failure left the
   * app painting nothing, forever. So an error counts as resolved, and even without an error there
   * is a deadline: after `BOOT_TIMEOUT_MS` we paint with the system font and the brand typography
   * comes in when it arrives. Until then there is no white screen: the theme background with a spinner.
   */
  const deadline = useDeadline(BOOT_TIMEOUT_MS);
  const fontsSettled = fontsLoaded || fontError !== null || deadline;
  const ready = fontsSettled && (!isPending || deadline);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready)
    return (
      <View
        style={{ flex: 1, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}
      >
        <ActivityIndicator color={t.accent} />
      </View>
    );
  return (
    <QueryClientProvider client={qc}>
      {Platform.OS !== "web" && session ? <NotificationRouter /> : null}
      <StatusBar style={t.dark ? "light" : "dark"} />
      {/* The banner sits above everything and outside the Stack: in demo mode no screen, not even
          the auth ones, may appear without the notice that the data is simulated. */}
      <DemoBanner />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="listing/[id]"
            options={{
              headerShown: true,
              title: "",
              headerBackTitle: "",
              headerStyle: { backgroundColor: t.bg },
              headerTintColor: t.text,
            }}
          />
          <Stack.Screen
            name="radar/new"
            options={{
              presentation: "modal",
              headerShown: true,
              title: "",
              headerStyle: { backgroundColor: t.bg },
              headerTintColor: t.text,
            }}
          />
          <Stack.Screen
            name="radar/[id]"
            options={{
              headerShown: true,
              title: "",
              headerStyle: { backgroundColor: t.bg },
              headerTintColor: t.text,
            }}
          />
          <Stack.Screen name="push-prompt" options={{ presentation: "modal" }} />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        {/* Account recovery: outside both guards on purpose. Whoever opens the e-mail link may or
            may not have a session on this device, and in both cases must land on the screen. */}
        <Stack.Screen name="forgot-password" options={recoveryScreen(t)} />
        <Stack.Screen name="reset-password" options={recoveryScreen(t)} />
        <Stack.Screen name="verify-email" options={recoveryScreen(t)} />
      </Stack>
    </QueryClientProvider>
  );
}
