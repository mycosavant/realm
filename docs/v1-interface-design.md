# v1 interface design — the playable loop

Status: **revision 2. Steps 0, 1 and 2 are built; steps 3–5 are still proposal.**
Revision 1 was reviewed by an architecture pass, an adversarial pass and a
mycology pass. All three found real defects; the central argument of revision 1
did not survive. What follows is what is left after those corrections. The
decision it used to end on — what an examination hands the player — is settled,
and the closing section records both the answer and why the question was framed
wrongly.

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
re-validate at runtime; CI already gates that — with one caveat found while
building it, below.

### The purity test is weaker than it claimed — built

`tests/purity.test.ts` was described in this repo as checking a load-bearing
rule rather than trusting it. Measured, it caught **none** of `import 'three'`
(no `from`, so both regexes missed), `from "react"` (double quotes), or
`await import('zustand')`. `readdirSync` was non-recursive, so a future
`src/game/session/` subdirectory would have gone entirely unchecked, and nothing
followed what `data/` itself imports.

Replaced with a closure walk in `tests/purity-walk.ts`: from every `.ts` under
`src/game` recursively, resolve relative specifiers and follow them, assert
every file reached is under `src/game/` or `data/`, and assert zero bare package
specifiers anywhere in the closure. Still `fs` and regex, no new dependency, and
it subsumes all three previous checks.

Two things the plan did not anticipate:

- **The walk had to be injectable.** It reads through a `read` callback so the
  checker can be pointed at synthetic files that genuinely break the rule. That
  is the whole difference between this version and the last one, which was never
  run against a violation and so was wrong for months. Nine of its tests are
  leaks it must catch, including a transitive one through `data/`.
- **It needed a comment stripper, and found that out the hard way.** The first
  version reported `data/schema.ts` as importing a package called
  `clustered-fused` — `export const FEATURE_VALUES = {` matched forward to the
  comment reading *"'clustered' is separate from 'clustered-fused'"*. A repo
  whose comments discuss packages and whose data files are full of quoted
  strings cannot be checked by a regex that does not know which is which. There
  is now a small string-aware stripper, and the false positive is a test.

A walk that resolves nothing passes vacuously, so there is also an assertion
that the closure actually reached `data/schema.ts` and `data/examinations.ts`.

### The two loaders have to be checked against each other — built

`src/content/index.ts` globs `data/` into a `SpeciesIndex`. "CI gates the
content" is a claim about the shipped bundle only if the glob and the
validator's `readdirSync` see the same files, and nothing made them agree.
`tests/content-loader.test.ts` asserts they do, file for file.

Two smaller consequences:

- Content is sorted by id rather than left in glob order, so that a seeded
  forage cannot reproduce differently across bundlers.
- `App.tsx` imports the loader. Without a live import the module tree-shakes
  away and `npm run build` succeeds whether or not `data/` reaches a browser at
  all — the build went from 15 to 20 modules when it was wired in, which is the
  measurement that the pipeline exists.

### `foragingStatus` cannot reach the interface — built

`tests/ui-boundaries.test.ts` fails if anything outside `src/game/` mentions
`foragingStatus`, `toxinNotes`, `FORAGING_STATUSES`, or any of the five status
literals, and pins `toxinNotes` to a single read inside the `hardStop` branch.
The word "edible" is deliberately not banned: the disclaimer has to be able to
say the app will not tell you what is edible.

## The session belongs in `game/` — with four corrections — built

The recommendation stands; the sketch in revision 1 did not survive contact.

```ts
export interface Observation extends ExaminationResult {
  reading?: string;              // what the player recorded — never `value`
  readingMode: 'given' | 'judged';
}

export interface Session {
  specimen: Specimen;
  actionBudget: number;
  tools: readonly ToolId[];
  performed: readonly Observation[];
  committed: IdAttempt | null;
  grade: Grade | null;
}

export interface SessionContext { confusionSet: ConfusionSet; index: SpeciesIndex; }

export function applySessionEvent(s: Session, e: SessionEvent, ctx: SessionContext): Session;
export function sessionView(s: Session, ctx: SessionContext): SessionView;
```

`sessionView` takes the context too, because the candidates panel is derived
from content and there is no honest way to compute it without.

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

### The function the loop needs does not exist — built

`candidateSpecies(specimen, confusionSet, index)` filters on every discriminator
the **individual** will give up, against the specimen's ground truth. Player
evidence never enters it. A "candidates remaining" panel backed by it renders
the correct species before the player clicks anything.

`candidatesGivenObservations(performed, confusionSet, index)` narrows on values
the player actually paid for. It weighs the three examination outcomes
differently — `observed` narrows to members carrying that value,
`not-applicable` narrows to members that lack the character entirely (this is
what resolves *C. lateritius*, whose smooth hymenium has no gill edge to read),
and `unavailable` narrows nothing, because the player spent an action and the
individual gave up no reading. Best match rather than strict elimination, so the
buried-root trap does not delete the right answer from the panel.

#### The asymmetry trap has a second floor

Writing its tests turned up a property nobody had stated, and the first version
of the test asserted the opposite of it.

A red herring is validated on species value sets **overlapping**. The player
sees one *realised* value. Where the sets overlap without being identical, the
character narrows in one direction and not the other.

`growth.habit` in the shipped set is exactly this. The chanterelles carry
solitary, scattered and clustered; *Omphalotus* carries only clustered. So:

- **`solitary` really does exclude the jack-o'-lantern.** Reporting otherwise
  would be lying to the player about a true inference.
- **`clustered` excludes nobody**, because chanterelles cluster too.

That is the whole lesson of the set, and the panel now shows it directly: the
same character resolves the question or fails to, depending on which way it
lands. Red herrings whose members share an identical value — every member
decurrent, every member solid — narrow nothing whatever the player sees, and
four of the five shipped red herrings are that kind.

The validator is not wrong and does not change. CLAUDE.md's rule is a statement
about species value sets and remains true. What is new is that "red herring"
does not mean "carries no information to the player", and any panel or teaching
note that says so is overclaiming.

### Value labels — built

`VALUE_LABELS` in `data/schema.ts`, keyed by feature and **not** flat. The first
draft was flat and wrong: `none` is "no colour change" under `bruising` and "no
distinct smell" under `odor`; `absent` is "no stem at all" under `stem.base` and
"no ring" under `stem.ring`; `brown` is a spore print colour and also a bruising
reaction. Three collisions in fifty-two values, and a flat map silently picks
one. `tests/vocabulary.test.ts` enumerates the shared values and fails if any
two characters give one the same prose.

## Forage generation: mechanism in `game/`, tuning in `data/` — built

`src/game/forage.ts`, pure: `generatePatch(rng, foray, index): Specimen[]`. The
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

### The curriculum is one month wide

Phenology was listed as a knob. Measured against the shipped species files it is
a constraint: the Appalachian chanterelle runs June to August, the smooth
chanterelle June to November, the jack-o'-lantern August to November. **August is
the only month all three fruit at once.** A September foray on this set is a
genuinely different and smaller curriculum — the smooth chanterelle against the
jack-o'-lantern, which the spore print *does* resolve, so the pairing the
teaching note calls dangerous is not even present. A test pins the one-month
window, because a phenology edit that widened it would quietly change what the
flagship foray teaches.

Gating is enforced twice, and that is deliberate rather than redundant. The
validator refuses to let a file weight a species that does not fruit in its
month — otherwise the file asserts a species the engine will silently drop.
`generatePatch` drops it anyway, because seasonality is a rule about the world
and not a lint about the file, and a caller synthesising a foray at runtime is
entitled to the rule.

### Two validator rules that are about honesty, not structure

- **A foray may cover fewer members than its confusion set only because nature
  left them out, never because the author did.** Every in-season member must be
  weighted. Without this, dropping the jack-o'-lantern from an August foray
  yields a patch where every specimen is edible and a player who learns "orange
  means chanterelle" — and the file reads like an ordinary curriculum. A June
  foray covering only the two chanterelles passes, because in June that is true.
- **A trap has to counterfeit somebody.** `presentsSubstrate` must be a value the
  species does not grow on (or the trap is a no-op that reads as a trap) *and*
  one another species in the same patch does grow on (or the individual presents
  a character nobody in the set has, which is noise rather than a lesson).

### What the trap actually does to the player, measured

The teaching note's claims are now tested rather than asserted. On a trapped
jack-o'-lantern: one look at the substrate, read correctly, deletes the toxic
species from the shortlist. The underside and the odor get it back. `grade()`,
which applies every reachable discriminator at once instead of one at a time,
resolves the individual and names the character that lied.

On a **button** it does not recover, and this is the case worth knowing about.
The underside has not opened, the spore print is blank, and what is left is a
lying substrate against a truthful odor — one character each way. The individual
is genuinely unresolvable, `grade()` says so, and declining scores 100. That is
rule 5 working, and it is the one place in the shipped content where the
full-credit decline is reachable without contrivance.

### Forays are not review-gated, and neither are confusion sets

A foray file asserts things about the woods: that a third of jack-o'-lanterns
present as rising from bare ground, that August is the right month. It carries no
`review` block — matching `data/confusion-sets/`, which carries none either.

That is consistent, and it is also a gap. CLAUDE.md rule 4 names `data/species/`,
and the two-tier gate follows it exactly, so the single most load-bearing piece
of prose in the repo — the confusion set's `teachingNote`, which is where the
safety argument actually lives — ships with no reviewer attached. Extending the
gate is a policy decision, not a refactor; it is recorded here rather than taken.

In the meantime the foray requires a `designNote` on the file and on every trap,
and the shipped one says in as many words that its numbers are invented and that
nobody has measured how often the buried-root trap actually happens.

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

**0. Done.** Closure-based purity test. `foragingStatus` UI lint. `src/content/`
runtime loader. 103 tests, and the production bundle now carries `data/`.

**1. Done.** `candidatesGivenObservations`, `VALUE_LABELS`, and
`src/game/session.ts` with `sessionView`, derived actions, and the two-value
observation. All pure, all tested.

**2. Done.** `src/game/forage.ts`, `data/forays/appalachian-august.json`, and
`validateForay`. Traps are data from day one, including the buried-root trap.
193 tests.

**3.** `src/state/` (one file, transport only), `src/persist/`, and the plain
text UI. **Milestone: the content and the scoring are playable and judgeable.**

**4.** Diagram coverage gate, then the art, then the composition component.
**Milestone: the trainer is judgeable.**

**5.** The forage scene, if at all.

## The decision that blocked everything — settled

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

**Recommendation: the hybrid.** Categorical characters — `stem.ring: absent`,
`substrate: hardwood-dead` — return text, because there is no perceptual skill
in them and making the player squint at a picture of a ring teaches nothing. The
characters the ratified sources themselves describe as judgment calls return a
depiction, and the player records their own reading:

- **`spore.print`.** Kuo calls the pale end "perplexing"; the shipped set turns
  on `pinkish-yellow` against `white`/`cream`, readable only on dark paper.
- **`hymenium.type`.** *"Sort of a continuum... sometimes one must make a
  judgment call."* This is the first discriminator of the only shipped set.
- **`bruising`.** "Bruising **slowly**" is a time series, not a state. Returning
  the word `none` hands over the answer to a character whose whole difficulty is
  waiting long enough.

Everything else is text. That puts the diagrams exactly where the sources locate
the skill, keeps `evidenceRatio` meaning "checked" for text characters and "read
correctly" for depicted ones, and — the part that matters for scope — means
steps 1 through 3 can be built now, because only three characters need art
before the trainer is judgeable rather than all twenty-two.

### What was settled, and why it was a better question than the one asked

The framing above collapses two separate dials into one. Split apart:

1. **What the examination shows** — a string, or something to interpret.
2. **What the session records** — the truth, or the player's reading.

Three of the four combinations are coherent. Show text and record truth: a quiz.
Show a depiction and record the reading: a trainer. Show a depiction and record
the truth: you drew the picture and then read it *for* the player, which is
strictly worse than the quiz because it also cost art.

The resolution is to record **both**, always. `ExaminationResult.value` stays
the individual's truth; `Observation.reading` is what the player put down;
`sessionView` exposes only the latter. Two things then become separately
scorable, and collapsing them was breaking rule 5:

- **Did you look?** — the action economy and `evidenceRatio`. Evidence over
  correctness.
- **Did you read it right?** — the perceptual skill, which is what a trainer
  trains.

`grade()` structurally could not tell those apart, because it never saw a
reading. Concretely: a player spends three actions — the most expensive thing in
the game — takes a spore print on *C. lateritius*, reads `pinkish-yellow` as
`cream` on white paper, and calls *C. appalachiensis*. Today that scores zero and
the feedback says "not the Appalachian chanterelle, this is the smooth
chanterelle", which is true and useless. What it should say is: *your evidence
was sound and your reading of it is what missed*. That sentence is only writable
if both values exist.

And the misreading is worse than picking the wrong chanterelle. `cream` is inside
the *jack-o'-lantern's* range too, so one misread character eliminates the
specimen's own species and readmits the toxic one. There is a test for exactly
that.

**The rule that follows, and it is not negotiable:** a misreading must never make
hesitation more expensive than confidence. Punishing caution caused by a
perceptual error teaches a forager to commit when unsure, which is the worst
reflex this app could install.

#### Which makes it a data decision, not an architectural one

The mode lives in `data/examinations.ts` beside `actionCost` and `requiresTool`.
Every observation goes through identical machinery; the flag decides who
supplies the reading. **Everything ships `given` in v1** — that is the quiz,
playable and judgeable on content and scoring — and flipping `hymenium.type` and
`spore.print` to `judged` is a change to that one file.

Two things gate the flip, and neither is code:

1. **The art.** Four spore print values are in play across shipped species
   (white, cream, pale-yellow, pinkish-yellow) times two paper backgrounds, plus
   three hymenium values (gills, false-ridges, smooth). Eleven images, through
   the review gate like any other content.
2. **The scoring decision above.** With every character `given`, reading always
   equals truth, so the decline-after-misreading case cannot arise. The flip is
   what is blocked, not the build.

`bruising` drops out of the v1 art budget entirely: all three shipped taxa record
`none`, so there is nothing to depict. Which surfaces its own finding — that
examination costs an action, is destructive, and in the shipped curriculum can
only ever return "no change". Defensible as a restraint lesson; worth knowing it
is currently a tax.

`substrate` does not need a depiction either, because the trap is already
modelled one level down: `substrateOverride` makes the *individual* genuinely
present as soil. The player reads correctly and the evidence is honestly
misleading. That is a different lesson from misperception, and it already works.

Worth noting for the action economy complaint: `hymenium.type` costs **0** and is
the hardest character in the game to read. Perceptual difficulty and action cost
are orthogonal — the same shape as the cost/medium finding above — so the
economy gets its teeth from the reading model rather than from the price list.

## Open, and live today: declining is under-rewarded

The adversarial pass on `session.ts` found this and it is the most important
thing outstanding. It is not caused by the reading model and it is not waiting
on the flip — it is reachable in the shipped build.

`grade()` decides `underdetermined` by applying **every reachable
discriminator** to the specimen. It never asks which of them the player actually
checked. So:

> A player meets an Appalachian chanterelle. They spend three actions — the most
> expensive thing in the game — on a spore print. It comes back `white`, which
> genuinely cannot separate that chanterelle from the jack-o'-lantern; both taxa
> carry white and cream, and the teaching note says in as many words that this is
> "the one pairing the print cannot resolve... the pair a forager is most likely
> to be holding, and the pair where being wrong costs the most."
>
> On the evidence they hold, the specimen is not resolvable. They decline. They
> are awarded **`XP_UNNECESSARY_DECLINE` — 25 of 100** — and told "This
> individual was resolvable."

That is the app docking a beginner three quarters of the credit for correctly
refusing to guess on the dangerous pair. CLAUDE.md rule 5 says declining an
under-determined specimen is a full-credit answer; the implementation reads
"under-determined" as a fact about the specimen when the player experiences it as
a fact about their evidence.

The fix is not obvious and it is a scoring decision, not a refactor. Roughly:
`underdetermined` should be evaluated against the discriminators the player
checked, not every reachable one — but then a player who checks nothing and
declines is also "under-determined", and `XP_UNNECESSARY_DECLINE` exists
precisely to stop declining being a free 100. Both readings have a defensible
case and they trade off against each other, which is why this is written down
rather than changed.

Two constraints on whichever way it goes:

- **Hesitation must never cost more than confidence.** A wrong ID already scores
  zero. A defensible decline scoring 25 while a lucky guess scores 5 is close
  enough to be worth checking deliberately.
- It must stay true once readings can be wrong, because the misread-then-decline
  case is the same bug with a second cause.
