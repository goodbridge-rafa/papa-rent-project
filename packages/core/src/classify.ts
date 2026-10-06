import type { Segment } from "./enums";
import { getRule } from "./market-rules";

export interface ClassifyInput {
  /** kale huur, €/month */
  priceNet: number | null;
  /** Explicit hint from the source (e.g. a "middenhuur", "vrije sector", "sociale huur" section). */
  sourceHint?: Segment | null;
  /** WWS points published by the source: they decide the legal regime regardless of the asking price. */
  wwsPoints?: number | null;
  at?: Date;
}

export interface ClassifyResult {
  segment: Segment;
  reason: string;
}

/**
 * Classifies a listing's segment.
 * Priority: explicit source hint > WWS points > price vs. thresholds in force > unknown.
 * Thresholds come from market-rules (versioned by date; never hardcode them here).
 */
export function classifySegment(input: ClassifyInput): ClassifyResult {
  const at = input.at ?? new Date();
  if (input.sourceHint && input.sourceHint !== "unknown") {
    return { segment: input.sourceHint, reason: "source_hint" };
  }
  if (typeof input.wwsPoints === "number" && input.wwsPoints > 0) {
    const socialPts = getRule("wws_social_max_points", at).value;
    const middenPts = getRule("wws_midden_max_points", at).value;
    if (input.wwsPoints <= socialPts)
      return { segment: "social", reason: `wws<=wws_social_max_points(${socialPts})` };
    if (input.wwsPoints <= middenPts)
      return { segment: "midden", reason: `wws<=wws_midden_max_points(${middenPts})` };
    return { segment: "free", reason: `wws>wws_midden_max_points(${middenPts})` };
  }
  if (input.priceNet === null || input.priceNet <= 0) {
    return { segment: "unknown", reason: "no_price" };
  }
  const social = getRule("social_rent_cap", at).value;
  const midden = getRule("midden_rent_cap", at).value;
  if (input.priceNet <= social)
    return { segment: "social", reason: `price<=social_rent_cap(${social})` };
  if (input.priceNet <= midden)
    return { segment: "midden", reason: `price<=midden_rent_cap(${midden})` };
  return { segment: "free", reason: `price>midden_rent_cap(${midden})` };
}
