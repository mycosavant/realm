import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { ConfusionSet, Species } from '../data/schema';
import {
  CONFUSION_SETS,
  SPECIES,
  SPECIES_INDEX,
  findConfusionSet,
  findSpecies,
} from '../src/content';
import { grade } from '../src/game';
import { loadContent } from '../scripts/validate-species';

/**
 * The validator reads `data/` with `readdirSync`; the browser reads it with
 * `import.meta.glob`. CI only gates what the validator sees, so "CI gates the
 * content" is a claim about the shipped bundle *only if* the two loaders agree.
 * That is what this file checks.
 */
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const onDisk = loadContent(dataDir);

const diskSpecies = onDisk.species.map((entry) => entry.data as Species);
const diskSets = onDisk.confusionSets.map((entry) => entry.data as ConfusionSet);

describe('the runtime loader and the validator see the same content', () => {
  it('loads every species file, and only those', () => {
    expect(SPECIES.map((s) => s.id)).toEqual(diskSpecies.map((s) => s.id).sort());
  });

  it('loads every confusion set', () => {
    expect(CONFUSION_SETS.map((s) => s.id)).toEqual(diskSets.map((s) => s.id).sort());
  });

  it('loads the files byte-for-byte, not a re-derivation', () => {
    for (const species of diskSpecies) {
      expect(findSpecies(species.id)).toEqual(species);
    }
    for (const set of diskSets) {
      expect(findConfusionSet(set.id)).toEqual(set);
    }
  });

  it('has unique ids — a collision would silently drop a taxon from the index', () => {
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(SPECIES.length);
    expect(new Set(CONFUSION_SETS.map((s) => s.id)).size).toBe(CONFUSION_SETS.length);
  });

  it('orders content independently of the bundler, so a seed reproduces', () => {
    expect(SPECIES.map((s) => s.id)).toEqual([...SPECIES.map((s) => s.id)].sort());
  });

  it('returns undefined for an unknown id rather than throwing', () => {
    expect(findSpecies('no-such-species')).toBeUndefined();
    expect(findConfusionSet('no-such-set')).toBeUndefined();
  });
});

describe('the loaded index is what src/game/ actually wants', () => {
  it('grades a real attempt against real content with no adapter in between', () => {
    const set = findConfusionSet('chanterelle-vs-jack-o-lantern');
    expect(set).toBeDefined();
    const species = findSpecies('omphalotus-illudens');
    expect(species).toBeDefined();

    const result = grade(
      {
        specimenId: 'loader-check',
        featuresChecked: ['hymenium.type', 'substrate', 'odor', 'spore.print'],
        answer: { kind: 'species', speciesId: 'omphalotus-illudens' },
      },
      set as ConfusionSet,
      {
        id: 'loader-check',
        speciesId: 'omphalotus-illudens',
        age: 'mature',
        weathering: 0,
        unavailableFeatures: [],
        observedFeatures: {
          'hymenium.type': 'gills',
          substrate: 'hardwood-dead',
          odor: 'none',
          'spore.print': 'cream',
          'growth.habit': 'clustered',
          'gills.attachment': 'decurrent',
        },
      },
      SPECIES_INDEX,
    );

    expect(result.correct).toBe(true);
    expect(result.evidenceRatio).toBe(1);
  });
});
