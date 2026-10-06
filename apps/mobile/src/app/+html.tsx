import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

/**
 * HTML shell of the web export. Web only: Expo Router ignores this file on native.
 *
 * Without it the export came out with `<title></title>`: the browser tab showed the raw URL. What
 * is here is static on purpose (it runs during pre-rendering, in Node, with no app state).
 */

/** `EXPO_PUBLIC_*` is substituted in the bundle, so this is a compile-time constant. */
const DEMO = (process.env.EXPO_PUBLIC_DEMO ?? "").trim() === "1";

const TITLE = DEMO ? "PAPA RENT · demo" : "PAPA RENT";
const DESCRIPTION = DEMO
  ? "Demonstratie van PAPA RENT met fictieve voorbeeldwoningen. Geen echte woningen."
  : "Alle sociale huur en middenhuur van Nederland in één app — melding binnen seconden na publicatie.";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="nl">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta name="theme-color" content="#0A1B33" />
        {/* The demo must not be indexed: fictional example listings showing up in search
            engines as real supply would be worse than publishing nothing. */}
        {DEMO ? <meta name="robots" content="noindex, nofollow" /> : null}
        {/* Disables body scroll when the app uses ScrollView; without it there are two scrolls. */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
