import { View } from "react-native";
import { space } from "@/lib/theme";
import { Button } from "./Button";
import { Text } from "./Text";

export function EmptyState({
  title,
  body,
  cta,
  onPress,
}: {
  title: string;
  body?: string;
  cta?: string;
  onPress?: () => void;
}) {
  return (
    <View style={{ alignItems: "center", padding: space.xxl, gap: space.md }}>
      <Text variant="h3" style={{ textAlign: "center" }}>
        {title}
      </Text>
      {body ? (
        <Text variant="body" muted style={{ textAlign: "center" }}>
          {body}
        </Text>
      ) : null}
      {cta && onPress ? (
        <Button title={cta} onPress={onPress} style={{ marginTop: space.sm }} />
      ) : null}
    </View>
  );
}
