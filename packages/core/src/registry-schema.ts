import { parse } from "yaml";
import { z } from "zod";
import {
  AllocationModel,
  SourceKind,
  SourceSegment,
  SourceStack,
  SourceStatus,
  SourceTier,
} from "./enums";

/** Schema of docs/sources/registry.yaml. The engine only reads sources that are valid against it. */
export const RegistrySource = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  kind: SourceKind,
  stack: SourceStack,
  tier: SourceTier,
  status: SourceStatus,
  urls: z.object({
    home: z.string().url(),
    listings: z.string().url().nullable(),
    data: z.string().url().nullable(),
    robots: z.string().url().nullable(),
    terms: z.string().url().nullable(),
  }),
  regions: z.array(z.string()).default([]),
  provinces: z.array(z.string()).default([]),
  municipalities: z.array(z.string()).default([]),
  segments: z.array(SourceSegment).default([]),
  registration: z
    .object({
      fee_eur: z.number().nullable(),
      renewal_eur_per_year: z.number().nullable(),
      required_to_react: z.boolean().nullable(),
      confidence: z.enum(["A", "B", "C", "D"]).nullable(),
    })
    .nullable(),
  allocation_models: z.array(AllocationModel.exclude(["unknown"])).default([]),
  interval_seconds: z.number().int().positive().nullable(),
  adapter: z.string().nullable(),
  /** Optional pointer into internal research notes; informational only, never read by the engine. */
  research_ref: z.string().nullable(),
  fingerprint: z
    .object({
      checked_at: z.string().nullable(),
      http: z.number().nullable(),
      note: z.string().nullable(),
    })
    .nullable(),
  legal: z
    .object({
      robots_checked_at: z.string().nullable(),
      robots_note: z.string().nullable(),
      terms_checked_at: z.string().nullable(),
      terms_note: z.string().nullable(),
      decision_by: z.string().nullable(),
      decision_at: z.string().nullable(),
    })
    .nullable(),
  notes: z.string().nullable(),
});
export type RegistrySource = z.infer<typeof RegistrySource>;

export const Registry = z.object({
  version: z.literal(1),
  updated_at: z.string(),
  sources: z.array(RegistrySource),
});
export type Registry = z.infer<typeof Registry>;

export function parseRegistry(yamlText: string): Registry {
  const registry = Registry.parse(parse(yamlText));
  const seen = new Set<string>();
  for (const s of registry.sources) {
    if (seen.has(s.slug)) throw new Error(`Duplicate source slug in registry: ${s.slug}`);
    seen.add(s.slug);
  }
  return registry;
}

/** Sources the engine may poll: tier A (or B with a recorded decision) and status live. */
export function pollableSources(registry: Registry): RegistrySource[] {
  return registry.sources.filter(
    (s) =>
      s.status === "live" &&
      s.adapter !== null &&
      s.interval_seconds !== null &&
      (s.tier === "A" || (s.tier === "B" && s.legal?.decision_at)),
  );
}
