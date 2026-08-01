import { describe, expect, it } from 'vitest';

import type { FeatureId, IdAttempt } from '../data/schema';
import { applyExamination } from '../src/game/examination';
import {
  emptyProgress,
  levelForXp,
  MASTERY_THRESHOLD,
  recordAttempt,
  xpToNextLevel,
  type Progress,
} from '../src/game/progression';
import { makeRng } from '../src/game/rng';
import { grade } from '../src/game/scoring';
import { generateSpecimen } from '../src/game/specimen';
import { CHANTERELLE, CHANTERELLE_SET, JACK_O_LANTERN, SPECIES_INDEX } from './fixtures';

const IN_SITU = { age: 'mature', weathering: 0, snapChance: 0, detachedChance: 0 } as const;

function play(
  progress: Progress,
  seed: number,
  species: typeof CHANTERELLE,
  checked: FeatureId[],
  answer: IdAttempt['answer'],
): Progress {
  const specimen = generateSpecimen(species, makeRng(seed), IN_SITU);
  const observations = checked.map((feature) => applyExamination(specimen, feature));
  const attempt: IdAttempt = { specimenId: specimen.id, featuresChecked: checked, answer };
  return recordAttempt(progress, {
    attempt,
    grade: grade(attempt, CHANTERELLE_SET, specimen, SPECIES_INDEX),
    specimen,
    confusionSet: CHANTERELLE_SET,
    observations,
  });
}

const allDiscriminators = [...CHANTERELLE_SET.discriminators];

describe('levels', () => {
  it('starts at level 1 and climbs on the threshold', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(299)).toBe(2);
    expect(levelForXp(300)).toBe(3);
    expect(levelForXp(999999)).toBe(10);
  });

  it('reports the distance to the next level, and null at the top', () => {
    expect(xpToNextLevel(0)).toBe(100);
    expect(xpToNextLevel(250)).toBe(50);
    expect(xpToNextLevel(999999)).toBeNull();
  });
});

describe('recordAttempt', () => {
  it('does not mutate the progress it was given', () => {
    const before = emptyProgress();
    const snapshot = structuredClone(before);
    play(before, 11, CHANTERELLE, allDiscriminators, {
      kind: 'species',
      speciesId: CHANTERELLE.id,
    });
    expect(before).toEqual(snapshot);
  });

  it('opens a notebook page and fills it with what was observed', () => {
    const after = play(emptyProgress(), 11, CHANTERELLE, ['hymenium.type', 'odor'], {
      kind: 'species',
      speciesId: CHANTERELLE.id,
    });
    const entry = after.notebook[CHANTERELLE.id];
    expect(entry.encounters).toBe(1);
    expect(entry.correctIds).toBe(1);
    expect(entry.confirmedFeatures['hymenium.type']).toEqual(['false-ridges']);
    expect(entry.confirmedFeatures.odor).toEqual(['apricot']);
    expect(entry.confirmedFeatures['spore.print']).toBeUndefined();
    expect(after.featureChecks['hymenium.type']).toBe(1);
  });

  it('records what a wrong answer taught the player anyway', () => {
    const after = play(emptyProgress(), 12, JACK_O_LANTERN, ['growth.habit'], {
      kind: 'species',
      speciesId: CHANTERELLE.id,
    });
    const entry = after.notebook[JACK_O_LANTERN.id];
    expect(entry.encounters).toBe(1);
    expect(entry.correctIds).toBe(0);
    expect(entry.confirmedFeatures['growth.habit']).toEqual(['clustered']);
    expect(after.hardStops).toBe(1);
    expect(after.xp).toBe(0);
  });

  it('does not double-record a feature value already in the notebook', () => {
    let progress = emptyProgress();
    progress = play(progress, 11, CHANTERELLE, ['hymenium.type'], {
      kind: 'species',
      speciesId: CHANTERELLE.id,
    });
    progress = play(progress, 11, CHANTERELLE, ['hymenium.type'], {
      kind: 'species',
      speciesId: CHANTERELLE.id,
    });
    expect(progress.notebook[CHANTERELLE.id].confirmedFeatures['hymenium.type']).toEqual([
      'false-ridges',
    ]);
    expect(progress.notebook[CHANTERELLE.id].encounters).toBe(2);
    expect(progress.featureChecks['hymenium.type']).toBe(2);
  });

  it('counts declines and accumulates XP into levels', () => {
    let progress = emptyProgress();
    for (const seed of [11, 21, 31]) {
      progress = play(progress, seed, CHANTERELLE, allDiscriminators, {
        kind: 'species',
        speciesId: CHANTERELLE.id,
      });
    }
    progress = play(progress, 41, CHANTERELLE, allDiscriminators, { kind: 'declined' });
    expect(progress.declines).toBe(1);
    expect(progress.attempts).toBe(4);
    expect(progress.xp).toBe(3 * 100 + 25);
    expect(progress.level).toBe(3);
  });

  it('marks a confusion set mastered only after enough earned IDs', () => {
    let progress = emptyProgress();
    // A lucky guess is not an earned ID, however often it is repeated.
    for (let i = 0; i < MASTERY_THRESHOLD; i += 1) {
      progress = play(progress, 11 + i, CHANTERELLE, ['hymenium.type'], {
        kind: 'species',
        speciesId: CHANTERELLE.id,
      });
    }
    expect(progress.confusionSets[CHANTERELLE_SET.id].earnedIds).toBe(0);
    expect(progress.confusionSets[CHANTERELLE_SET.id].mastered).toBe(false);

    for (let i = 0; i < MASTERY_THRESHOLD; i += 1) {
      progress = play(progress, 51 + i, CHANTERELLE, allDiscriminators, {
        kind: 'species',
        speciesId: CHANTERELLE.id,
      });
    }
    expect(progress.confusionSets[CHANTERELLE_SET.id].earnedIds).toBe(MASTERY_THRESHOLD);
    expect(progress.confusionSets[CHANTERELLE_SET.id].mastered).toBe(true);
    expect(progress.confusionSets[CHANTERELLE_SET.id].attempts).toBe(MASTERY_THRESHOLD * 2);
  });
});
