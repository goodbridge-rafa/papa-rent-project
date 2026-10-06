---
name: adapter
description: Builds an adapter for an already reconned source (dossier + fixture exist) with the adapter-builder agent and validates it live with `pnpm engine once`. Use for "adapter for X", "integrate source X".
---
1. Confirm that `docs/sources/<slug>.md` and a fixture exist, and that the dossier does not exclude the source (robots/terms). If not, run the `source-recon` skill first.
2. Launch the `adapter-builder` agent with the slug. Require green tests.
3. Validate live (dry run, one request, identified User-Agent): `pnpm engine once -s <slug>`. Check title, price, dates (UTC) and the detail URL.
4. If the source is tier A: `status: live` in the registry. If B: leave `recon` and record the pending decision in the dossier.
5. Commit: `feat(adapters): <slug>`.
