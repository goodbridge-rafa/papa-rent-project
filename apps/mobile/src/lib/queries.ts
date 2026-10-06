import type { RadarInput } from "@papa/core/shared";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api";
import type {
  FeedListing,
  InboxItem,
  ListingDetail,
  Me,
  Page,
  Radar,
  RadarEstimate,
  RadarEstimateInput,
} from "./types";

export const keys = {
  me: ["me"] as const,
  radars: ["radars"] as const,
  feed: (radarId: string | "all") => ["feed", radarId] as const,
  listing: (id: number) => ["listing", id] as const,
  inbox: ["inbox"] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api<Me>("/v1/me") });
}

export function useRadars() {
  return useQuery({
    queryKey: keys.radars,
    queryFn: async () => (await api<{ radars: Radar[] }>("/v1/radars")).radars,
  });
}

/**
 * The estimate validates a whole `RadarInput`, but the name is not part of any count. We send a
 * fixed name so typing the radar name in step 3 does not fire a new request.
 */
const ESTIMATE_NAME = "estimate";

/** Holds the value until it has been still for `ms`. Identity is the serialized key, not the reference. */
function useDebounced(value: string | null, ms: number): string | null {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    if (value === null) {
      setHeld(null);
      return;
    }
    const id = setTimeout(() => setHeld(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return held;
}

/**
 * "≈ N woningen per week" while the radar is being built (ux-flows §3).
 *
 * `input` set to `null` means "not enough area to ask yet": the query stays idle. The request only
 * goes out once the draft has been still for `debounceMs`, and the previous answer stays on screen
 * (`keepPreviousData`) until the new one arrives, so the number does not flicker on every keystroke.
 */
export function useRadarEstimate(input: RadarEstimateInput | null, debounceMs = 500) {
  const debounced = useDebounced(input === null ? null : JSON.stringify(input), debounceMs);
  return useQuery({
    queryKey: ["radar-estimate", debounced] as const,
    queryFn: () => {
      if (debounced === null) throw new Error("no radar to estimate");
      const body = JSON.parse(debounced) as RadarEstimateInput;
      return api<RadarEstimate>("/v1/radars/estimate", {
        method: "POST",
        json: { ...body, name: ESTIMATE_NAME },
      });
    },
    enabled: debounced !== null,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * Both authenticated feeds (`/v1/feed` and `/v1/radars/:id/feed`) return each listing with the
 * "past bij jou" verdict (`fit`) already attached. Neither accepts query filters (only `limit`
 * and `cursor`), so the screen's quick-filter chips filter what is already loaded.
 */
export function useFeed(radarId: string | "all") {
  return useInfiniteQuery({
    queryKey: keys.feed(radarId),
    queryFn: ({ pageParam }) =>
      api<Page<FeedListing>>(
        `${radarId === "all" ? "/v1/feed" : `/v1/radars/${radarId}/feed`}?limit=30${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 60_000,
  });
}

/** Detail: the listing and, with a session, the full eligibility verdict (`fit`). */
export function useListing(id: number) {
  return useQuery({
    queryKey: keys.listing(id),
    queryFn: () => api<ListingDetail>(`/v1/listings/${id}`),
    enabled: Number.isFinite(id),
  });
}

export function useInbox() {
  return useInfiniteQuery({
    queryKey: keys.inbox,
    queryFn: ({ pageParam }) =>
      api<{ notifications: InboxItem[]; nextCursor: number | null }>(
        `/v1/notifications?limit=30${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useRadarMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.radars });
    void qc.invalidateQueries({ queryKey: ["feed"] });
    void qc.invalidateQueries({ queryKey: keys.me });
  };
  const create = useMutation({
    mutationFn: (input: RadarInput) =>
      api<{ radar: Radar }>("/v1/radars", { method: "POST", json: input }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<RadarInput> }) =>
      api<{ radar: Radar }>(`/v1/radars/${id}`, { method: "PATCH", json: patch }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/v1/radars/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export function useProfileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Me["user"]>) =>
      api<{ user: Me["user"] }>("/v1/me", { method: "PATCH", json: patch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function registerDevice(
  expoPushToken: string,
  platform: "ios" | "android" | "web",
  locale?: string,
) {
  return api("/v1/devices", { method: "POST", json: { expoPushToken, platform, locale } });
}

export function markOpened(notificationId: number) {
  return api<void>(`/v1/notifications/${notificationId}/open`, { method: "POST" });
}

export function exportAccount() {
  return api<unknown>("/v1/account/export");
}

export function deleteAccount() {
  return api<void>("/v1/account", { method: "DELETE" });
}
