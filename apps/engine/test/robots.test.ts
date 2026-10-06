import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_USER_AGENT, loadConfig } from "../src/config";
import { isAllowed, parseRobots, productToken } from "../src/robots";

describe("robots", () => {
  const ua = "PapaRentBot/0.1 (+https://example.com/bot)";
  it("applies the * group with wildcards and allow-override", () => {
    const r = parseRobots(
      "User-agent: *\nDisallow: */contact/*\nDisallow: /private\nAllow: /private/open\n",
      ua,
    );
    expect(isAllowed(r, "/aanbod/x")).toBe(true);
    expect(isAllowed(r, "/nl/contact/form")).toBe(false);
    expect(isAllowed(r, "/private/x")).toBe(false);
    expect(isAllowed(r, "/private/open/1")).toBe(true);
  });
  it("prefers our own agent group", () => {
    const r = parseRobots(
      "User-agent: *\nDisallow: /\n\nUser-agent: PapaRentBot\nDisallow: /admin\n",
      ua,
    );
    expect(isAllowed(r, "/aanbod")).toBe(true);
    expect(isAllowed(r, "/admin/x")).toBe(false);
  });
  it("ignores invalid path patterns but honours leading wildcards (TYPO3 template)", () => {
    const r = parseRobots(
      "User-agent: *\nDisallow: /typo3/*\nDisallow: *.bak\nDisallow: foo\nDisallow: *\n",
      ua,
    );
    expect(r.disallow).toEqual(["/typo3/*", "*.bak", "*"]);
    expect(isAllowed(r, "/portal/object/frontend/getallobjects/format/json")).toBe(false);
    const r2 = parseRobots("User-agent: *\nDisallow: /typo3/*\nDisallow: *.bak\n", ua);
    expect(isAllowed(r2, "/portal/object/frontend/getallobjects/format/json")).toBe(true);
    expect(isAllowed(r2, "/backup/db.bak")).toBe(false);
  });
  it("treats 'Ga weg.' as malformed, not as a rule, and empty as allow-all", () => {
    expect(parseRobots("Ga weg.", ua)).toMatchObject({ malformed: true, disallow: [] });
    expect(parseRobots("", ua)).toMatchObject({ malformed: false, disallow: [] });
    expect(isAllowed(parseRobots("User-agent: *\nDisallow: /$", ua), "/")).toBe(false);
    expect(isAllowed(parseRobots("User-agent: *\nDisallow: /$", ua), "/x")).toBe(true);
  });
  it("the default User-Agent is an identified bot and robots matches it by product token", () => {
    const cfg = loadConfig({});
    expect(cfg.userAgent).toBe(DEFAULT_BOT_USER_AGENT);
    expect(cfg.userAgent).not.toMatch(/Mozilla|Chrome|Safari/);
    expect(productToken(cfg.userAgent)).toBe("paparentbot");
    const r = parseRobots(
      "User-agent: *\nAllow: /\n\nUser-agent: PapaRentBot\nDisallow: /",
      cfg.userAgent,
    );
    expect(isAllowed(r, "/aanbod")).toBe(false);
    // the token is matched exactly, not as a substring of the full User-Agent
    const other = parseRobots("User-agent: example\nDisallow: /\n", cfg.userAgent);
    expect(isAllowed(other, "/aanbod")).toBe(true);
    expect(loadConfig({ BOT_USER_AGENT: "MyBot/2.0" }).userAgent).toBe("MyBot/2.0");
  });
  it("the default per-host gap is 60 s, overridable by env", () => {
    expect(loadConfig({}).minGapPerHostMs).toBe(60_000);
    expect(loadConfig({ ENGINE_MIN_GAP_PER_HOST_MS: "5000" }).minGapPerHostMs).toBe(5_000);
  });
});
