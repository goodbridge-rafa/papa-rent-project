import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import type { LegalLocale } from "./types";

export const OTHER_LOCALE: Record<LegalLocale, LegalLocale> = { nl: "en", en: "nl" };
export const LOCALE_NAME: Record<LegalLocale, string> = { nl: "Nederlands", en: "English" };

const asLocale = (v: unknown): LegalLocale | null =>
  v === "nl" || v === "en" ? v : Array.isArray(v) ? asLocale(v[0]) : null;

/**
 * The language of a legal page: `?lang=nl|en` wins; without it the app preference applies (which
 * already falls back to the device language). So a link to `/privacy?lang=en` in a store listing
 * or an e-mail always opens in English, and whoever arrives without the parameter reads their own.
 */
export function useLegalLocale(): LegalLocale {
  const { lang } = useLocalSearchParams<{ lang?: string | string[] }>();
  const { i18n } = useTranslation();
  return asLocale(lang) ?? (i18n.language === "nl" ? "nl" : "en");
}
