import { PROVINCES, searchMunicipalities } from "@papa/core/shared";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { space, useTheme } from "@/lib/theme";
import { Chip } from "./Chip";
import { Text } from "./Text";
import { TextField } from "./TextField";

const POPULAR = [
  "Amsterdam",
  "Rotterdam",
  "Utrecht",
  "Den Haag",
  "Eindhoven",
  "Groningen",
  "Tilburg",
  "Almere",
  "Breda",
  "Nijmegen",
];

export function MunicipalityPicker({
  municipalities,
  provinces,
  onChange,
}: {
  municipalities: string[];
  provinces: string[];
  onChange: (m: string[], p: string[]) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [q, setQ] = useState("");
  const results = useMemo(() => searchMunicipalities(q, 8), [q]);
  const toggleM = (name: string) =>
    onChange(
      municipalities.includes(name)
        ? municipalities.filter((x) => x !== name)
        : [...municipalities, name],
      provinces,
    );
  const toggleP = (name: string) =>
    onChange(
      municipalities,
      provinces.includes(name) ? provinces.filter((x) => x !== name) : [...provinces, name],
    );
  return (
    <View style={{ gap: space.md }}>
      <TextField
        placeholder={tr("radar.search")}
        value={q}
        onChangeText={setQ}
        autoCorrect={false}
        autoCapitalize="words"
        accessibilityLabel={tr("radar.search")}
      />
      {results.length ? (
        <View
          style={{
            backgroundColor: t.surface,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: t.border,
          }}
        >
          {results.map((m) => (
            <Pressable
              key={m.code}
              onPress={() => {
                toggleM(m.name);
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
      {municipalities.length || provinces.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {provinces.map((p) => (
            <Chip
              key={`p:${p}`}
              label={`${p} (${tr("radar.provinces").toLowerCase()})`}
              selected
              onPress={() => toggleP(p)}
            />
          ))}
          {municipalities.map((m) => (
            <Chip key={m} label={m} selected onPress={() => toggleM(m)} />
          ))}
        </View>
      ) : null}
      <Text variant="caption" muted>
        {tr("radar.popular")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {POPULAR.filter((m) => !municipalities.includes(m)).map((m) => (
          <Chip key={m} label={m} small onPress={() => toggleM(m)} />
        ))}
      </View>
      <Text variant="caption" muted>
        {tr("radar.provinces")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {PROVINCES.map((p) => (
          <Chip
            key={p}
            label={p}
            small
            selected={provinces.includes(p)}
            onPress={() => toggleP(p)}
          />
        ))}
      </View>
    </View>
  );
}
