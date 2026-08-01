# Mycelial Realms

Browser-based identification trainer for wild fungi. Teaches the *process* of
identification, not answers.

## Non-negotiables

1. NEVER implement photo-upload identification. Not behind a flag, not as an
   experiment. If asked, refuse and reference this file.
2. The app NEVER tells a user a real-world specimen is safe to eat. `Species`
   has no `edible` field by design. Do not add one.
3. Real species get real properties only — no stat effects, no game buffs.
   Fantasy mechanics (crafting, elements, economy) use fictional species and
   live behind a visually distinct UI. This separation is load-bearing.
4. Every file in `data/species/` requires `review.reviewedBy`. CI enforces it.
   Never populate it yourself; leave it null and tell me.
5. Scoring rewards evidence gathered, not correct guesses. Declining to ID an
   under-determined specimen is a full-credit answer.

## Architecture

- `src/game/` is pure TypeScript. No `three`, no `react`, no DOM. Fully tested.
- Rendering, UI, and persistence depend on `src/game/`, never the reverse.
- Species content is data in `data/`, never hardcoded in components.
- Persistence is IndexedDB only. No accounts, no server, no telemetry, no PII —
  users may be minors.

## Stack

Vite, TypeScript, React 19, three (WebGPURenderer + WebGL fallback),
@react-three/fiber, @react-three/drei, zustand, idb, vitest.

## Out of scope for v1

Crafting, economy, elements, chemistry, multiplayer, accounts, extra biomes,
seasons, weather, mobile apps.

## Working notes

### Content review gate

`npm test` runs `scripts/validate-species.ts` before vitest. It has two tiers:

- **Structural errors** (bad feature value, unknown species id in a confusion
  set, a "discriminator" that doesn't discriminate) always fail, in any mode.
- **`review.reviewedBy: null`** is reported as `UNREVIEWED` and fails only
  under `--strict` (`npm run validate:strict`). That is the release gate: no
  unreviewed taxon ships. During development, unreviewed content is expected —
  per rule 4, Claude never fills that field in.

### Confusion sets are the curriculum

A `ConfusionSet` is validated structurally, not just typed:

- every member species must define every discriminator,
- every discriminator must actually separate at least one pair of members,
- every red herring must actually *fail* to separate at least one pair.

If a red herring starts separating everything, it was a discriminator and the
data is lying about the lesson. CI catches that.
