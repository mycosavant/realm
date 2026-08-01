# v1 interface design — the playable loop

Status: **proposal, not agreed.** Two forks at the bottom need a decision before
building.

## What this has to achieve

The definition of done for v1 is one sentence: hand a link to a mycologist
friend, they play for ten minutes, and they say *"the chanterelle/jack-o'-lantern
one is right."*

That sentence is doing a lot of work. It is not "the graphics are good" and it
is not "the loop is fun". It is a domain expert confirming that the *teaching*
is correct. Everything below is sequenced to reach that verdict as early as
possible, because it is the verdict most likely to send us back to the data.

## What exists

`src/game/` is complete and tested — specimen generation, examination,
scoring, progression. `data/` holds one confusion set with three taxa. There is
no scene, no UI, no persistence, and `src/App.tsx` is a placeholder.

## Layering

```
src/ui/       React — examination panel, key, notebook, verdict
src/scene/    R3F — the forage view
src/state/    zustand — thin binding of session state to React
src/persist/  idb — save and load Progress
src/game/     pure logic, no react/three/DOM        ← everything depends on this
data/         content
```

One-way. `tests/purity.test.ts` already enforces that `game/` imports nothing
but `data/`; it should be extended to assert the reverse edge does not appear —
that nothing under `game/` is imported *into* by a path that would invert the
dependency.

## The session belongs in `game/`, not in React

The strongest recommendation in this document.

A foray session has real logic in it: which specimen is in hand, which
examinations have been performed, how many actions remain, whether a tool is
carried, which candidates survive the evidence so far, and whether the player
may still commit. Every one of those is testable, and every one of them ends up
scattered across component state by default.

So: `src/game/session.ts`, pure, with a reducer shape.

```ts
export interface Session {
  specimen: Specimen;
  confusionSetId: string;
  actionsRemaining: number;
  performed: ExaminationResult[];
  committed: IdAttempt | null;
}

export type SessionEvent =
  | { kind: 'examine'; feature: FeatureId }
  | { kind: 'commit'; answer: IdAttempt['answer'] };

export function applySessionEvent(session: Session, event: SessionEvent): Session;
export function canExamine(session: Session, feature: FeatureId): 
  { ok: true } | { ok: false; reason: 'no-actions' | 'missing-tool' | 'already-checked' };
```

The UI then renders a value and dispatches an event. No game rule lives in a
component, and the whole loop is unit-testable before a single pixel exists.

`src/state/` becomes a thin zustand store holding a `Session` and calling
`applySessionEvent` — not a second home for rules.

## The fidelity problem

This is the part that makes this project different from a normal game build.

**A specimen rendered wrong teaches the wrong character.** If the 3D chanterelle
shows false ridges as thin separable planes, the player learns to call gills
ridges, and the lesson inverts into exactly the mistake that puts people in
hospital. Rendering fidelity here is not polish. It is content correctness, and
it should be gated like content.

The examination cost model already tells us where to draw the line, and it lines
up with how foraging actually works:

| Cost | Examination | Where it happens |
| --- | --- | --- |
| 0 | growth habit, substrate, hymenium type (a look), ring, odor | in situ — the scene |
| 1–2 | gill attachment, gill edge, bruising, stem base, flesh section | close, deliberate — the detail view |
| 3 | spore print | overnight — the detail view |

The free, in-situ observations are **coarse geometry**: is it alone or in a
cluster, is it on soil or a stump. A renderer can carry those honestly. The
costly observations are **fine morphology**, and those are exactly what
generated 3D gets wrong.

### Proposal: characters are authored diagrams, driven by data

Rather than rendering fine characters in 3D or photographing them, every value
in `FEATURE_VALUES` gets one authored SVG diagram. `hymenium.type: false-ridges`
renders a schematic cross-section of blunt forking ridges continuous with the
cap flesh; `gills` renders thin separable plates. The examination view composes
the diagrams for whatever this individual actually shows.

Why this is better than it sounds:

- **It cannot depict the wrong character.** The diagram is keyed to the value,
  so the picture and the data cannot drift.
- **It isolates the character.** A photo shows one individual with all its
  confounds; a diagram shows the thing being taught. This is why field guides
  are illustrated.
- **No licensing surface.** We cannot ship photographs of specimens we do not
  own the rights to, and rule 1's spirit is that this app never becomes
  picture-matching.
- **CI can enforce coverage.** Every vocabulary value must have exactly one
  diagram, checked the same way species files are checked. Adding
  `pinkish-yellow` to the vocabulary would have failed the build until someone
  drew it — which is the correct pressure.

The risk is honest and should be stated: a diagram is an interpretation, and a
badly drawn one is as wrong as a badly rendered one. The mitigation is that
there are ~40 of them, they are small, and they are reviewable by a mycologist
in one sitting — which a procedural renderer never is.

## Persistence

`src/persist/` wraps `idb` with one store holding a serialised `Progress`.
Nothing else. No session snapshots in v1 — a foray is short, and resuming
mid-specimen is not worth the surface area.

Load on boot, save after each `recordAttempt`. Failure to open IndexedDB should
degrade to in-memory rather than blocking play; a kid on a locked-down school
browser should still get to play, they just lose the notebook.

## Build order

Sequenced so the *teaching* is testable before the atmosphere exists.

**Phase 1 — playable, no 3D.** `game/session.ts` with tests; `src/state/`;
`src/persist/`; and a plain examination → key → commit → verdict UI. Specimens
are chosen from a seeded RNG and presented as a list of what is observable. Ugly
and complete. **At the end of this phase the loop can be played and judged.**

**Phase 2 — the diagrams.** SVG per vocabulary value, CI coverage check, the
examination view rendering them. This is the phase that makes the chanterelle
lesson legible, and the one to put in front of a mycologist.

**Phase 3 — the forage view.** R3F scene, specimens in situ, free observations
by looking. Substrate and growth habit become things you see rather than read.
This is where `substrateOverride` finally has a caller and the buried-root trap
enters play.

Phase 3 is the only phase whose absence still leaves something worth showing.

## Two decisions needed

**1. Does the 3D scene ship in v1?** The stack mandates three + R3F, and Phase 3
is where the project stops looking like a quiz. But the ten-minute verdict is
reachable at the end of Phase 2, and every hour spent on a forest is an hour not
spent on the four remaining confusion sets — which are the actual curriculum.
The honest options are: ship all three phases as v1; or ship Phases 1–2 as v1
and make the forage view v1.1.

**2. Diagrams, or something else?** The proposal above commits to authored SVG
for fine characters. The alternatives are photographs (licensing, and it drags
the app toward picture-matching), or 3D renders of the fine morphology (highest
risk of teaching the wrong thing). If diagrams are right, someone has to draw
~40 of them and a mycologist has to check them.
