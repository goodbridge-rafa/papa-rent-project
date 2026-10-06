import type { FetchPlan } from "@papa/adapters";
import { type Browser, chromium, type Response } from "playwright-core";
import type { EngineConfig } from "./config";
import type { Http, HttpResponse } from "./http";

/**
 * Renders public pages in headless Chromium for sources whose data only exists after JS runs
 * (technical Tier B, source policy). No stealth: same User-Agent as the engine, no login, no
 * challenge circumvention; if the page returns a challenge, the body is returned as-is and the
 * adapter fails visibly. Images, media and fonts are blocked to spare the source.
 * A single browser instance, launched on first use; a fresh context per request.
 */
export class BrowserFetcher {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  constructor(
    private readonly cfg: EngineConfig,
    private readonly http: Http,
  ) {}

  private async launch(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launching) {
      this.launching = chromium
        .launch({
          headless: true,
          ...(this.cfg.browserExecutable ? { executablePath: this.cfg.browserExecutable } : {}),
          args: this.cfg.browserArgs,
        })
        .then((b) => {
          this.browser = b;
          this.launching = null;
          return b;
        })
        .catch((err) => {
          this.launching = null;
          throw err;
        });
    }
    return this.launching;
  }

  async fetch(plan: FetchPlan): Promise<HttpResponse> {
    const render = plan.render ?? {};
    const timeout = render.timeoutMs ?? this.cfg.browserTimeoutMs;
    const host = new URL(plan.url).host;
    await this.http.waitTurn(host);
    const started = Date.now();
    const browser = await this.launch();
    const ctx = await browser.newContext({
      userAgent: this.cfg.userAgent,
      locale: "nl-NL",
      viewport: { width: 1280, height: 900 },
      ...(plan.headers ? { extraHTTPHeaders: plan.headers } : {}),
    });
    try {
      await ctx.route("**/*", (route) => {
        const t = route.request().resourceType();
        if (t === "image" || t === "media" || t === "font") return route.abort();
        return route.continue();
      });
      const page = await ctx.newPage();
      const matcher = render.captureResponse ? toMatcher(render.captureResponse) : null;
      const captured = matcher
        ? page.waitForResponse((r: Response) => matcher(r.url()), { timeout })
        : null;
      // avoid an unhandled rejection if navigation fails before the response arrives
      captured?.catch(() => undefined);
      const nav = await page.goto(plan.url, { waitUntil: "domcontentloaded", timeout });
      for (const sel of render.clicks ?? []) {
        try {
          await page.click(sel, { timeout: 2_000 });
        } catch {
          /* selector missing: ignore */
        }
      }
      if (render.waitForSelector)
        await page.waitForSelector(render.waitForSelector, { timeout, state: "attached" });
      let status = nav?.status() ?? 200;
      let text: string;
      let url = plan.url;
      const headers: Record<string, string> = {};
      if (captured) {
        const res = await captured;
        status = res.status();
        url = res.url();
        text = await res.text();
        for (const [k, v] of Object.entries(await res.allHeaders())) headers[k.toLowerCase()] = v;
      } else {
        await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined);
        text = await page.content();
        if (nav) for (const [k, v] of Object.entries(nav.headers())) headers[k.toLowerCase()] = v;
      }
      return {
        url,
        status,
        headers,
        text,
        fetchedAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
      };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }

  async close() {
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => undefined);
  }
}

/** "re:<regex>" → regex; otherwise substring. Exported for tests. */
export function toMatcher(spec: string): (url: string) => boolean {
  if (spec.startsWith("re:")) {
    const re = new RegExp(spec.slice(3));
    return (u) => re.test(u);
  }
  return (u) => u.includes(spec);
}
