import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { Http } from "../src/http";

/**
 * Visitor-like load (source policy) is enforced here and nowhere else: if `politeWait` stops
 * working, the engine turns into a crawler without anything else in the system noticing. So
 * these tests use a real server and measure arrival times on the server side.
 */

interface Hit {
  url: string;
  method: string;
  at: number;
  headers: Record<string, string>;
}

const GAP_MS = 250;

describe("Http: visitor-like load and conditional GET", () => {
  const hits: Hit[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers))
      headers[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
    const body: Buffer[] = [];
    req.on("data", (c: Buffer) => body.push(c));
    req.on("end", () => {
      hits.push({ url, method: req.method ?? "GET", at: Date.now(), headers });
      if (url === "/gzip") {
        res.writeHead(200, { "content-encoding": "gzip", "content-type": "application/json" });
        res.end(gzipSync(Buffer.from(JSON.stringify({ ok: "gzip" }))));
      } else if (url === "/deflate") {
        res.writeHead(200, { "content-encoding": "deflate" });
        res.end(deflateSync(Buffer.from("deflate ok")));
      } else if (url === "/brotli") {
        res.writeHead(200, { "content-encoding": "br" });
        res.end(brotliCompressSync(Buffer.from("brotli ok")));
      } else if (url === "/lying") {
        // announces gzip but sends plain text: must not break the poll
        res.writeHead(200, { "content-encoding": "gzip" });
        res.end("plain after all");
      } else if (url === "/conditional") {
        if (req.headers["if-none-match"] === '"v1"') {
          res.writeHead(304, { etag: '"v1"' });
          res.end();
        } else {
          res.writeHead(200, { etag: '"v1"', "last-modified": "Wed, 10 Sep 2026 10:00:00 GMT" });
          res.end("fresh body");
        }
      } else if (url === "/echo") {
        res.writeHead(200, { "content-type": "application/json", "X-Multi": "a" });
        res.end(JSON.stringify({ method: req.method, body: Buffer.concat(body).toString("utf8") }));
      } else if (url === "/redirect") {
        res.writeHead(302, { location: "/echo" });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      }
    });
  });

  const cfg = { ...loadConfig({}), minGapPerHostMs: GAP_MS, requestTimeoutMs: 5_000 };
  const http = new Http(cfg);
  let base = "";
  let port = 0;

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await http.close();
    server.close();
  });

  it("waits the minimum gap between two requests to the same host", async () => {
    const t0 = Date.now();
    await http.get({ url: `${base}/a` });
    await http.get({ url: `${base}/b` });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(GAP_MS - 20);
  });

  it("keeps the gap even with concurrent requests to the same host", async () => {
    // the real case: a source's detail queue running next to the feed poll of the same host
    const mark = hits.length;
    await Promise.all([
      http.get({ url: `${base}/c1` }),
      http.get({ url: `${base}/c2` }),
      http.get({ url: `${base}/c3` }),
    ]);
    const times = hits.slice(mark).map((h) => h.at);
    expect(times).toHaveLength(3);
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++)
      expect(times[i] as number).toBeGreaterThanOrEqual((times[i - 1] as number) + GAP_MS - 20);
  });

  it("different hosts do not wait for each other", async () => {
    // use up each host's turn before measuring
    await Promise.all([
      http.get({ url: `${base}/warm` }),
      http.get({ url: `http://localhost:${port}/warm` }),
    ]);
    await new Promise((r) => setTimeout(r, GAP_MS));
    const t0 = Date.now();
    await Promise.all([
      http.get({ url: `${base}/x` }),
      http.get({ url: `http://localhost:${port}/x` }),
    ]);
    expect(Date.now() - t0).toBeLessThan(GAP_MS);
  });

  it("the browser shares the host turn with the HTTP client", async () => {
    await http.get({ url: `${base}/before-turn` });
    const t0 = Date.now();
    // waitTurn is what BrowserFetcher calls before opening the page (`render` plans)
    await http.waitTurn(`127.0.0.1:${port}`);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(GAP_MS - 20);
  });

  it("an explicit per-request gap overrides the configured one", async () => {
    await http.get({ url: `${base}/gap` }, {}, { minGapMs: 0 });
    const t0 = Date.now();
    await http.get({ url: `${base}/gap` }, {}, { minGapMs: 0 });
    expect(Date.now() - t0).toBeLessThan(GAP_MS);
  });

  it("sends ETag/Last-Modified and returns 304 with an empty body", async () => {
    const first = await http.get(
      { url: `${base}/conditional`, conditional: true },
      {},
      {
        minGapMs: 0,
      },
    );
    expect(first.status).toBe(200);
    expect(first.text).toBe("fresh body");
    expect(first.headers.etag).toBe('"v1"');

    const second = await http.get(
      { url: `${base}/conditional`, conditional: true },
      { etag: first.headers.etag ?? null, lastModified: first.headers["last-modified"] ?? null },
      { minGapMs: 0 },
    );
    expect(second.status).toBe(304);
    expect(second.text).toBe("");
    const sent = hits[hits.length - 1] as Hit;
    expect(sent.headers["if-none-match"]).toBe('"v1"');
    expect(sent.headers["if-modified-since"]).toBe("Wed, 10 Sep 2026 10:00:00 GMT");
  });

  it("does not send conditional headers on a POST", async () => {
    const res = await http.get(
      { url: `${base}/echo`, method: "POST", body: '{"q":1}', conditional: true },
      { etag: '"v1"' },
      { minGapMs: 0 },
    );
    expect(JSON.parse(res.text)).toEqual({ method: "POST", body: '{"q":1}' });
    const sent = hits[hits.length - 1] as Hit;
    expect(sent.headers["if-none-match"]).toBeUndefined();
  });

  it("identifies itself and lets the plan override headers", async () => {
    await http.get(
      { url: `${base}/hdr`, headers: { "accept-language": "en", "x-plan": "1" } },
      {},
      { minGapMs: 0 },
    );
    const sent = hits[hits.length - 1] as Hit;
    expect(sent.headers["user-agent"]).toBe(cfg.userAgent);
    expect(sent.headers["accept-language"]).toBe("en");
    expect(sent.headers["x-plan"]).toBe("1");
  });

  it("decompresses gzip, deflate and brotli, and survives a lying content-encoding", async () => {
    const g = await http.get({ url: `${base}/gzip` }, {}, { minGapMs: 0 });
    expect(JSON.parse(g.text)).toEqual({ ok: "gzip" });
    const d = await http.get({ url: `${base}/deflate` }, {}, { minGapMs: 0 });
    expect(d.text).toBe("deflate ok");
    const b = await http.get({ url: `${base}/brotli` }, {}, { minGapMs: 0 });
    expect(b.text).toBe("brotli ok");
    const l = await http.get({ url: `${base}/lying` }, {}, { minGapMs: 0 });
    expect(l.text).toBe("plain after all");
  });

  it("follows redirects and returns lower-case headers", async () => {
    const res = await http.get({ url: `${base}/redirect` }, {}, { minGapMs: 0 });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text).method).toBe("GET");
    expect(res.headers["x-multi"]).toBe("a");
  });
});
