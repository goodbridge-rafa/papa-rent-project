import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";
import { Text } from "@/components/Text";
import { radius, space, useTheme } from "@/lib/theme";
import { LEGAL_ROUTE, resolveLegalHref } from "./index";
import type { InlineSpan, LegalBlock, LegalDoc } from "./types";

const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

function useOpenHref() {
  const router = useRouter();
  return (href: string) => {
    const target = resolveLegalHref(href);
    if (target.target === "legal") router.push(LEGAL_ROUTE[target.kind]);
    else void WebBrowser.openBrowserAsync(target.url);
  };
}

function Spans({ spans, muted }: { spans: InlineSpan[]; muted?: boolean }) {
  const t = useTheme();
  const open = useOpenHref();
  return (
    <>
      {spans.map((s, i) => (
        <Text
          // The generator produces this list; the order is stable and nothing reorders at runtime.
          // biome-ignore lint/suspicious/noArrayIndexKey: spans have no identity of their own
          key={i}
          muted={muted && !s.href}
          color={s.href ? t.link : undefined}
          onPress={s.href ? () => open(s.href as string) : undefined}
          style={{
            fontFamily: s.code
              ? mono
              : s.bold
                ? "Inter_600SemiBold"
                : s.italic
                  ? "Inter_400Regular"
                  : undefined,
            fontStyle: s.italic ? "italic" : undefined,
            textDecorationLine: s.href ? "underline" : undefined,
          }}
        >
          {s.text}
        </Text>
      ))}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  const t = useTheme();
  switch (block.type) {
    case "heading":
      return (
        <Text
          variant={block.level <= 2 ? "h2" : "h3"}
          style={{ marginTop: block.level <= 2 ? space.md : space.sm }}
          accessibilityRole="header"
        >
          <Spans spans={block.spans} />
        </Text>
      );
    case "paragraph":
      return (
        <Text>
          <Spans spans={block.spans} />
        </Text>
      );
    case "quote":
      return (
        <View
          style={{
            borderLeftWidth: 3,
            borderLeftColor: t.accent,
            paddingLeft: space.md,
            paddingVertical: space.xs,
          }}
        >
          <Text muted>
            <Spans spans={block.spans} muted />
          </Text>
        </View>
      );
    case "list":
      return (
        <View style={{ gap: space.xs }}>
          {block.items.map((item, i) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: generated items, stable order
              key={i}
              style={{ flexDirection: "row", gap: space.sm }}
            >
              <Text muted style={{ minWidth: 18 }}>
                {block.ordered ? `${i + 1}.` : "•"}
              </Text>
              <Text style={{ flex: 1 }}>
                <Spans spans={item} />
              </Text>
            </View>
          ))}
        </View>
      );
    case "table":
      return <Table header={block.header} rows={block.rows} />;
    case "code":
      return (
        <View
          style={{
            backgroundColor: t.surface2,
            borderRadius: radius.sm,
            padding: space.md,
          }}
        >
          <Text style={{ fontFamily: mono, fontSize: 13, lineHeight: 19 }}>{block.text}</Text>
        </View>
      );
    case "rule":
      return <View style={{ height: 1, backgroundColor: t.border, marginVertical: space.sm }} />;
  }
}

/**
 * Tables as columns, not a grid: on a phone a three-column grid is unreadable. Each row becomes a
 * card and each cell carries its column header above it, when there is one (the texts' two-column
 * tables have an empty header on purpose).
 */
function Table({ header, rows }: { header: InlineSpan[][]; rows: InlineSpan[][][] }) {
  const t = useTheme();
  const labels = header.map((cell) =>
    cell
      .map((s) => s.text)
      .join("")
      .trim(),
  );
  return (
    <View style={{ gap: space.sm }}>
      {rows.map((row, r) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: generated rows, stable order
          key={r}
          style={{
            backgroundColor: t.surface,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: radius.sm,
            padding: space.md,
            gap: space.xs,
          }}
        >
          {row.map((cell, c) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: generated cells, stable order
            <View key={c} style={{ gap: 2 }}>
              {labels[c] ? (
                <Text variant="label" muted>
                  {labels[c]}
                </Text>
              ) : null}
              <Text style={c === 0 && !labels[c] ? { fontFamily: "Inter_600SemiBold" } : undefined}>
                <Spans spans={cell} />
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function LegalBlocks({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <View style={{ gap: space.md }}>
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: generated blocks, stable order
        <Block key={i} block={b} />
      ))}
    </View>
  );
}

/**
 * The honest state of a document that cannot be published yet. There is no text to show (the
 * generator did not put it in the bundle), so the page says what it is and what is missing,
 * without inventing anything.
 */
export function LegalNotPublished({ title }: { title: string }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <Text variant="h1">{title}</Text>
      <View
        style={{
          backgroundColor: t.surface2,
          borderRadius: radius.md,
          padding: space.lg,
          gap: space.sm,
        }}
      >
        <Text variant="h3">{tr("legal.notPublishedTitle")}</Text>
        <Text muted>{tr("legal.notPublishedBody")}</Text>
      </View>
    </View>
  );
}

/** A whole legal page: either the text, or the notice that no publishable version exists yet. */
export function LegalDocView({ doc, title }: { doc: LegalDoc | null; title: string }) {
  if (!doc || doc.status === "blocked") return <LegalNotPublished title={doc?.title ?? title} />;
  return (
    <View style={{ gap: space.md }}>
      <Text variant="h1">{doc.title}</Text>
      <LegalBlocks blocks={doc.blocks} />
    </View>
  );
}
