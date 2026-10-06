#!/usr/bin/env node
/**
 * Generates `content.generated.ts` from the markdown in `docs/legal/` (the source markdown, which
 * names the operator, is not part of this public copy; the generated file keeps its placeholders).
 *
 * Why generate instead of importing the markdown at runtime: the Expo build cannot depend on
 * files outside the package, and a markdown parser on the client would be dead weight in the
 * bundle. The result is committed; `pnpm legal:check` fails if it falls behind the markdown.
 *
 * ## The hard rule
 *
 * No document may be published with unresolved markers, and every identity placeholder must be
 * replaced before any publication. The texts never name a real operator: identity is written as
 * neutral placeholders (`<Operator name>`, `[KvK-nummer]`, `[adres]`, `[email]`, `[datum]`)
 * that whoever runs the service fills in.
 *
 * This is enforced in two places, on purpose:
 *
 * 1. **In the generated content.** A document with placeholders or `REVIEW` markers is written
 *    with `status: "blocked"` and **without `blocks`**. Half-baked text never enters the bundle,
 *    so no route can show it, neither by mistake nor through a badly written `if`. The `LegalDoc`
 *    type is a discriminated union: reading `blocks` without checking `status` does not compile.
 * 2. **In the exit code.** If any document stays blocked, the generator prints the report and
 *    exits with code 1. Writing the file and failing is not contradictory: the written file is
 *    always correct; the exit code is the gate that says "this is not publishable yet". That is
 *    why this script is **not** part of `pnpm check`: it is the publication gate.
 *
 * The day the operator fills in name, KvK number, address, e-mail and dates and closes the
 * markers, `pnpm legal:generate` is enough: the documents become `published` and the pages are
 * publishable with no further code change.
 *
 * Usage:
 *   node src/lib/legal/generate.mjs           writes content.generated.ts (exits 1 if blocked)
 *   node src/lib/legal/generate.mjs --check   does not write; fails if stale or blocked
 *
 * It only rewrites when the content changes, and runs biome on the result, so `pnpm check`
 * (which runs `biome check .` without `--write`) never goes red because of a generation.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../../..");
const LEGAL_DIR = join(REPO, "docs", "legal");
const OUT = join(HERE, "content.generated.ts");
const BIOME = join(REPO, "node_modules", ".bin", "biome");

/** Which markdown feeds which route. The order is the order in the generated file. */
const DOCS = [
  { kind: "terms", locale: "nl", file: "terms.nl.md" },
  { kind: "terms", locale: "en", file: "terms.en.md" },
  { kind: "privacy", locale: "nl", file: "privacy.nl.md" },
  { kind: "privacy", locale: "en", file: "privacy.en.md" },
  { kind: "disclaimer", locale: "nl", file: "disclaimer.nl.md" },
  { kind: "disclaimer", locale: "en", file: "disclaimer.en.md" },
  { kind: "bot", locale: "nl", file: "bot-page.nl.md" },
  { kind: "bot", locale: "en", file: "bot-page.en.md" },
];

/**
 * Unfilled placeholder: `[anything]` that is not a markdown link `[text](url)`.
 * Deliberately broad: any loose pair of square brackets blocks. A false positive costs one
 * rewritten sentence in the markdown; a false negative publishes `[KvK-nummer]` to a user.
 */
const PLACEHOLDER = /\[([^\]\n]{1,80})\](?!\()/g;
/**
 * Neutral identity placeholder in angle brackets, e.g. `<Operator name>`. It starts with a
 * capital letter so lowercase HTML such as `<br>` and comments (`<!--`) never match.
 */
const ANGLE_PLACEHOLDER = /<([A-Z][^<>\n]{0,79})>/g;
const REVIEW_MARKER = /<!--\s*REVIEW\b/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

// ---------------------------------------------------------------- markdown → blocks

/** Merges adjacent spans with the same formatting, so the bundle carries no noise. */
function mergeSpans(spans) {
  const out = [];
  for (const s of spans) {
    if (!s.text) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.bold === s.bold &&
      prev.italic === s.italic &&
      prev.code === s.code &&
      prev.href === s.href
    ) {
      prev.text += s.text;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/**
 * Each call creates its own regex: `parseInline` is recursive and a shared `/…/g` literal would
 * carry the `lastIndex` of an inner call into the outer one.
 *
 * Emphasis rules match CommonMark where it matters here: the opening delimiter cannot be followed
 * by a space nor the closing one preceded by a space (otherwise "2 * 3 * 4" would turn italic),
 * and `_` only delimits outside a word (otherwise "snake_case_name" would turn italic).
 */
const inlineRe = () =>
  /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*(?!\s)([^\n]+?)(?<!\s)\*\*|\*(?!\s)([^*\n]+?)(?<!\s)\*|(?<![A-Za-z0-9_])_(?!\s)([^_\n]+?)(?<!\s)_(?![A-Za-z0-9_])/g;

/** `**bold**`, `*italic*`, `` `code` `` and `[text](url)`. No nested lists: there are none. */
function parseInline(text, base = {}) {
  const re = inlineRe();
  const spans = [];
  let last = 0;
  let m = re.exec(text);
  while (m !== null) {
    if (m.index > last) spans.push({ ...base, text: text.slice(last, m.index) });
    if (m[1] !== undefined) spans.push({ ...base, text: m[1], code: true });
    else if (m[2] !== undefined) spans.push(...parseInline(m[2], { ...base, href: m[3] }));
    else if (m[4] !== undefined) spans.push(...parseInline(m[4], { ...base, bold: true }));
    else if (m[5] !== undefined) spans.push(...parseInline(m[5], { ...base, italic: true }));
    else spans.push(...parseInline(m[6], { ...base, italic: true }));
    last = re.lastIndex;
    m = re.exec(text);
  }
  if (last < text.length) spans.push({ ...base, text: text.slice(last) });
  return mergeSpans(spans);
}

const isTableSeparator = (line) => /^\|(\s*:?-{2,}:?\s*\|)+$/.test(line.trim());
const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => parseInline(cell.trim()));

function parseMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").replace(HTML_COMMENT, "").split("\n");
  const blocks = [];
  /** Lines of the paragraph in progress; single line breaks stay single line breaks. */
  let para = [];
  const flush = () => {
    if (!para.length) return;
    blocks.push({ type: "paragraph", spans: parseInline(para.join("\n")) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flush();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, spans: parseInline(heading[2]) });
      continue;
    }
    if (trimmed.startsWith("```")) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    if (trimmed.startsWith(">")) {
      flush();
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        body.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      i--;
      blocks.push({ type: "quote", spans: parseInline(body.join("\n")) });
      continue;
    }
    if (trimmed.startsWith("|") && isTableSeparator(lines[i + 1] ?? "")) {
      flush();
      const header = splitRow(trimmed);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      i--;
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flush();
      const ordered = numbered !== null;
      const items = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const b = ordered ? /^\d+\.\s+(.*)$/.exec(t) : /^[-*+]\s+(.*)$/.exec(t);
        if (!b) break;
        items.push(parseInline(b[1]));
        i++;
      }
      i--;
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

/**
 * Editorial note: an italic-only paragraph right after the `# H1` and before the first `---` is
 * an instruction for us ("In-app disclaimer, te tonen bij aanmelden", "Public page, to be
 * published at …"), not text for the user. It is dropped. The "This is a translation of the
 * Dutch text" notice is a blockquote (`>`) and stays, because that one is for the reader.
 */
function dropEditorialNote(blocks) {
  const firstRule = blocks.findIndex((b) => b.type === "rule");
  const limit = firstRule === -1 ? blocks.length : firstRule;
  const at = blocks.findIndex(
    (b, idx) =>
      idx > 0 &&
      idx < limit &&
      b.type === "paragraph" &&
      b.spans.length > 0 &&
      b.spans.every((s) => s.italic === true && s.href === undefined),
  );
  return at === -1 ? blocks : blocks.filter((_, idx) => idx !== at);
}

/** Strips `---` at the start and end and collapses consecutive rules: only those separating text remain. */
function trimRules(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "rule" && (out.length === 0 || out[out.length - 1].type === "rule")) continue;
    out.push(b);
  }
  while (out.length && out[out.length - 1].type === "rule") out.pop();
  return out;
}

// ---------------------------------------------------------------- analysis + writing

/** True when the text still contains any unfilled placeholder of either kind. */
function hasPlaceholder(text) {
  PLACEHOLDER.lastIndex = 0;
  ANGLE_PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text) || ANGLE_PLACEHOLDER.test(text);
}

function blockersOf(md) {
  const withoutComments = md.replace(HTML_COMMENT, "");
  const counts = new Map();
  for (const m of withoutComments.matchAll(PLACEHOLDER)) {
    const token = `[${m[1]}]`;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  for (const m of withoutComments.matchAll(ANGLE_PLACEHOLDER)) {
    const token = `<${m[1]}>`;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const blockers = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([token, occurrences]) => ({ kind: "placeholder", token, occurrences }));
  const reviews = [...md.matchAll(REVIEW_MARKER)].length;
  if (reviews > 0) blockers.push({ kind: "review", occurrences: reviews });
  return blockers;
}

function buildDoc({ kind, locale, file }) {
  const path = join(LEGAL_DIR, file);
  const md = readFileSync(path, "utf8");
  const sourceHash = createHash("sha256").update(md).digest("hex").slice(0, 16);
  const blocks = dropEditorialNote(parseMarkdown(md));
  const h1 = blocks.find((b) => b.type === "heading" && b.level === 1);
  if (!h1) throw new Error(`${file}: no "# title" on the first line`);
  const title = h1.spans.map((s) => s.text).join("");
  if (hasPlaceholder(title))
    throw new Error(`${file}: the title has an unfilled placeholder ("${title}")`);
  const base = { kind, locale, source: `docs/legal/${file}`, sourceHash, title };
  const blockers = blockersOf(md);
  return blockers.length
    ? { ...base, status: "blocked", blockers }
    : { ...base, status: "published", blocks: trimRules(blocks.filter((b) => b !== h1)) };
}

const HEADER = `// AUTO-GENERATED by \`pnpm legal:generate\` (src/lib/legal/generate.mjs). Do not edit by hand.
// Source of truth: docs/legal/*.md. Documents with unresolved placeholders or REVIEW markers
// come out of here as \`status: "blocked"\` and WITHOUT text; see generate.mjs and types.ts.

import type { LegalContent } from "./types";

export const LEGAL_CONTENT: LegalContent = `;

const contentHash = (docs) =>
  createHash("sha256").update(JSON.stringify(docs)).digest("hex").slice(0, 16);

function render(docs) {
  const body = JSON.stringify(
    { generatedAt: new Date().toISOString(), contentHash: contentHash(docs), docs },
    null,
    2,
  );
  return `${HEADER}${body};\n`;
}

/**
 * The `contentHash` in the generated file, or null if the file does not exist. Read by regex
 * rather than text comparison because the formatter rewrites the file after generation (unquotes
 * keys, joins short lines); the hash is the only part that has to survive that.
 */
function currentHash() {
  try {
    return /["']?contentHash["']?\s*:\s*"([0-9a-f]+)"/.exec(readFileSync(OUT, "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Formats the generated file with the repository's biome. Without this, `pnpm check` (which runs
 * `biome check .` without `--write`) would fail after every generation.
 */
function format(file) {
  try {
    execFileSync(BIOME, ["check", "--write", "--log-level=error", file], { stdio: "inherit" });
  } catch {
    console.warn(`warning: biome did not format ${file}. Run \`pnpm lint:fix\`.`);
  }
}

function report(docs) {
  const blocked = docs.filter((d) => d.status === "blocked");
  for (const d of docs) {
    if (d.status === "published") {
      console.log(`  ok       ${d.source}`);
      continue;
    }
    const why = d.blockers
      .map((b) =>
        b.kind === "review" ? `REVIEW ×${b.occurrences}` : `${b.token} ×${b.occurrences}`,
      )
      .join(", ");
    console.log(`  BLOCKED  ${d.source} — ${why}`);
  }
  return blocked;
}

function main() {
  const check = process.argv.includes("--check");
  const docs = DOCS.map(buildDoc);

  console.log(check ? "legal:check" : "legal:generate");
  const blocked = report(docs);

  const fresh = currentHash() === contentHash(docs);
  if (check) {
    if (!fresh) {
      console.error("\ncontent.generated.ts is stale. Run `pnpm legal:generate`.");
      process.exit(1);
    }
    console.log("\ncontent.generated.ts is up to date with docs/legal/.");
  } else if (fresh) {
    // Nothing changed. Do not rewrite, so biome's formatting is not undone and the diff stays clean.
    console.log(`\n${OUT} is already up to date`);
  } else {
    writeFileSync(OUT, render(docs));
    format(OUT);
    console.log(`\nwrote ${OUT}`);
  }

  if (blocked.length) {
    console.error(
      `\n${blocked.length} of ${docs.length} documents are NOT publishable.\n` +
        "The routes show 'not published yet' and carry no text in the bundle.\n" +
        "To unblock: replace every identity placeholder (<Operator name>, [KvK-nummer], [adres],\n" +
        "[email], [datum]), close the REVIEW markers and run `pnpm legal:generate` again.",
    );
    process.exit(1);
  }
  console.log("\nall documents are publishable.");
}

// Exported for the parser sanity tests; only runs when invoked as a script.
export { blockersOf, dropEditorialNote, hasPlaceholder, parseInline, parseMarkdown, trimRules };

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
