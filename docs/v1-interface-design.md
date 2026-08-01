# v1 interface design — the playable loop

Status: **revision 2, proposal.** Revision 1 was reviewed by an architecture
pass, an adversarial pass and a mycology pass. All three found real defects; the
central argument of revision 1 did not survive. What follows is what is left
after those corrections, and it ends with one decision that has to be made
before any code is written.

## What this has to achieve

Hand a link to a mycologist friend, they play for ten minutes, and they say
*"the chanterelle/jack-o'-lantern one is right."*

Revision 1 leaned on an ambiguity in that sentence. It can mean *the content and
scoring are right* — which is judgeable from text alone — or *this app teaches
identification*, which is not. Those are different bars and they fall in
different phases. Said plainly below rather than blurred.

## What exists

`src/game/` is complete and tested. `data/` holds one confusion set with three
taxa. There is no scene, no UI, no persistence, **and no runtime content
loader** — `data/*.json` is read only through `node:fs`, in tests and in the
validator. Nothing can hand a `SpeciesIndex` to a browser.

## Layering

```
src/ui/       React — examination panel, key, notebook, verdict
src/scene/    R3F — the forage view
src/state/    zustand — transport only, no rules
src/persist/  idb — save and load Progress
src/content/  import.meta.glob over data/ → SpeciesIndex   ← was missing
src/game/     pure logic, no react/three/DOM
data/         content, including character diagrams
```

`src/content/` is a bundler feature and cannot live in `game/`. It does not
re-validate at runtime; CI already gates that.

### The purity test is weaker than it claimed

`tests/purity.test.ts` is described in this repo as checking a load-bearing rule
rather than trusting it. Measured, it catches **none** of `import 'three'` (no
`from`, so both regexes miss it), `from "react"` (double quotes), or
`await import('zustand')`. `readdirSync` is non-recursive, so a future
`src/game/session/` subdirectory would be entirely unchecked, and nothing
follows what `data/` itself imports.

Replace it with a closure walk: from every `.ts` under `src/game` recursively,
resolve relative specifiers and follow them, assert every file reached is under
`src/game/` or `data/`, and assert zero bare package specifiers anywhere in the
closure. Still `fs` and regex, no new dependency, and it subsumes all three
current checks. This is step zero.

## The session belongs in `game/` — with four corrections

The recommendation stands; the sketch in revision 1 did not survive contact.

```ts
export interface Session {
  specimen: Specimen;
  actionBudget: number;
  tools: readonly ToolId[];
  performed: ExaminationResult[];
  committed: IdAttempt | null;
  grade: Grade | null;
}

export interface SessionContext { confusionSet: ConfusionSet; index: SpeciesIndex; }

export function applySessionEvent(s: Session, e: SessionEvent, ctx: SessionContext): Session;
export function sessionView(s: Session): SessionView;
```

1. **Content arrives as context, not as an id.** `grade()` takes a
   `ConfusionSet` object and a `SpeciesIndex`; `recordAttempt` takes the set as
   an object too. A `confusionSetId: string` on the session cannot satisfy
   either, so a commit event could set `committed` and nothing else — no grade,
   no hard stop.
2. **`actionsRemaining` is derived, never stored.** `totalActionCost(performed)`
   already exists and already charges a repeat once. A stored counter can drift
   from the list that justifies it.
3. **`sessionView` is the only thing the UI may read.** `Session.specimen`
   carries `observedFeatures` — the complete ground truth for that individual,
   including everything the player has not paid for. Put that in a store and any
   component can render unearned evidence, and the bug looks like a working
   feature. `sessionView` returns observations actually performed. This closes
   the one path by which the cost model gets bypassed by accident.
4. **`canExamine`'s reasons were wrong.** `'already-checked'` must not block:
   `recordExamination` dedupes and `totalActionCost` exists specifically so
   re-looking is free, with a test to that effect. Blocking it makes that code
   dead and stops a player re-reading something they paid for. `'missing-tool'`
   needs `tools` on the session, which revision 1 described in prose and omitted
   from the type. `'already-committed'` was missing entirely.

### The function the loop needs does not exist

`candidateSpecies(specimen, confusionSet, index)` filters on every discriminator
the **individual** will give up, against the specimen's ground truth. Player
evidence never enters it. A "candidates remaining" panel backed by it renders
the correct species before the player clicks anything.

The loop needs `candidatesGivenObservations(performed, confusionSet, index)` —
narrowing on values the player actually paid for. It is new work in `game/`, and
it was not in revision 1's build order.

## Forage generation: mechanism in `game/`, tuning in `data/`

`src/game/forage.ts`, pure: `generatePatch(rng, spec, index): Specimen[]`. The
rng module already promises a seed reproduces a forest exactly; that is only
keepable if selection is pure.

Which set, how many specimens, the member ratio, phenology gating, and the
**substrateOverride trap rate** are content: `data/forays/*.json`, gated by the
existing validator. Hardcoding a spawn table in a scene component is the
content-as-data bug.

The trap rate does **not** go in the species file. `trapChance: 0.35` inside
`omphalotus-illudens.json` puts a game number into a document whose reviewer is
checking it against MushroomExpert. Different document, different reviewer.

`substrateOverride` needs no renderer — it is a `generateSpecimen` option with
three callers today, all in tests. Revision 1 deferred it to Phase 3 on the
false premise that it needed a scene, which would have hidden the confusion
set's central trap from exactly the review meant to judge it. It is staged in
Phase 1.

## Depiction: what revision 1 got wrong

Revision 1 argued that the free/costly split in `data/examinations.ts` maps onto
scene-versus-detail-view: free observations are coarse geometry a renderer can
carry honestly, costly ones are fine morphology. **The cost table is correct and
the inference from it is false.**

`hymenium.type` costs **0**. It is the finest character in the game, the first
discriminator of the only shipped set, and the example revision 1 itself used to
warn about renderers depicting ridges as separable plates. By its own rule it
lands in the scene. `odor` also costs 0 and is not geometry at all.

**Cost and medium are orthogonal.** The corrected split:

- **The scene** shows where and how a thing grows — spatial context at the scale
  of a patch of ground. Growth habit, substrate, the cutaway of what is ten
  centimetres down.
- **The examination view** shows the mushroom's own morphology, free or not.
- **Odor gets no picture at all**, and needs the strongest text in the app.

## Diagrams: the invariant was wrong, the idea was not

The ratified source argues this case better than revision 1 did. Kuo, on why
field guides fail: *"comparing them to photos... Photos almost never convey the
many details that are important in determining a mushroom's identity, and users
of field guides thus often wind up making determinations based on cap color and
virtually nothing else. Color is one of the least reliable features of a
mushroom!"* That is non-negotiable 1's argument, from the source we ratified.

But "every value in `FEATURE_VALUES` gets exactly one authored SVG, CI-enforced"
fails in five ways:

- **The count is 52, not ~40**, and the shipped species use 22. The blanket rule
  means drawing and reviewing 30 pictures — `volva`, `dung`, `phenolic` — for
  confusion sets nobody has written, before the one set that exists can render.
  **Coverage is scoped to values referenced by shipped species files.** The
  pressure survives: adding `pinkish-yellow` still fails the build until it is
  drawn, because putting it in a species file is what trips the check.
- **"Cannot depict the wrong character" is false.** A wrong drawing is wrong on
  every specimen, consistently, forever. The true property is *cannot drift from
  the data*, which is worth having and is a weaker claim.
- **One diagram per value is the wrong unit.** `gills.attachment: decurrent` is
  carried by all three taxa and is correctly a red herring — but drawn once, it
  will be drawn as blades, and a player examining a *chanterelle* is then shown
  a picture of gills. The value is genuinely shared; the lie lives in the
  picture, where the validator cannot see it. Attachment diagrams must be
  conditioned on `hymenium.type`. Likewise `bruising` is a time series, not a
  state — the source says "bruising **slowly**" and the examination is called
  "Bruise the flesh and wait", so a single frame teaches players to expect an
  instant change, see nothing, and record `none`.
- **Some values are ranges, not points.** The source calls the gills/ridges
  distinction *"sort of a continuum... sometimes one must make a judgment
  call."* Drawing `smooth` as a crisp featureless disc teaches a player to
  reject a real *C. lateritius*. `growth.habit: clustered` is worse: it is
  carried by both chanterelles ("small clusters", "loose clusters") and by
  *Omphalotus* ("large clusters"). One diagram must pick, and if it picks the
  dense stump-cluster then every clustered chanterelle shows the player the
  jack-o'-lantern picture — turning a CI-certified red herring into a visual
  discriminator, teaching precisely the inference the teaching note names as
  dangerous.
- **A diagram is a factual assertion and needs the review gate.** An unreviewed
  SVG is an unreviewed claim rendered at maximum confidence, and nobody reads a
  picture sceptically. Diagrams live in `data/diagrams/`, carry their own
  `review` block with `reviewedBy: null`, and fail `--strict` like any species
  file. Registered in a new module, never in `data/schema.ts`, or 50 SVGs enter
  `game/`'s import closure.

The rule becomes: **every covered value has a declared depiction, or a declared
and reviewed reason it has none.**

## The verdict and notebook can reconstruct an edibility verdict

`src/game/` is clean — `foragingStatus` is read only inside `grade()`'s
hard-stop branch. Revision 1 never said what the UI renders, and three paths
follow from that silence:

1. A notebook species page showing `commonly-eaten-when-confirmed` **is** an
   edibility verdict with extra syllables.
2. The verdict screen names the true species; the notebook page then says
   commonly-eaten. Two defensible screens compose into "you identified it, and
   it is safe."
3. **Absence as verdict.** If a toxin panel appears for toxic species and
   nothing appears otherwise, silence becomes the safe signal.

Rule: `foragingStatus` never renders as a label anywhere. `toxinNotes` renders
only via `Grade.hardStop`, only as a consequence of a mistake already made in
game. Enforced by a grep lint over `src/ui/`, `src/scene/`, `src/state/`,
alongside the existing CI checks.

## Smaller gaps found

- **No value labels.** `FEATURE_LABELS` maps feature ids to prose; nothing maps
  *values*. Without a `VALUE_LABELS` table the UI renders `soil-mycorrhizal` and
  `blunt-forking` raw at a beginner, possibly a child.
- **The action economy is decorative in v1.** Three of the four discriminators
  cost 0, so a player reaches evidence ratio 0.75 and scores 90 of 100 XP for
  zero actions. `data/examinations.ts` says "cost is the whole game"; in the
  shipped curriculum it is worth 10%. Either accept that v1 does not exercise
  the economy, or the content needs a set where it bites.
- **`soil-mycorrhizal` is not an observable.** It names an inference about the
  fungus's biology that a player can never see. What is observable is "arising
  from bare ground" — which is exactly what the buried-root trap counterfeits.
  Vocabulary question, flagged.
- **Class A characters need a reference beside the specimen, not on another
  screen.** The source says pale spore prints are "perplexing" between white and
  creamy, and says of chanterelle undersurfaces to "tilt the undersurface at
  several angles in good lighting before deciding." Those cannot be recalled;
  they must be compared live. That is a layout constraint — a persistent
  side-by-side pane at matched size on a matched background, with a light/dark
  background toggle — and it has to be settled before any Class A art is drawn,
  because it fixes the aspect ratio and framing of every one of them.
- **Colour must never be the only channel**, for teachability and because four
  pale near-whites plus a red/brown axis fails colour-blind players outright.

## Build order

**0.** Closure-based purity test. `foragingStatus` UI lint. `src/content/`
runtime loader.

**1.** `src/game/session.ts` with `sessionView` and derived actions;
`candidatesGivenObservations`; `VALUE_LABELS`. All pure, all tested.

**2.** `src/game/forage.ts` + `data/forays/` + validator extension — traps are
data from day one, including the buried-root trap.

**3.** `src/state/` (one file, transport only), `src/persist/`, and the plain
text UI. **Milestone: the content and the scoring are playable and judgeable.**

**4.** Diagram coverage gate, then the art, then the composition component.
**Milestone: the trainer is judgeable.**

**5.** The forage scene, if at all.

## The decision that blocks everything

**What does an examination give the player, and what does the key show before
they commit?**

Today `applyExamination` returns `value: 'cream'` — a string. If the UI renders
that string, the game has performed the perceptual discrimination *for* the
player and handed over the answer; the diagrams become decoration and the app is
a quiz with a mushroom theme. The alternative is that an examination returns
something to *interpret* — a depiction of what this individual shows — and the
player records their own reading, which can be wrong. That is a trainer.

The same fork governs the key. Listing species with their diagrams makes the
whole thing pixel-matching, which is the charge revision 1 levelled at
photographs. Showing surviving candidates leaks the answer. Showing
`foragingStatus` breaks rule 2. Showing nothing makes it a dropdown.

This is not a Phase 4 polish question. It decides the shape of `Session`, what
`ExaminationResult` carries, whether `evidenceRatio` means "checked" or "read
correctly", and whether Phase 3 is worth ten minutes of a mycologist's time.
Nothing should be built past step 0 until it is answered.
