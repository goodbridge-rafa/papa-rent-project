import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserFetcher, toMatcher } from "../src/browser";
import { loadConfig } from "../src/config";
import { Http } from "../src/http";

// Public page whose data only exists after JS runs (the Tier B case).
const PAGE = `<!doctype html><html><head><title>Aanbod</title></head><body>
<button id="cookies" onclick="this.remove()">Accepteren</button>
<ul id="app">loading</ul>
<script>
fetch('/api/items').then(r => r.json()).then(d => {
  document.getElementById('app').innerHTML = d.items.map(i => '<li class="item">' + i.name + '</li>').join('');
});
</script></body></html>`;
const ITEMS = { items: [{ name: "Woning A" }, { name: "Woning B" }] };

const cfg = {
  ...loadConfig({}),
  minGapPerHostMs: 0,
  // in the sandbox Chromium only reaches localhost without a proxy; in production these args do no harm
  browserArgs: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
};
const hasChromium = Boolean(cfg.browserExecutable && existsSync(cfg.browserExecutable));

describe("browser fetcher (render plans)", () => {
  const server = createServer((req, res) => {
    if (req.url === "/api/items") {
      res.writeHead(200, { "content-type": "application/json", "x-test": "1" });
      res.end(JSON.stringify(ITEMS));
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE);
    }
  });
  let base = "";
  const http = new Http(cfg);
  const browser = new BrowserFetcher(cfg, http);

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await browser.close();
    await http.close();
    server.close();
  });

  it("matches capture specs by substring or regex", () => {
    expect(toMatcher("/api/items")("http://x/api/items?x=1")).toBe(true);
    expect(toMatcher("re:/api/it\\w+$")("http://x/api/items")).toBe(true);
    expect(toMatcher("re:/api/it\\w+$")("http://x/api/items?x=1")).toBe(false);
  });

  it.skipIf(!hasChromium)(
    "captures the XHR body the page loads",
    async () => {
      const res = await browser.fetch({
        url: `${base}/aanbod`,
        render: { captureResponse: "/api/items", clicks: ["#cookies", "#does-not-exist"] },
      });
      expect(res.status).toBe(200);
      expect(res.url).toBe(`${base}/api/items`);
      expect(JSON.parse(res.text)).toEqual(ITEMS);
      expect(res.headers["x-test"]).toBe("1");
    },
    60_000,
  );

  it.skipIf(!hasChromium)(
    "returns the rendered HTML after waiting for a selector",
    async () => {
      const res = await browser.fetch({
        url: `${base}/aanbod`,
        render: { waitForSelector: "li.item" },
      });
      expect(res.status).toBe(200);
      expect(res.text).toContain('<li class="item">Woning A</li>');
      expect(res.text).not.toContain("loading");
    },
    60_000,
  );
});
