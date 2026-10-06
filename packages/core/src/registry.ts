import { readFileSync } from "node:fs";
import { parseRegistry, type Registry } from "./registry-schema";

export * from "./registry-schema";

export function loadRegistry(path: string): Registry {
  return parseRegistry(readFileSync(path, "utf8"));
}
