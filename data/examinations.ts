import type { Examination, FeatureId } from './schema';

/**
 * The action catalogue. Cost is the whole game: a free look at the substrate
 * versus an overnight spore print you have to come back for. Destructive
 * examinations are the ones that cost the mushroom, not just the clock.
 *
 * Every character ships `reading: 'given'`, and that is a sequencing decision
 * rather than a design one. The session machinery records the player's reading
 * separately from the truth either way, so flipping `hymenium.type` and
 * `spore.print` to `judged` is a change to this file and nothing else.
 *
 * Two things have to land first, and neither is code:
 *
 *  1. **The art.** A `judged` character needs a depiction, and a depiction is a
 *     factual assertion rendered at maximum confidence — nobody reads a picture
 *     sceptically. It goes through the review gate like any other content.
 *  2. **A scoring decision.** Once a reading can be wrong, a player can misread
 *     a character, correctly conclude from what they saw that the specimen is
 *     under-determined, and decline. Today `grade()` scores that as an
 *     unnecessary decline, because it judges resolvability against ground truth
 *     the player never had. Docking XP there teaches a forager to commit when
 *     unsure, which is the worst reflex this app could install. With every
 *     character `given`, reading always equals truth and the case cannot
 *     arise — so the flip is what is blocked, not the build.
 */
export const EXAMINATIONS: Record<FeatureId, Examination> = {
  'growth.habit': {
    feature: 'growth.habit',
    label: 'Step back and look at how it grows',
    actionCost: 0,
    destructive: false,
    reading: 'given',
  },
  substrate: {
    feature: 'substrate',
    label: 'Look at what it is growing from',
    actionCost: 0,
    destructive: false,
    reading: 'given',
  },
  'hymenium.type': {
    feature: 'hymenium.type',
    label: 'Look under the cap',
    actionCost: 0,
    destructive: false,
    reading: 'given',
  },
  'stem.ring': {
    feature: 'stem.ring',
    label: 'Check the stem for a ring',
    actionCost: 0,
    destructive: false,
    reading: 'given',
  },
  odor: {
    feature: 'odor',
    label: 'Smell it',
    actionCost: 0,
    destructive: false,
    reading: 'given',
  },
  'gills.attachment': {
    feature: 'gills.attachment',
    label: 'Trace the underside to the stem',
    actionCost: 1,
    destructive: false,
    reading: 'given',
  },
  'gills.edge': {
    feature: 'gills.edge',
    label: 'Examine the edges with a loupe',
    actionCost: 1,
    requiresTool: 'loupe',
    destructive: false,
    reading: 'given',
  },
  bruising: {
    feature: 'bruising',
    label: 'Bruise the flesh and wait',
    actionCost: 1,
    destructive: true,
    reading: 'given',
  },
  'stem.base': {
    feature: 'stem.base',
    label: 'Excavate the base',
    actionCost: 2,
    requiresTool: 'knife',
    destructive: true,
    reading: 'given',
  },
  'flesh.section': {
    feature: 'flesh.section',
    label: 'Cut it in half, top to bottom',
    actionCost: 2,
    requiresTool: 'knife',
    destructive: true,
    reading: 'given',
  },
  'spore.print': {
    feature: 'spore.print',
    // Half on white, half on dark. Pale prints — cream, pale yellow, pinkish
    // yellow — are indistinguishable from each other on white paper alone, and
    // in the first confusion set that difference is the whole character.
    label: 'Take a spore print, on white and dark paper',
    actionCost: 3,
    requiresTool: 'paper',
    destructive: true,
    reading: 'given',
  },
};

export const EXAMINATION_LIST: readonly Examination[] = Object.values(EXAMINATIONS);
