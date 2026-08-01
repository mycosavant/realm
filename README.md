# Mycelial Realms

A browser-based identification trainer for wild fungi. It teaches the *process*
of identification — what to look at, what it costs to look, and when the honest
answer is "I don't know" — not a list of answers.

It never tells you whether anything is safe to eat. See `CLAUDE.md`.

## v1 scope — "The Foray Trainer"

One biome (Kentucky mixed hardwood), a handful of taxa organised into confusion
sets, specimen generation with variation, the examine → key → commit loop,
evidence-based scoring, a notebook that fills in as you learn, local-only save.

**This session built `src/game/` and the content pipeline only.** There is no
rendering and no UI yet.

## Running it

```bash
npm install
npm test              # content validation, then vitest
npm run test:watch
npm run validate      # content gate on its own
npm run validate:strict   # release gate: fails while any species is unreviewed
npm run typecheck
npm run dev           # placeholder shell — no game UI yet
```

## Repo layout

```
data/
  schema.ts               types + controlled vocabulary for every feature value
  examinations.ts         the action catalogue: what each look costs
  species/*.json          content, gated by scripts/validate-species.ts
  confusion-sets/*.json   the curriculum
src/
  game/                   PURE logic. No three, no react, no DOM. Tested.
    rng.ts                seeded, so a forest reproduces exactly
    availability.ts       one rule table for what an individual will not show
    specimen.ts           generateSpecimen(species, rng, options)
    examination.ts        applyExamination(specimen, feature)
    scoring.ts            grade(attempt, confusionSet, specimen, speciesIndex)
    progression.ts        XP, levels, notebook, confusion-set mastery
scripts/
  validate-species.ts     CI gate, also unit-tested
tests/
```

`src/game/` imports nothing but `data/`. A test enforces that.

## How scoring works

Evidence earns the XP, not the guess.

| Situation | XP |
| --- | --- |
| Correct, backed by ≥ half the set's discriminators | 60 + 40 × evidence ratio |
| Correct, backed by less than half | 5, with feedback naming what went unchecked |
| Declined an individual that genuinely cannot be resolved | 100 |
| Declined something that was resolvable | 25, and it names the character that would have settled it |
| Correct on an individual the evidence could not have resolved | 25 — the answer wasn't earned |
| Wrong | 0, and a hard stop with the toxin note if the specimen was deadly, or if an edible call was made on something toxic |

The evidence ratio counts examinations *attempted*, not values obtained. Looking
for a spore print on a weathered specimen and finding nothing is still looking.

## Specimens, not species

You identify individuals. `generateSpecimen` realises one fruitbody with an age
and a weathering value, then removes what that individual will not give up:

- a **button** shows no hymenium, no gill attachment, no ring, no spores — which
  is why cutting it in half is the only move left;
- **weathering > 0.4** takes the odor, **> 0.7** takes the ring, **> 0.85** takes
  the gill edges and the spore print;
- a snapped base loses `stem.base`, and a specimen found off its substrate loses
  both `substrate` and `growth.habit`.

A `substrateOverride` lets a caller stage the buried-root trap: an *Omphalotus*
fruiting from a root ten centimetres down reads as growing from bare soil.
Scoring resolves it by weight of evidence rather than strict elimination, so the
player who checks growth habit is still rewarded — and the feedback names the
character that lied.

## Content review

Nothing in `data/species/` is reviewed. `review.reviewedBy` is `null` in every
file, `npm run validate` reports it as `UNREVIEWED`, and `--strict` fails on it.
Per `CLAUDE.md` rule 4 that field is filled in by a human or not at all.

### Open questions for the mycologist

Each is written into the `ecologyNotes` of the file it affects:

1. **Spore print colour resolution.** All three members are recorded as `white`;
   all three are really white to pale yellow. That coarsening is what makes the
   spore print a red herring in this set, and the red herring is the point — so
   it needs confirming, not assuming. Adding a `cream` value to the vocabulary
   is the alternative, and it would not change the lesson.
2. **Odor of *C. appalachiensis*.** Recorded as `apricot`, which is the safe
   direction rather than the certain one: descriptions run from fruity to not
   distinctive, and recording `none` would stop odor separating it from
   *Omphalotus*. Reasoning is in the file.
3. **Gill edge on a smooth hymenium.** *C. lateritius* is recorded as
   `blunt-forking`, but a genuinely smooth hymenium arguably has no edge to
   read. Omitting the feature is the honest encoding — an examination would
   return `not-applicable`, which is real evidence — but the validator requires
   every member of a set to define every discriminator, so `gills.edge` would
   have to leave the discriminator list.
4. **Which name for the smooth chanterelle**, *Cantharellus* or *Craterellus*.
5. **The large golden chanterelle** of the *C. cibarius* group has no entry. If
   it fruits alongside these two, it needs one.
6. **Phenology windows** for both chanterelles are approximate.

`gbifTaxonKey` and `inatTaxonId` are deliberately absent. They deep-link a user
outward to a real taxon page, and a wrong key sends them to the wrong mushroom.
