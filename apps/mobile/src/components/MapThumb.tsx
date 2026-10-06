import { Image } from "expo-image";
import { View } from "react-native";
import { pdokTile } from "@/lib/format";
import { palette, radius, useTheme } from "@/lib/theme";

/**
 * Map thumbnail with a PDOK tile (BRT achtergrondkaart, open data, CC-BY Kadaster) and a pin.
 * Replaces the portal's photo, which we do not reproduce (source policy). No lat/lng: neutral block.
 */
export function MapThumb({
  lat,
  lng,
  height = 140,
  zoom = 15,
}: {
  lat: number | null;
  lng: number | null;
  height?: number;
  zoom?: number;
}) {
  const t = useTheme();
  if (lat === null || lng === null) {
    return <View style={{ height, borderRadius: radius.md, backgroundColor: t.surface2 }} />;
  }
  const tile = pdokTile(lat, lng, zoom);
  return (
    <View
      style={{ height, borderRadius: radius.md, overflow: "hidden", backgroundColor: t.surface2 }}
    >
      <Image
        source={{ uri: tile.url }}
        style={{
          position: "absolute",
          width: 256,
          height: 256,
          left: height / 2 - 256 * tile.px,
          top: height / 2 - 256 * tile.py,
        }}
        contentFit="cover"
        transition={150}
      />
      <View
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          marginLeft: -9,
          marginTop: -18,
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: palette.orange500,
          borderWidth: 3,
          borderColor: "#fff",
        }}
      />
    </View>
  );
}
