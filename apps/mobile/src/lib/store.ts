import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AppLocale } from "./i18n";

interface Prefs {
  locale: AppLocale | null;
  appliedListingIds: number[];
  registeredPortals: string[];
  pushPrompted: boolean;
  /**
   * "Verberg wat niet bij mij past" (eligibility.md §5). Starts **off**: we never hide supply
   * without an explicit request, because missing the right home costs more than seeing one extra.
   */
  hideNoFit: boolean;
  /** ISO time the feed was last opened; feeds the "Terwijl je weg was" block (ux-flows §2). */
  feedSeenAt: string | null;
  /** ISO time the complete-your-profile prompt was last dismissed (ux-flows §10: at most 1×/week). */
  profileNudgeDismissedAt: string | null;
  setLocale(locale: AppLocale): void;
  markApplied(id: number, applied: boolean): void;
  setRegistered(slug: string, value: boolean): void;
  setPushPrompted(): void;
  setHideNoFit(value: boolean): void;
  markFeedSeen(at: string): void;
  dismissProfileNudge(at: string): void;
}

/** Local preferences (this device only): language, "already applied", "already registered at the portal". Never sent to the server. */
export const usePrefs = create<Prefs>()(
  persist(
    (set, get) => ({
      locale: null,
      appliedListingIds: [],
      registeredPortals: [],
      pushPrompted: false,
      hideNoFit: false,
      feedSeenAt: null,
      profileNudgeDismissedAt: null,
      setLocale: (locale) => set({ locale }),
      markApplied: (id, applied) =>
        set({
          appliedListingIds: applied
            ? [...new Set([...get().appliedListingIds, id])]
            : get().appliedListingIds.filter((x) => x !== id),
        }),
      setRegistered: (slug, value) =>
        set({
          registeredPortals: value
            ? [...new Set([...get().registeredPortals, slug])]
            : get().registeredPortals.filter((x) => x !== slug),
        }),
      setPushPrompted: () => set({ pushPrompted: true }),
      setHideNoFit: (hideNoFit) => set({ hideNoFit }),
      markFeedSeen: (feedSeenAt) => set({ feedSeenAt }),
      dismissProfileNudge: (profileNudgeDismissedAt) => set({ profileNudgeDismissedAt }),
    }),
    { name: "paparent-prefs", storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/**
 * `true` once the stored state has been read from disk. AsyncStorage is asynchronous, so the first
 * render sees the defaults; whoever needs to tell "never happened" from "not loaded yet" (the
 * "Terwijl je weg was" block) has to wait for this.
 */
export function usePrefsHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => usePrefs.persist.hasHydrated());
  useEffect(() => {
    const unsubscribe = usePrefs.persist.onFinishHydration(() => setHydrated(true));
    if (usePrefs.persist.hasHydrated()) setHydrated(true);
    return unsubscribe;
  }, []);
  return hydrated;
}
