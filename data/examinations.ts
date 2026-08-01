import type { Examination, FeatureId } from './schema';

/**
 * The action catalogue. Cost is the whole game: a free look at the substrate
 * versus an overnight spore print you have to come back for. Destructive
 * examinations are the ones that cost the mushroom, not just the clock.
 */
export const EXAMINATIONS: Record<FeatureId, Examination> = {
  'growth.habit': {
    feature: 'growth.habit',
    label: 'Step back and look at how it grows',
    actionCost: 0,
    destructive: false,
  },
  substrate: {
    feature: 'substrate',
    label: 'Look at what it is growing from',
    actionCost: 0,
    destructive: false,
  },
  'hymenium.type': {
    feature: 'hymenium.type',
    label: 'Look under the cap',
    actionCost: 0,
    destructive: false,
  },
  'stem.ring': {
    feature: 'stem.ring',
    label: 'Check the stem for a ring',
    actionCost: 0,
    destructive: false,
  },
  odor: {
    feature: 'odor',
    label: 'Smell it',
    actionCost: 0,
    destructive: false,
  },
  'gills.attachment': {
    feature: 'gills.attachment',
    label: 'Trace the underside to the stem',
    actionCost: 1,
    destructive: false,
  },
  'gills.edge': {
    feature: 'gills.edge',
    label: 'Examine the edges with a loupe',
    actionCost: 1,
    requiresTool: 'loupe',
    destructive: false,
  },
  bruising: {
    feature: 'bruising',
    label: 'Bruise the flesh and wait',
    actionCost: 1,
    destructive: true,
  },
  'stem.base': {
    feature: 'stem.base',
    label: 'Excavate the base',
    actionCost: 2,
    requiresTool: 'knife',
    destructive: true,
  },
  'flesh.section': {
    feature: 'flesh.section',
    label: 'Cut it in half, top to bottom',
    actionCost: 2,
    requiresTool: 'knife',
    destructive: true,
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
  },
};

export const EXAMINATION_LIST: readonly Examination[] = Object.values(EXAMINATIONS);
