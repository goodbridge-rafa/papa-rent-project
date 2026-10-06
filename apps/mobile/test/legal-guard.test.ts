import { describe, expect, it } from "vitest";
import { blockersOf, hasPlaceholder } from "../src/lib/legal/generate.mjs";

describe("legal text guard", () => {
  it("blocks the neutral operator placeholder and bracket placeholders", () => {
    const md = "# Terms\n\n<Operator name>, KvK [KvK-nummer], [adres].\n";
    const tokens = blockersOf(md).map((b: { token?: string }) => b.token);
    expect(tokens).toEqual(expect.arrayContaining(["<Operator name>", "[KvK-nummer]", "[adres]"]));
  });

  it("blocks open REVIEW markers", () => {
    expect(blockersOf("# T\n\n<!-- REVIEW: check this -->\ntext\n")).toEqual([
      { kind: "review", occurrences: 1 },
    ]);
  });

  it("lets finished text through: links, lowercase HTML and comments are not placeholders", () => {
    const md =
      "# Terms\n\nSee [the privacy policy](https://example.com/privacy).<br>\n<!-- note -->\n";
    expect(blockersOf(md)).toEqual([]);
    expect(hasPlaceholder("Terms of Use")).toBe(false);
    expect(hasPlaceholder("Terms of <Operator name>")).toBe(true);
  });
});
