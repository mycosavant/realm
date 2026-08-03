import { describe, expect, it } from 'vitest';

import type { FeatureId, Specimen } from '../data/schema';
import { applyExamination, type ExaminationResult } from '../src/game/examination';
import { candidateSpecies, candidatesGivenObservations } from '../src/game/scoring';
import { generateSpecimen } from '../src/game/specimen';
import { makeRng } from '../src/game/rng';
import {
  CHANTERELLE,
  CHANTERELLE_SET,
  JACK_O_LANTERN,
  SMOOTH_CHANTERELLE,
  SPECIES_INDEX,
} from './fixtures';

const IN_SITU = { age: 'mature', weathering: 0, snapChance: 0, detachedChance: 0 } as const;

function examine(specimen: Specimen, features: readonly FeatureId[]): ExaminationResult[] {
  return features.map((feature) => applyExamination(specimen, feature));
}

function candidates(specimen: Specimen, features: readonly FeatureId[]): string[] {
  return candidatesGivenObservations(examine(specimen, features), CHANTERELLE_SET, SPECIES_INDEX);
}

describe('candidatesGivenObservations', () => {
  it('leaves every member standing before anything is examined', () => {
    const specimen = generateSpecimen(JACK_O_LANTERN, makeRng(1), IN_SITU);
    expect(candidates(specimen, [])).toEqual(CHANTERELLE_SET.memberSpeciesIds);
  });

  it('narrows to the jack-o-lantern once the substrate and hymenium are seen', () => {
    const specimen = generateSpecimen(JACK_O_LANTERN, makeRng(2), IN_SITU);
    expect(candidates(specimen, ['hymenium.type', 'substrate'])).toEqual([JACK_O_LANTERN.id]);
  });

  it('separates the two chanterelles on the character that actually separates them', () => {
    const ridged = generateSpecimen(CHANTERELLE, makeRng(3), IN_SITU);
    expect(candidates(ridged, ['hymenium.type'])).toEqual([CHANTERELLE.id]);

    const smooth = generateSpecimen(SMOOTH_CHANTERELLE, makeRng(4), IN_SITU);
    expect(candidates(smooth, ['hymenium.type'])).toEqual([SMOOTH_CHANTERELLE.id]);
  });

  it('treats not-applicable as evidence — the smooth chanterelle has no gill edge to read', () => {
    const smooth = generateSpecimen(SMOOTH_CHANTERELLE, makeRng(5), IN_SITU);
    const result = applyExamination(smooth, 'gills.edge');
    expect(result.status).toBe('not-applicable');
    expect(candidates(smooth, ['gills.edge'])).toEqual([SMOOTH_CHANTERELLE.id]);
  });

  it('does not narrow on a red herring whose members carry an identical value', () => {
    const specimen = generateSpecimen(CHANTERELLE, makeRng(6), IN_SITU);
    const identical = CHANTERELLE_SET.redHerrings.filter((herring) => {
      const sets = CHANTERELLE_SET.memberSpeciesIds.map((id) =>
        [...(SPECIES_INDEX[id]?.features[herring] ?? [])].sort().join('|'),
      );
      return new Set(sets).size === 1;
    });
    expect(identical).toEqual(['gills.attachment', 'stem.base', 'flesh.section', 'bruising']);

    for (const herring of identical) {
      expect(candidates(specimen, [herring])).toEqual(CHANTERELLE_SET.memberSpeciesIds);
    }
  });

  /**
   * The asymmetry trap, one level below the one the validator checks. A red
   * herring is validated on species value sets *overlapping*; the player sees a
   * single realised value. Where the sets overlap without being identical, the
   * character narrows in one direction and not the other — and getting this
   * backwards is the dangerous inference the teaching note is about.
   */
  it('narrows one way only on growth habit, which is a red herring by overlap', () => {
    const clustered = generateSpecimen(JACK_O_LANTERN, makeRng(11), IN_SITU);
    expect(clustered.observedFeatures['growth.habit']).toBe('clustered');
    expect(candidates(clustered, ['growth.habit'])).toEqual(CHANTERELLE_SET.memberSpeciesIds);

    const solitary: Specimen = {
      ...clustered,
      observedFeatures: { ...clustered.observedFeatures, 'growth.habit': 'solitary' },
    };
    expect(candidates(solitary, ['growth.habit'])).toEqual([CHANTERELLE.id, SMOOTH_CHANTERELLE.id]);
  });

  it('narrows nothing on an unavailable reading, however much it cost', () => {
    const weathered = generateSpecimen(JACK_O_LANTERN, makeRng(7), {
      age: 'mature',
      weathering: 0.95,
      snapChance: 0,
      detachedChance: 0,
    });
    const result = applyExamination(weathered, 'spore.print');
    expect(result.status).toBe('unavailable');
    expect(result.actionCost).toBeGreaterThan(0);
    expect(
      candidatesGivenObservations([result], CHANTERELLE_SET, SPECIES_INDEX),
    ).toEqual(CHANTERELLE_SET.memberSpeciesIds);
  });

  it('survives the buried-root trap instead of deleting the right answer', () => {
    // A jack-o'-lantern fruiting from a buried root reads as growing from soil.
    // Strict elimination would drop it from the panel on that one character and
    // leave the player looking at two chanterelles.
    const trapped = generateSpecimen(JACK_O_LANTERN, makeRng(8), {
      ...IN_SITU,
      substrateOverride: 'soil-mycorrhizal',
    });
    expect(trapped.observedFeatures.substrate).toBe('soil-mycorrhizal');

    expect(candidates(trapped, ['substrate'])).not.toContain(JACK_O_LANTERN.id);
    expect(candidates(trapped, ['substrate', 'hymenium.type', 'odor'])).toEqual([
      JACK_O_LANTERN.id,
    ]);
  });

  it('is not candidateSpecies — that one answers before the player has looked', () => {
    const specimen = generateSpecimen(JACK_O_LANTERN, makeRng(9), IN_SITU);
    expect(candidateSpecies(specimen, CHANTERELLE_SET, SPECIES_INDEX)).toEqual([
      JACK_O_LANTERN.id,
    ]);
    expect(candidates(specimen, [])).toHaveLength(CHANTERELLE_SET.memberSpeciesIds.length);
  });

  it('returns nothing when no member of the set is in the index', () => {
    const specimen = generateSpecimen(CHANTERELLE, makeRng(10), IN_SITU);
    expect(candidatesGivenObservations(examine(specimen, ['odor']), CHANTERELLE_SET, {})).toEqual(
      [],
    );
  });
});
