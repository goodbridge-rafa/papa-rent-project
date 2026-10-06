import { describe, expect, it } from "vitest";
import {
  DEMO_LISTING_COUNT,
  DEMO_SNAPSHOT_AT,
  DemoUnavailableError,
  demoRequest,
  onDemoRefusal,
} from "@/lib/demo";
import appJsonFile from "../app.json";

type ExpoConfig = Record<string, unknown> & { experiments?: Record<string, unknown> };
type ConfigFn = (ctx: { config: ExpoConfig }) => ExpoConfig;

const appJson = appJsonFile.expo as unknown as ExpoConfig;
const appConfig = (await import("../app.config.js")).default as unknown as ConfigFn;

/**
 * Runs `app.config.js` with the given environment. No module reload is needed: the config reads
 * `process.env` on every call, on purpose, so one process can produce both variants.
 */
function loadConfig(env: Record<string, string | undefined>): ExpoConfig {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return appConfig({ config: structuredClone(appJson) });
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const CLEAN = { PAPA_WEB_BASE_PATH: undefined, EXPO_PUBLIC_DEMO: undefined };

describe("app.config.js", () => {
  it("returns app.json untouched without environment variables", () => {
    // What protects iOS and Android: a native build never sets these variables, so it gets
    // exactly the usual configuration. If this fails, the web export changed the native config.
    expect(loadConfig(CLEAN)).toEqual(appJson);
  });

  it("serves from the root by default: no baseUrl unless one is configured", () => {
    for (const value of [undefined, "", "  ", "/"]) {
      const web = loadConfig({ ...CLEAN, PAPA_WEB_BASE_PATH: value, EXPO_PUBLIC_DEMO: "1" });
      expect(web.experiments?.baseUrl).toBeUndefined();
    }
  });

  it("applies a configured baseUrl without touching ios, android or the other experiments", () => {
    const web = loadConfig({ ...CLEAN, PAPA_WEB_BASE_PATH: "/demo" });
    expect(web.experiments?.baseUrl).toBe("/demo");
    expect(web.experiments?.reactCompiler).toBe(appJson.experiments?.reactCompiler);
    expect(web.ios).toEqual(appJson.ios);
    expect(web.android).toEqual(appJson.android);
    expect(web.plugins).toEqual(appJson.plugins);

    const nested = loadConfig({ ...CLEAN, PAPA_WEB_BASE_PATH: "/apps/papa-rent" });
    expect(nested.experiments?.baseUrl).toBe("/apps/papa-rent");
  });

  it("marks the web name as a demo and leaves native alone", () => {
    const web = loadConfig({ ...CLEAN, EXPO_PUBLIC_DEMO: "1" });
    expect(String((web.web as { name: string }).name)).toContain("demo");
    expect(web.name).toBe(appJson.name);
    expect(web.ios).toEqual(appJson.ios);
    expect(web.android).toEqual(appJson.android);
  });

  it("refuses a malformed sub-path instead of producing a broken export", () => {
    // Without a leading slash Expo resolves assets relative to the page: /l/<id> would look for
    // the bundle under /l/demo/_expo/... and get a 404.
    expect(() => loadConfig({ ...CLEAN, PAPA_WEB_BASE_PATH: "demo" })).toThrow();
    expect(() => loadConfig({ ...CLEAN, PAPA_WEB_BASE_PATH: "/demo/" })).toThrow();
  });
});

describe("demo mode", () => {
  it("has a snapshot with listings and a valid date", () => {
    expect(DEMO_LISTING_COUNT).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(DEMO_SNAPSHOT_AT))).toBe(false);
  });

  it("refuses every write: nothing may look saved", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(() => demoRequest("/v1/radars", { method })).toThrow(DemoUnavailableError);
    }
  });

  it("refuses a read that was not recorded instead of inventing an empty result", () => {
    expect(() => demoRequest("/v1/listings/does-not-exist")).toThrow(DemoUnavailableError);
  });

  it("serves the recorded reads and cuts pagination", () => {
    expect(demoRequest("/v1/me")).toHaveProperty("user");
    const feed = demoRequest<{ listings: unknown[]; nextCursor: unknown }>("/v1/feed?limit=30");
    expect(feed.listings.length).toBeGreaterThan(0);
    expect(feed.nextCursor).toBeNull();
  });

  it("contains only fictional data: example.com links and a placeholder user", () => {
    const me = demoRequest<{ user: { email: string; name: string } }>("/v1/me");
    expect(me.user.email).toMatch(/@example\.com$/);
    const feed = demoRequest<{ listings: Array<{ url: string; applyUrl: string | null }> }>(
      "/v1/feed",
    );
    for (const l of feed.listings) {
      expect(new URL(l.url).hostname.endsWith("example.com")).toBe(true);
      if (l.applyUrl) expect(new URL(l.applyUrl).hostname.endsWith("example.com")).toBe(true);
    }
  });
});

describe("refusal notice", () => {
  it("announces every refusal so the banner can say that feature does not exist here", () => {
    // Without this a refused write either says nothing, or says "something went wrong, try
    // again", and trying again never works. This is what keeps the promise of clearly flagging
    // what is unavailable.
    const seen: string[] = [];
    const stop = onDemoRefusal((op) => seen.push(op));
    try {
      expect(() => demoRequest("/v1/radars", { method: "POST" })).toThrow(DemoUnavailableError);
      expect(() => demoRequest("/v1/listings/nope")).toThrow(DemoUnavailableError);
    } finally {
      stop();
    }
    expect(seen).toEqual(["POST /v1/radars", "GET /v1/listings/nope"]);

    // Once unsubscribed nothing else arrives; otherwise every screen mount would leave a listener.
    expect(() => demoRequest("/v1/radars", { method: "POST" })).toThrow();
    expect(seen).toHaveLength(2);
  });

  it("announces nothing for a read that exists", () => {
    const seen: string[] = [];
    const stop = onDemoRefusal((op) => seen.push(op));
    try {
      demoRequest("/v1/feed");
    } finally {
      stop();
    }
    expect(seen).toEqual([]);
  });
});

describe("silent refusals", () => {
  it("does not shout about the radar estimate: the form already says so in the right place", () => {
    // The estimate is a `useQuery` that fires on its own on every keystroke in the form. If the
    // banner shouted, it would shout while typing. Refusing still refuses; only the notice changes.
    const seen: string[] = [];
    const stop = onDemoRefusal((op) => seen.push(op));
    try {
      expect(() => demoRequest("/v1/radars/estimate", { method: "POST" })).toThrow(
        DemoUnavailableError,
      );
    } finally {
      stop();
    }
    expect(seen).toEqual([]);
  });
});
