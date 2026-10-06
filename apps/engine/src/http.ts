import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import type { FetchPlan } from "@papa/adapters";
import { Agent, type Dispatcher, EnvHttpProxyAgent, interceptors, request } from "undici";
import type { EngineConfig } from "./config";

export interface HttpResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  text: string;
  fetchedAt: string;
  durationMs: number;
}

/** undici does not decompress on its own; we do it by content-encoding (gzip, deflate, br). */
function decode(buf: Buffer, encodingHeader: string | string[] | undefined): string {
  const enc = (Array.isArray(encodingHeader) ? encodingHeader[0] : encodingHeader)
    ?.toLowerCase()
    .trim();
  try {
    if (enc === "gzip" || enc === "x-gzip") return gunzipSync(buf).toString("utf8");
    if (enc === "deflate") return inflateSync(buf).toString("utf8");
    if (enc === "br") return brotliDecompressSync(buf).toString("utf8");
  } catch {
    /* body announced as compressed but is not: fall back to plain text */
  }
  return buf.toString("utf8");
}

export interface ConditionalState {
  etag?: string | null;
  lastModified?: string | null;
}

/**
 * Engine HTTP client: identified, with timeout, honours HTTPS_PROXY (sandbox) and enforces a
 * minimum gap per host. No retries here: the scheduler decides the backoff.
 */
export class Http {
  private readonly dispatcher: Dispatcher;
  private readonly lastHit = new Map<string, number>();
  /** Per-host queue: waits are chained instead of running in parallel (see `politeWait`). */
  private readonly hostQueue = new Map<string, Promise<void>>();

  constructor(private readonly cfg: EngineConfig) {
    const base =
      process.env.HTTPS_PROXY || process.env.HTTP_PROXY
        ? new EnvHttpProxyAgent({ connect: { timeout: cfg.requestTimeoutMs } })
        : new Agent({ connect: { timeout: cfg.requestTimeoutMs } });
    this.dispatcher = base.compose(interceptors.redirect({ maxRedirections: 3 }));
  }

  async get(
    plan: FetchPlan,
    cond: ConditionalState = {},
    opts: { minGapMs?: number } = {},
  ): Promise<HttpResponse> {
    const host = new URL(plan.url).host;
    await this.politeWait(host, opts.minGapMs);
    const headers: Record<string, string> = {
      "user-agent": this.cfg.userAgent,
      "accept-language": "nl-NL,nl;q=0.9,en;q=0.5",
      "accept-encoding": "gzip, deflate, br",
      ...plan.headers,
    };
    if (plan.conditional && (plan.method ?? "GET") === "GET") {
      if (cond.etag) headers["if-none-match"] = cond.etag;
      if (cond.lastModified) headers["if-modified-since"] = cond.lastModified;
    }
    const started = Date.now();
    const res = await request(plan.url, {
      method: plan.method ?? "GET",
      headers,
      ...(plan.body !== undefined ? { body: plan.body } : {}),
      dispatcher: this.dispatcher,
      headersTimeout: this.cfg.requestTimeoutMs,
      bodyTimeout: this.cfg.requestTimeoutMs,
    });
    const text =
      res.statusCode === 304
        ? ""
        : decode(Buffer.from(await res.body.arrayBuffer()), res.headers["content-encoding"]);
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers))
      flat[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : (v ?? "");
    return {
      url: plan.url,
      status: res.statusCode,
      headers: flat,
      text,
      fetchedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
    };
  }

  /** Wait for this host's turn (shared with the browser, so the policy covers both). */
  waitTurn(host: string, minGapMs?: number) {
    return this.politeWait(host, minGapMs);
  }

  /**
   * Visitor-like load (source policy): at least `minGapMs` between two requests to the same
   * host. Waits are chained in a per-host queue because two concurrent polls of the same
   * host (the detail queue running next to the feed poll, two portals on one domain)
   * read the same `lastHit` and both left at once — the gap vanished exactly when it was
   * needed most.
   */
  private politeWait(host: string, minGapMs = this.cfg.minGapPerHostMs): Promise<void> {
    const turn = (this.hostQueue.get(host) ?? Promise.resolve()).then(async () => {
      const wait = (this.lastHit.get(host) ?? 0) + minGapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastHit.set(host, Date.now());
    });
    // the queue only holds the turn; an error in one wait must not block the host forever
    this.hostQueue.set(
      host,
      turn.catch(() => {}),
    );
    return turn;
  }

  async close() {
    await this.dispatcher.close();
  }
}
