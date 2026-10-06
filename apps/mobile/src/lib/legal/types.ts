/**
 * Contract of the legal texts generated from `docs/legal/*.md`.
 *
 * Hard rule: no document may be published with unresolved `<!-- REVIEW: -->` markers or with
 * unfilled identity placeholders (`<Operator name>`, `[KvK-nummer]`, `[adres]`, `[email]`,
 * `[datum]`…).
 *
 * The rule is enforced by the **type**, not by a runtime check: only `LegalDocPublished` has
 * `blocks`. A blocked document carries no text at all (it never even reaches the bundle), so a
 * route cannot show half-baked text, not even by mistake. Once the operator fills in the
 * identity and closes the markers, `pnpm legal:generate` classifies the document as `published`
 * again and the pages become publishable without changing code.
 */

export type LegalDocKind = "terms" | "privacy" | "disclaimer" | "bot";
export type LegalLocale = "nl" | "en";

/** A piece of text with its inline formatting already resolved by the generator. */
export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Link target, when the span is part of a `[text](url)`. */
  href?: string;
}

export type LegalBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; spans: InlineSpan[] }
  | { type: "paragraph"; spans: InlineSpan[] }
  | { type: "list"; ordered: boolean; items: InlineSpan[][] }
  | { type: "table"; header: InlineSpan[][]; rows: InlineSpan[][][] }
  | { type: "quote"; spans: InlineSpan[] }
  | { type: "code"; text: string }
  | { type: "rule" };

/** What prevents a document from being published. Never contains document text. */
export type LegalBlocker =
  /** Unfilled identity placeholder, e.g. `<Operator name>` or `[KvK-nummer]`. */
  | { kind: "placeholder"; token: string; occurrences: number }
  /** `<!-- REVIEW: … -->` marker still open. */
  | { kind: "review"; occurrences: number };

interface LegalDocBase {
  kind: LegalDocKind;
  locale: LegalLocale;
  /** Repository path of the source markdown, the single source of truth. */
  source: string;
  /** sha256 of the source markdown, so `legal:check` can detect stale generated content. */
  sourceHash: string;
  /** The document's first `# H1`. Safe to show: the generator refuses placeholders in the title. */
  title: string;
}

export interface LegalDocPublished extends LegalDocBase {
  status: "published";
  blocks: LegalBlock[];
}

export interface LegalDocBlocked extends LegalDocBase {
  status: "blocked";
  blockers: LegalBlocker[];
}

export type LegalDoc = LegalDocPublished | LegalDocBlocked;

/** Everything the generator writes to `content.generated.ts`. */
export interface LegalContent {
  /** ISO 8601 timestamp of the generation. */
  generatedAt: string;
  /**
   * sha256 of the `docs` content. This is how `pnpm legal:check` knows whether the generated file
   * still matches the markdown; comparing text would not work, because the formatter rewrites the
   * file after generation.
   */
  contentHash: string;
  docs: LegalDoc[];
}
