# ADR-006 · Use of LLMs

**Status.** Decision for a later phase; **not implemented**. There is no LLM code in `apps/` or `packages/`: every adapter in this copy parses structured JSON or HTML deterministically.

**Decision.** No LLM in production for sources with structured JSON/HTML (zero cost and latency). If unstructured pages (for example new-build brochures) are added, a small model with structured outputs may extract them, with prompt caching and a daily spending cap. During development, AI coding agents (Claude Code) do source reconnaissance, adapter generation and repair proposals when a parser breaks (snapshot + diff + PR).

**Consequences.** Production LLM spend is zero today and was budgeted under €5/month if the extraction path is ever built. The engine stays deterministic and auditable; an LLM never decides whether a listing exists.
