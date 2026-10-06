import { getRule, MUNICIPALITIES, type RadarInput, searchMunicipalities } from "@papa/core/shared";
import * as Location from "expo-location";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, Switch, View } from "react-native";
import { config } from "@/lib/config";
import { euro } from "@/lib/format";
import { useRadarEstimate } from "@/lib/queries";
import { radius, space, useTheme } from "@/lib/theme";
import type { RadarEstimateInput, RadarSuggestion } from "@/lib/types";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { MapThumb } from "./MapThumb";
import { MunicipalityPicker } from "./MunicipalityPicker";
import { Text } from "./Text";
import { TextField } from "./TextField";

const LABELS = [
  "senioren",
  "jongeren",
  "student",
  "nultreden",
  "nieuwbouw",
  "grote_gezinnen",
] as const;

/** Radius steps (ux-flows §1, step 6): the same the API uses in its widening suggestions. */
const RADIUS_STEPS_KM = [5, 10, 25, 50] as const;
const DEFAULT_RADIUS_KM = 10;
/** The same bounds `RadarInput` accepts: a point outside them cannot be saved. */
const NL_BOUNDS = { minLat: 50, maxLat: 54, minLng: 3, maxLng: 8 } as const;
/** ~110 m: more than enough for a 5 km radius, and we never store anyone's front door. */
const CENTER_DECIMALS = 3;

const roundCoord = (n: number) => Math.round(n * 10 ** CENTER_DECIMALS) / 10 ** CENTER_DECIMALS;

const insideNL = (lat: number, lng: number) =>
  lat >= NL_BOUNDS.minLat &&
  lat <= NL_BOUNDS.maxLat &&
  lng >= NL_BOUNDS.minLng &&
  lng <= NL_BOUNDS.maxLng;

/** Name of the municipality nearest the point, just to give the radar centre a human label. */
function nearestMunicipality(lat: number, lng: number): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const shrink = Math.cos((lat * Math.PI) / 180);
  for (const m of MUNICIPALITIES) {
    if (m.lat === null || m.lng === null) continue;
    const dy = m.lat - lat;
    const dx = (m.lng - lng) * shrink;
    const d = dx * dx + dy * dy;
    if (d < bestDistance) {
      bestDistance = d;
      best = m.name;
    }
  }
  return best;
}

const zoomForRadius = (km: number) => (km <= 5 ? 12 : km <= 10 ? 11 : km <= 25 ? 10 : 9);

/** An unanswered location request must not leave the button spinning forever. */
const LOCATE_TIMEOUT_MS = 20_000;

const rejectAfter = <T,>(ms: number): Promise<T> =>
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error("location timeout")), ms);
  });

export type RadarDraft = Omit<RadarInput, "segments"> & { segments: RadarInput["segments"] };

export function defaultDraft(): RadarDraft {
  return {
    name: "",
    segments: ["social", "midden"],
    areaType: "municipalities",
    municipalities: [],
    provinces: [],
    centerLat: null,
    centerLng: null,
    radiusKm: null,
    maxRent: null,
    minBedrooms: null,
    dwellingCategories: [],
    includeLabels: [],
    excludeLabels: [],
    allocationModels: [],
    pushEnabled: true,
    emailMode: "instant",
    quietStart: null,
    quietEnd: null,
    active: true,
  };
}

/** Is the gebied complete enough to save, and to ask for an estimate? */
function areaReady(d: RadarDraft): boolean {
  if (d.areaType === "municipalities") return d.municipalities.length + d.provinces.length > 0;
  if (d.areaType === "radius")
    return d.centerLat !== null && d.centerLng !== null && d.radiusKm !== null;
  return true;
}

/** Only what changes matching: the name and the alerts do not move the estimate. */
function estimateInput(d: RadarDraft): RadarEstimateInput | null {
  if (!areaReady(d)) return null;
  return {
    segments: d.segments,
    areaType: d.areaType,
    municipalities: d.municipalities,
    provinces: d.provinces,
    centerLat: d.centerLat,
    centerLng: d.centerLng,
    radiusKm: d.radiusKm,
    maxRent: d.maxRent,
    minBedrooms: d.minBedrooms,
    dwellingCategories: d.dwellingCategories,
    includeLabels: d.includeLabels,
    excludeLabels: d.excludeLabels,
    allocationModels: d.allocationModels,
  };
}

export function RadarForm({
  initial,
  submitting,
  onSubmit,
  submitLabel,
}: {
  initial?: RadarDraft;
  submitting?: boolean;
  onSubmit: (d: RadarDraft) => void;
  submitLabel?: string;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [d, setD] = useState<RadarDraft>(initial ?? defaultDraft());
  const patch = (p: Partial<RadarDraft>) => setD((x) => ({ ...x, ...p }));
  const social = useMemo(() => getRule("social_rent_cap").value, []);
  const midden = useMemo(() => getRule("midden_rent_cap").value, []);
  const canNext = step === 1 ? areaReady(d) : true;
  const autoName = () => {
    const typed = d.name.trim();
    if (typed) return typed;
    if (d.areaType === "radius" && d.centerLat !== null && d.centerLng !== null) {
      const place = nearestMunicipality(d.centerLat, d.centerLng);
      const km = d.radiusKm ?? DEFAULT_RADIUS_KM;
      return place ? `${km} km · ${place}` : "Radar";
    }
    if (d.areaType === "all") return "Nederland";
    return [...d.municipalities.slice(0, 2), ...d.provinces.slice(0, 1)].join(", ") || "Radar";
  };
  const segSel = (v: "social" | "midden" | "both") =>
    patch({ segments: v === "both" ? ["social", "midden"] : [v] });
  const segVal = d.segments.length === 2 ? "both" : d.segments[0];

  return (
    <View style={{ gap: space.lg }}>
      <Text variant="caption" muted>
        {tr("radar.step", { n: step })}
      </Text>
      {step === 1 ? (
        <>
          <Text variant="h1">{tr("radar.whereTitle")}</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Chip
              label={tr("radar.areaRegions")}
              small
              selected={d.areaType === "municipalities"}
              onPress={() => patch({ areaType: "municipalities" })}
            />
            <Chip
              label={tr("radar.areaNearMe")}
              small
              selected={d.areaType === "radius"}
              onPress={() =>
                patch({ areaType: "radius", radiusKm: d.radiusKm ?? DEFAULT_RADIUS_KM })
              }
            />
            <Chip
              label={tr("radar.areaAll")}
              small
              selected={d.areaType === "all"}
              onPress={() => patch({ areaType: "all" })}
            />
          </View>
          {d.areaType === "municipalities" ? (
            <>
              <Text muted>{tr("radar.whereHelp")}</Text>
              <MunicipalityPicker
                municipalities={d.municipalities}
                provinces={d.provinces}
                onChange={(m, p) => patch({ municipalities: m, provinces: p })}
              />
            </>
          ) : null}
          {d.areaType === "radius" ? <NearMe draft={d} onChange={patch} /> : null}
          {d.areaType === "all" ? <Text muted>{tr("radar.allHelp")}</Text> : null}
        </>
      ) : null}
      {step === 2 ? (
        <>
          <Text variant="h1">{tr("radar.whatTitle")}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Chip
              label={tr("radar.social")}
              selected={segVal === "social"}
              onPress={() => segSel("social")}
            />
            <Chip
              label={tr("radar.midden")}
              selected={segVal === "midden"}
              onPress={() => segSel("midden")}
            />
            <Chip
              label={tr("radar.both")}
              selected={segVal === "both"}
              onPress={() => segSel("both")}
            />
          </View>
          <TextField
            label={tr("radar.maxRent")}
            keyboardType="numeric"
            placeholder={`€ ${euro(midden)}`}
            value={d.maxRent === null ? "" : String(d.maxRent)}
            onChangeText={(v) =>
              patch({ maxRent: v.trim() === "" ? null : Number(v.replace(",", ".")) || null })
            }
          />
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {[700, social, midden].map((v) => (
              <Chip
                key={v}
                label={`€ ${euro(v)}`}
                small
                selected={d.maxRent === v}
                onPress={() => patch({ maxRent: v })}
              />
            ))}
            <Chip
              label={tr("radar.noMax")}
              small
              selected={d.maxRent === null}
              onPress={() => patch({ maxRent: null })}
            />
          </View>
          <Text variant="caption" muted>
            {tr("radar.rentNote", {
              social: euro(social, { decimals: true }),
              midden: euro(midden, { decimals: true }),
            })}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Chip
              label={tr("radar.anyBedrooms")}
              small
              selected={d.minBedrooms === null}
              onPress={() => patch({ minBedrooms: null })}
            />
            {[1, 2, 3, 4].map((n) => (
              <Chip
                key={n}
                label={tr("radar.bedrooms", { n })}
                small
                selected={d.minBedrooms === n}
                onPress={() => patch({ minBedrooms: n })}
              />
            ))}
          </View>
          <Text variant="caption" muted>
            {tr("radar.labels")}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {LABELS.map((lb) => (
              <Chip
                key={lb}
                label={tr(`label.${lb}`)}
                small
                selected={d.includeLabels.includes(lb)}
                onPress={() =>
                  patch({
                    includeLabels: d.includeLabels.includes(lb)
                      ? d.includeLabels.filter((x) => x !== lb)
                      : [...d.includeLabels, lb],
                  })
                }
              />
            ))}
          </View>
        </>
      ) : null}
      {step === 3 ? (
        <>
          <Text variant="h1">{tr("radar.howTitle")}</Text>
          <Row title={tr("radar.push")} sub={tr("radar.pushSub")}>
            <Switch
              value={d.pushEnabled}
              onValueChange={(v) => patch({ pushEnabled: v })}
              trackColor={{ true: t.primary }}
            />
          </Row>
          <Text variant="caption" muted>
            {tr("radar.email")}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {(["instant", "daily", "off"] as const).map((m) => (
              <Chip
                key={m}
                label={tr(`radar.email${m[0]?.toUpperCase()}${m.slice(1)}`)}
                small
                selected={d.emailMode === m}
                onPress={() => patch({ emailMode: m })}
              />
            ))}
          </View>
          <Row
            title={tr("radar.quiet", { from: d.quietStart ?? "23:00", to: d.quietEnd ?? "07:00" })}
            sub={tr("radar.quietSub")}
          >
            <Switch
              value={d.quietStart !== null}
              onValueChange={(v) =>
                patch(
                  v
                    ? { quietStart: "23:00", quietEnd: "07:00" }
                    : { quietStart: null, quietEnd: null },
                )
              }
              trackColor={{ true: t.primary }}
            />
          </Row>
          <TextField
            label={tr("radar.name")}
            value={d.name}
            placeholder={autoName()}
            onChangeText={(v) => patch({ name: v })}
          />
        </>
      ) : null}
      <Estimate draft={d} onApply={patch} />
      <View style={{ flexDirection: "row", gap: space.md }}>
        {step > 1 ? (
          <Button
            kind="secondary"
            title={tr("common.back")}
            onPress={() => setStep((s) => (s === 3 ? 2 : 1))}
            style={{ flex: 1 }}
          />
        ) : null}
        {step < 3 ? (
          <Button
            title={tr("common.next")}
            disabled={!canNext}
            onPress={() => setStep((s) => (s === 1 ? 2 : 3))}
            style={{ flex: 2 }}
          />
        ) : (
          <Button
            title={submitLabel ?? tr("radar.finish")}
            loading={submitting}
            onPress={() => onSubmit({ ...d, name: autoName() })}
            style={{ flex: 2 }}
          />
        )}
      </View>
    </View>
  );
}

type LocationState = "idle" | "asking" | "denied" | "error" | "outside";

/**
 * "Bij mij in de buurt": point + radius (ux-flows §1, step 6).
 *
 * Location permission is requested on the tap, never before. Whoever declines (or is abroad, or
 * has no GPS) picks the centre through the plaats search, which is always visible: no path here
 * ends in a dead end.
 */
function NearMe({
  draft,
  onChange,
}: {
  draft: RadarDraft;
  onChange: (p: Partial<RadarDraft>) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [state, setState] = useState<LocationState>("idle");
  const [q, setQ] = useState("");
  const results = useMemo(
    () =>
      searchMunicipalities(q, 6).flatMap((m) =>
        m.lat === null || m.lng === null
          ? []
          : [{ code: m.code, name: m.name, province: m.province, lat: m.lat, lng: m.lng }],
      ),
    [q],
  );
  const km = draft.radiusKm ?? DEFAULT_RADIUS_KM;
  const place = useMemo(
    () =>
      draft.centerLat === null || draft.centerLng === null
        ? null
        : nearestMunicipality(draft.centerLat, draft.centerLng),
    [draft.centerLat, draft.centerLng],
  );
  const setCenter = (lat: number, lng: number) => {
    onChange({ centerLat: lat, centerLng: lng, radiusKm: draft.radiusKm ?? DEFAULT_RADIUS_KM });
    setState("idle");
  };
  const locate = async () => {
    setState("asking");
    try {
      const permission = await Promise.race([
        Location.requestForegroundPermissionsAsync(),
        rejectAfter<Location.LocationPermissionResponse>(LOCATE_TIMEOUT_MS),
      ]);
      if (!permission.granted) {
        setState("denied");
        return;
      }
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        rejectAfter<Location.LocationObject>(LOCATE_TIMEOUT_MS),
      ]);
      const lat = roundCoord(pos.coords.latitude);
      const lng = roundCoord(pos.coords.longitude);
      if (!insideNL(lat, lng)) {
        setState("outside");
        return;
      }
      setCenter(lat, lng);
    } catch {
      setState("error");
    }
  };
  const problem =
    state === "denied"
      ? tr("radar.locationDenied")
      : state === "outside"
        ? tr("radar.locationOutside")
        : state === "error"
          ? tr("radar.locationError")
          : null;

  return (
    <View style={{ gap: space.md }}>
      <Button
        kind={draft.centerLat === null ? "primary" : "secondary"}
        title={state === "asking" ? tr("radar.locating") : tr("radar.useMyLocation")}
        loading={state === "asking"}
        onPress={() => {
          void locate();
        }}
      />
      <Text variant="caption" muted>
        {tr("radar.locationWhy")}
      </Text>
      {problem ? (
        <Text variant="caption" color={t.warning} accessibilityLiveRegion="polite">
          {problem}
        </Text>
      ) : null}
      <TextField
        placeholder={tr("radar.centerSearch")}
        accessibilityLabel={tr("radar.centerSearch")}
        value={q}
        onChangeText={setQ}
        autoCorrect={false}
        autoCapitalize="words"
      />
      {results.length ? (
        <View
          style={{
            backgroundColor: t.surface,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: t.border,
          }}
        >
          {results.map((m) => (
            <Pressable
              key={m.code}
              accessibilityRole="button"
              onPress={() => {
                setCenter(roundCoord(m.lat), roundCoord(m.lng));
                setQ("");
              }}
              style={{
                paddingHorizontal: space.lg,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: t.border,
              }}
            >
              <Text>{m.name}</Text>
              <Text variant="caption" muted>
                {m.province}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {draft.centerLat !== null && draft.centerLng !== null ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <View style={{ width: 96, height: 96 }}>
            <MapThumb
              lat={draft.centerLat}
              lng={draft.centerLng}
              height={96}
              zoom={zoomForRadius(km)}
            />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="h3">
              {tr("radar.centerAt", { place: place ?? tr("common.unknown") })}
            </Text>
            <Text variant="caption" muted>
              {tr("radar.km", { n: km })}
            </Text>
          </View>
        </View>
      ) : (
        <Text variant="caption" muted>
          {tr("radar.centerMissing")}
        </Text>
      )}
      <Text variant="caption" muted>
        {tr("radar.radiusTitle")}
      </Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {RADIUS_STEPS_KM.map((n) => (
          <Chip
            key={n}
            label={tr("radar.km", { n })}
            small
            selected={draft.radiusKm === n}
            onPress={() => onChange({ radiusKm: n })}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Live "≈ N woningen per week" count and the two warnings that depend on it: zero results and
 * alert fatigue (ux-flows §3). The suggestion buttons apply exactly the patch the API measured,
 * so the number next to the button is that of the radar it creates.
 */
function Estimate({
  draft,
  onApply,
}: {
  draft: RadarDraft;
  onApply: (p: Partial<RadarDraft>) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const input = useMemo(() => estimateInput(draft), [draft]);
  const estimate = useRadarEstimate(input);
  const box = {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  } as const;

  if (input === null) return null;
  if (estimate.isError)
    return (
      <View style={box}>
        <Text variant="caption" muted>
          {/* In the demo this is not a passing glitch: there is no server at all. Saying
              "it is not working" would invite retrying forever. */}
          {tr(config.demo ? "radar.estimateDemo" : "radar.estimateFailed")}
        </Text>
      </View>
    );

  const data = estimate.data;
  if (!data)
    return (
      <View
        style={[box, { flexDirection: "row", alignItems: "center" }]}
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator color={t.muted} />
        <Text muted>{tr("radar.estimateLoading")}</Text>
      </View>
    );

  /** Whole days: the basis of the rate, not a precision we do not have. */
  const observedDays =
    data.observedDays === null ? null : Math.max(1, Math.round(data.observedDays));
  const applied = (p: Partial<RadarDraft>) =>
    Object.entries(p).every(
      ([k, v]) => JSON.stringify(draft[k as keyof RadarDraft]) === JSON.stringify(v),
    );
  const label = (s: RadarSuggestion) => {
    const base =
      s.code === "widen_radius"
        ? tr("radar.suggestWidenRadius", { km: s.patch.radiusKm ?? DEFAULT_RADIUS_KM })
        : s.code === "raise_max_rent"
          ? tr("radar.suggestRaiseRent", { v: euro(s.patch.maxRent ?? null) })
          : s.code === "add_segment"
            ? tr("radar.suggestAddSegment")
            : tr("radar.suggestDailyDigest");
    return s.perWeek === null || s.perWeek === undefined
      ? base
      : `${base} · ${tr("radar.suggestResult", { n: s.perWeek })}`;
  };

  return (
    <View style={box} accessibilityLiveRegion="polite">
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          opacity: estimate.isFetching ? 0.6 : 1,
        }}
      >
        {data.level === "unknown" ? (
          <Text muted style={{ flex: 1 }}>
            {tr("radar.estimateUnknown")}
          </Text>
        ) : data.level === "none" ? (
          <Text variant="h3" color={t.warning} style={{ flex: 1 }}>
            {tr("radar.estimateNone")}
          </Text>
        ) : (
          <Text variant="h3" style={{ flex: 1 }}>
            {tr("radar.estimate", { n: data.perWeek })}
          </Text>
        )}
        {estimate.isFetching ? <ActivityIndicator color={t.muted} /> : null}
      </View>
      {data.level === "none" ? (
        <Text variant="caption" muted>
          {tr("radar.estimateNoneHelp")}
        </Text>
      ) : null}
      {data.level === "high" ? (
        <Text variant="caption" color={t.warning}>
          {tr("radar.estimateHigh")}
        </Text>
      ) : null}
      {data.level !== "unknown" && observedDays !== null ? (
        <Text variant="caption" muted>
          {observedDays === 1
            ? tr("radar.estimateBasisDay")
            : tr("radar.estimateBasisDays", { n: observedDays })}
        </Text>
      ) : null}
      {data.suggestions.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {data.suggestions.map((s) => (
            <Chip
              key={s.code}
              label={label(s)}
              small
              selected={applied(s.patch)}
              onPress={() => onApply(s.patch)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Row({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text>{title}</Text>
        {sub ? (
          <Text variant="caption" muted>
            {sub}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}
