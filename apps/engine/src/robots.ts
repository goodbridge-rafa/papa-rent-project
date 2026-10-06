/**
 * Minimal, conservative robots.txt (source policy): if the `*` group or our own agent group
 * disallows the path, we do not fetch. Supports `*` and `$` in patterns. No crawl-delay heuristics.
 */
export interface RobotsRules {
  disallow: string[];
  allow: string[];
  /** true when the file is not valid robots (e.g. DĀK "Ga weg."): treated as a signal, not a rule. */
  malformed: boolean;
  raw: string;
}

export function parseRobots(text: string, agentToken: string): RobotsRules {
  const groups: Array<{ agents: string[]; allow: string[]; disallow: string[] }> = [];
  let current: { agents: string[]; allow: string[]; disallow: string[] } | null = null;
  let sawDirective = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = (m[1] ?? "").toLowerCase();
    const value = (m[2] ?? "").trim();
    if (key === "user-agent") {
      sawDirective = true;
      if (!current || current.allow.length || current.disallow.length) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "disallow" || key === "allow") && current) {
      sawDirective = true;
      // RFC 9309 §2.2.2: path-pattern starts with "/"; we also accept a leading "*" (wildcard, Google).
      // Other values are invalid lines and ignored (RFC §2.3.1.5, Google "ignores invalid lines").
      if (value && (value.startsWith("/") || value.startsWith("*"))) current[key].push(value);
    }
  }
  const token = productToken(agentToken);
  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && a === token));
  const star = groups.find((g) => g.agents.includes("*"));
  const chosen = mine ?? star;
  return {
    disallow: chosen?.disallow ?? [],
    allow: chosen?.allow ?? [],
    malformed: !sawDirective && text.trim() !== "",
    raw: text,
  };
}

/**
 * Product token of a User-Agent ("PapaRentBot/0.1 (+https://example.com/bot)" → "paparentbot"),
 * matched case-insensitively against `User-agent:` lines (RFC 9309 §2.2.1).
 */
export function productToken(userAgent: string): string {
  return (userAgent.split("/")[0] ?? "").trim().toLowerCase();
}

function patternToRegex(p: string): RegExp {
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped.endsWith("\\$") ? `${escaped.slice(0, -2)}$` : escaped}`);
}

export function isAllowed(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) =>
    list
      .filter((p) => patternToRegex(p).test(path))
      .reduce((a, b) => (b.length > a.length ? b : a), "");
  const d = longest(rules.disallow);
  const a = longest(rules.allow);
  if (!d) return true;
  return a.length >= d.length;
}
