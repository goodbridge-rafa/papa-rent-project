import { eigenHaardAdapter } from "./eigen-haard/index";
import { heimstadenAdapter } from "./heimstaden/index";
import type { SourceAdapter } from "./types";
import { zig365Adapter } from "./zig365/index";

export { eigenHaardAdapter } from "./eigen-haard/index";
export { heimstadenAdapter } from "./heimstaden/index";
export * from "./types";
export { zig365Adapter } from "./zig365/index";

const ADAPTERS: Record<string, SourceAdapter> = {
  [eigenHaardAdapter.id]: eigenHaardAdapter,
  [heimstadenAdapter.id]: heimstadenAdapter,
  [zig365Adapter.id]: zig365Adapter,
};

export function getAdapter(id: string): SourceAdapter {
  const a = ADAPTERS[id];
  if (!a) throw new Error(`Unknown adapter: ${id}`);
  return a;
}

export function listAdapters(): string[] {
  return Object.keys(ADAPTERS);
}
