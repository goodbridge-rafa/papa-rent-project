import { config } from "@/lib/config";
import { LEGAL_CONTENT } from "./content.generated";
import type { LegalContent, LegalDoc, LegalDocKind, LegalLocale } from "./types";

export { LEGAL_CONTENT } from "./content.generated";
export type { InlineSpan, LegalBlock, LegalDoc, LegalDocKind, LegalLocale } from "./types";

/** Each document's route. The same on the static site and in the app (expo-router). */
export const LEGAL_ROUTE: Record<LegalDocKind, `/${string}`> = {
  terms: "/terms",
  privacy: "/privacy",
  disclaimer: "/disclaimer",
  bot: "/bot",
};

/**
 * Paths the texts themselves use to refer to each other. The NL terms are published at
 * `/voorwaarden` and the disclaimer links there. Here a path is just a path: the language is
 * chosen by preference or by `?lang=`, not by the URL.
 */
const PATH_TO_KIND: Record<string, LegalDocKind> = {
  "/terms": "terms",
  "/voorwaarden": "terms",
  "/privacy": "privacy",
  "/privacyverklaring": "privacy",
  "/disclaimer": "disclaimer",
  "/bot": "bot",
};

/** Our own hosts: the configured web URL (`EXPO_PUBLIC_WEB_URL`) plus its `www.`/`app.` variants. */
const OWN_HOSTS = (() => {
  const host = new URL(config.webUrl).hostname.replace(/^(www|app)\./, "");
  return [host, `www.${host}`, `app.${host}`];
})();

export function legalContent(): LegalContent {
  return LEGAL_CONTENT;
}

/**
 * The requested document. `null` when the generator does not know that combination: the route
 * treats it as unavailable, just like a blocked document. It never silently falls back to another
 * language: a legal text in the wrong language is worse than a clear notice.
 */
export function legalDoc(kind: LegalDocKind, locale: LegalLocale): LegalDoc | null {
  return LEGAL_CONTENT.docs.find((d) => d.kind === kind && d.locale === locale) ?? null;
}

/** Is there a publishable translation of this document? Used to offer the other language. */
export function isPublishedIn(kind: LegalDocKind, locale: LegalLocale): boolean {
  return legalDoc(kind, locale)?.status === "published";
}

export type LegalHref =
  /** Link to another of our legal texts: navigates inside the app, does not open the browser. */
  { target: "legal"; kind: LegalDocKind } | { target: "external"; url: string };

/** A `https://<our host>/voorwaarden` inside the text is in-app navigation, not a trip to the browser. */
export function resolveLegalHref(href: string): LegalHref {
  const direct = PATH_TO_KIND[href.replace(/\/+$/, "") || "/"];
  if (href.startsWith("/") && direct) return { target: "legal", kind: direct };
  try {
    const u = new URL(href);
    if (OWN_HOSTS.includes(u.hostname)) {
      const kind = PATH_TO_KIND[u.pathname.replace(/\/+$/, "") || "/"];
      if (kind) return { target: "legal", kind };
    }
  } catch {
    // relative or malformed href: treated as external, the caller decides what to do.
  }
  return { target: "external", url: href };
}
