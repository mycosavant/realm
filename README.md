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

CI runs typecheck, `npm test` and the build on every push and pull request, and
reports unreviewed taxa in the run summary without blocking. The blocking
`validate:strict` gate runs on tags and releases only — see
`.github/workflows/`.

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

Ground truth for taxonomic descriptions is **MushroomExpert.com** and
**MushroomObserver.org**, ratified as standing sources and cited per page in
`review.sources`. Two rules follow, and they are in `CLAUDE.md`: do not coarsen
a source to fit the vocabulary — extend the vocabulary instead; and do not
assert what a source does not say. MushroomExpert carries no toxicity
information by policy, so `toxinNotes` always needs its own citation.

Ratifying a source is not review. `review.reviewedBy` stays null regardless.

### Open questions for the mycologist

Each is written into the `ecologyNotes` of the file it affects:

1. **Should the game model tool-conditional characters?** *Settled that the
   character is real:* a pale pinkish yellow print is distinguishable from a
   white-to-creamy one *on dark paper*, and indistinguishable on white. The
   vocabulary now carries `pinkish-yellow` and the examination calls for both
   papers. What is not modelled is the conditionality — `applyExamination`
   returns the same value whichever paper you used. Making informativeness
   depend on technique is a real mechanic and a real schema change.
2. **Growth habit as a tendency.** The sources say chanterelles *rarely* grow in
   dense clusters and the jack-o'-lantern is *usually* clustered — and both
   chanterelles are recorded as forming small or loose clusters. The schema has
   no way to say "usually", so growth habit separates nothing categorically and
   sits in `redHerrings`. If it should carry weight, the schema needs a way to
   express typical versus possible.
3. **Gill edge values.** `blunt-forking` for *C. appalachiensis* and `sharp` for
   *Omphalotus* rest on general morphology; neither page describes edges.
   *C. lateritius* has no `gills.edge` at all, which is why the feature is not a
   discriminator in this set.
4. **`toxinNotes` for *Omphalotus*** is the one piece of text where being wrong
   has a body count, and it is not covered by the ratified description sources.
5. **The large golden chanterelle** of the *C. cibarius* group has no entry. If
   it fruits alongside these two, it needs one.
6. **Phenology windows** are month ranges derived from bare seasonal words
   ("Summer", "Late summer and fall") and want narrowing to Kentucky.

`gbifTaxonKey` and `inatTaxonId` are deliberately absent. They deep-link a user
outward to a real taxon page, and a wrong key sends them to the wrong mushroom.
