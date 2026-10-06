import dataset from "./dataset.json";

/**
 * DEMO mode of the public web demo.
 *
 * The demo is served as static files: there is no API, database or accounts. Instead of faking a
 * server, we serve a **snapshot** of responses the real API produced, offline, from a small set
 * of fictional listings (see `scripts/build-demo-dataset.ts` and `scripts/demo-listings.ts`). The
 * data has the API's shape because the API *did* generate it.
 *
 * Three rules this module enforces:
 * 1. **Nothing beyond the snapshot.** Only what is in the snapshot is returned.
 * 2. **No write works silently.** Creating a radar, saving the profile, deleting the account,
 *    registering a device: all fail with `DemoUnavailableError`, which the UI shows as unavailable.
 * 3. **The user always knows.** The demo banner (`DemoBanner`) is always visible and says the
 *    listings are fictional examples; this is never presented as real, current supply.
 */

interface Dataset {
  snapshotAt: string;
  note: string;
  sources: string[];
  listingCount: number;
  radarIds: string[];
  routes: Record<string, unknown>;
}

const data = dataset as unknown as Dataset;

/** Date of the demo snapshot. */
export const DEMO_SNAPSHOT_AT = data.snapshotAt;
/** (Fictional) sources represented in the snapshot. */
export const DEMO_SOURCES = data.sources;
export const DEMO_LISTING_COUNT = data.listingCount;

/** An operation only a server can perform. The UI translates this into "unavailable in the demo". */
export class DemoUnavailableError extends Error {
  readonly demo = true as const;
  constructor(public readonly operation: string) {
    super(`demo: ${operation} unavailable`);
    this.name = "DemoUnavailableError";
  }
}

type RefusalListener = (operation: string) => void;
const refusalListeners = new Set<RefusalListener>();

/**
 * Notifies when an operation is refused. It exists because the screen is not enough: some writes
 * no screen shows (saving the profile is just a `mutate`) and some whose screen would say
 * "something went wrong, try again", and trying again will never work. The demo banner listens
 * to this and says what is going on, wherever the refusal comes from.
 *
 * Returns the unsubscribe function.
 */
export function onDemoRefusal(listener: RefusalListener): () => void {
  refusalListeners.add(listener);
  return () => {
    refusalListeners.delete(listener);
  };
}

/** Builds the refusal and notifies listeners. The caller decides whether to throw or reject. */
export function demoRefusal(operation: string): DemoUnavailableError {
  for (const listener of refusalListeners) listener(operation);
  return new DemoUnavailableError(operation);
}

/** Refuses an operation: notifies any listener and throws. */
export function refuseInDemo(operation: string): never {
  throw demoRefusal(operation);
}

/** Methods that change server state. None of them exists here. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Refusals the banner does not announce, because the screen already explains them in the right
 * place and nobody explicitly asked for them.
 *
 * For now only the radar estimate: it is a POST, but underneath it is a read that fires on its own
 * while the form is being edited. Shouting on every keystroke would be noise, and the form says
 * right there, under the field, that the estimate does not exist in the demo.
 */
const QUIET_REFUSALS: ReadonlySet<string> = new Set(["/v1/radars/estimate"]);

/** `/v1/feed?limit=30&cursor=12` -> `/v1/feed`. The snapshot is keyed by path. */
function routeKey(path: string): string {
  const [base = ""] = path.split("?");
  return base.replace(/\/$/, "");
}

/**
 * Answers as the API would, from the snapshot.
 * Throws `DemoUnavailableError` for everything that would need a server, including reads that were
 * not recorded, because returning an invented empty result would lie about what exists.
 */
export function demoRequest<T>(path: string, init: { method?: string } = {}): T {
  const method = (init.method ?? "GET").toUpperCase();
  const key = routeKey(path);
  if (WRITE_METHODS.has(method)) {
    const operation = `${method} ${key}`;
    if (QUIET_REFUSALS.has(key)) throw new DemoUnavailableError(operation);
    refuseInDemo(operation);
  }

  const hit = data.routes[key];
  if (hit === undefined) refuseInDemo(`GET ${key}`);

  // Pagination does not exist in the snapshot: the single recorded page is returned.
  if (typeof hit === "object" && hit !== null && "nextCursor" in hit) {
    return { ...(hit as object), nextCursor: null } as T;
  }
  return hit as T;
}

/** The demo's local session. Not an account: there is no server where an account could exist. */
export const DEMO_USER = (data.routes["/v1/me"] as { user?: unknown } | undefined)?.user ?? null;
