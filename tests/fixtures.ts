import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ConfusionSet, Foray, Species } from '../data/schema';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(dataDir, relativePath), 'utf8')) as T;
}

/** Real, shipped content — the same files the validator gates. */
export const CHANTERELLE = readJson<Species>('species/cantharellus-appalachiensis.json');
export const SMOOTH_CHANTERELLE = readJson<Species>('species/cantharellus-lateritius.json');
export const JACK_O_LANTERN = readJson<Species>('species/omphalotus-illudens.json');
export const CHANTERELLE_SET = readJson<ConfusionSet>(
  'confusion-sets/chanterelle-vs-jack-o-lantern.json',
);
export const AUGUST_FORAY = readJson<Foray>('forays/appalachian-august.json');

export const SPECIES_INDEX: Record<string, Species> = {
  [CHANTERELLE.id]: CHANTERELLE,
  [SMOOTH_CHANTERELLE.id]: SMOOTH_CHANTERELLE,
  [JACK_O_LANTERN.id]: JACK_O_LANTERN,
};

/**
 * Test doubles, NOT content. The Amanita set is not in `data/` yet because no
 * mycologist has reviewed it; these exist only to exercise the button rule and
 * the deadly-species hard stop.
 */
export const FIXTURE_DESTROYING_ANGEL: Species = {
  id: 'fixture-destroying-angel',
  scientificName: 'Amanita bisporigera',
  commonNames: ['destroying angel'],
  features: {
    'hymenium.type': ['gills'],
    'gills.attachment': ['free'],
    'gills.edge': ['sharp'],
    'spore.print': ['white'],
    'stem.base': ['volva'],
    'stem.ring': ['present'],
    'flesh.section': ['solid'],
    bruising: ['none'],
    odor: ['none'],
    substrate: ['soil-mycorrhizal'],
    'growth.habit': ['solitary', 'scattered'],
  },
  foragingStatus: 'deadly',
  toxinNotes:
    'Amatoxins. Symptoms are delayed six to twenty-four hours, then appear to improve before liver failure. A single fruitbody can kill an adult.',
  ecologyNotes: 'Test fixture.',
  phenology: { startMonth: 6, endMonth: 10 },
  review: { reviewedBy: null, reviewedOn: null, sources: [] },
};

export const FIXTURE_MEADOW_MUSHROOM: Species = {
  id: 'fixture-meadow-mushroom',
  scientificName: 'Agaricus campestris',
  commonNames: ['meadow mushroom'],
  features: {
    'hymenium.type': ['gills'],
    'gills.attachment': ['free'],
    'gills.edge': ['sharp'],
    'spore.print': ['brown'],
    'stem.base': ['equal'],
    'stem.ring': ['present'],
    'flesh.section': ['solid'],
    bruising: ['none'],
    odor: ['none'],
    substrate: ['soil-mycorrhizal'],
    'growth.habit': ['scattered'],
  },
  foragingStatus: 'commonly-eaten-when-confirmed',
  ecologyNotes: 'Test fixture.',
  phenology: { startMonth: 5, endMonth: 10 },
  review: { reviewedBy: null, reviewedOn: null, sources: [] },
};

export const FIXTURE_AMANITA_SET: ConfusionSet = {
  id: 'fixture-white-gilled',
  memberSpeciesIds: [FIXTURE_DESTROYING_ANGEL.id, FIXTURE_MEADOW_MUSHROOM.id],
  discriminators: ['spore.print', 'stem.base'],
  redHerrings: ['gills.attachment', 'hymenium.type'],
  teachingNote: 'Test fixture.',
};

export const FIXTURE_INDEX: Record<string, Species> = {
  [FIXTURE_DESTROYING_ANGEL.id]: FIXTURE_DESTROYING_ANGEL,
  [FIXTURE_MEADOW_MUSHROOM.id]: FIXTURE_MEADOW_MUSHROOM,
};

/** A taxon with no gills at all, for the not-applicable path. */
export const FIXTURE_MOREL: Species = {
  id: 'fixture-morel',
  scientificName: 'Morchella sp.',
  commonNames: ['morel'],
  features: {
    'hymenium.type': ['pits-ridges'],
    'flesh.section': ['hollow-single'],
    'stem.base': ['equal'],
    substrate: ['soil-mycorrhizal'],
    'growth.habit': ['scattered'],
  },
  foragingStatus: 'commonly-eaten-when-confirmed',
  ecologyNotes: 'Test fixture.',
  phenology: { startMonth: 4, endMonth: 5 },
  review: { reviewedBy: null, reviewedOn: null, sources: [] },
};
