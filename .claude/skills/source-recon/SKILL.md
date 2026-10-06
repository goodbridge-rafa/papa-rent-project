---
name: source-recon
description: Runs source recon in waves with the source-scout agent (up to 5 in parallel), consolidates the dossiers and lists the Tier B decisions for the owner. Use for "recon the sources", "wave 1/2/3", "investigate source X".
---
1. Read the registry. Pick the sources with `status: planned` or `recon` for the requested wave.
2. Launch up to 5 `source-scout` agents in parallel, one per slug, in the background. Do not duplicate sources.
3. When they finish: apply each dossier's `## Registry patch` block to `registry.yaml` (one at a time, preserving comments), validate with `pnpm engine registry:check`; run `pnpm lint`.
4. Summarise: tier A sources ready for an adapter; tier B sources with the pending decision (one line each: risk, recommendation); tier C and excluded sources (robots/terms said no) with the reason. Excluded sources are never polled.
5. Commit: `docs(sources): recon wave N — <slugs>`.
