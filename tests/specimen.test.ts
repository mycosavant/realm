import { describe, expect, it } from 'vitest';

import { FEATURE_VALUES, type FeatureId } from '../data/schema';
import { makeRng } from '../src/game/rng';
import { availableFeatures, generateSpecimen, isAvailable } from '../src/game/specimen';
import { CHANTERELLE, FIXTURE_DESTROYING_ANGEL, FIXTURE_MOREL, JACK_O_LANTERN } from './fixtures';

const seeds = Array.from({ length: 200 }, (_, i) => i + 1);

describe('generateSpecimen', () => {
  it('is deterministic for a seed', () => {
    const a = generateSpecimen(CHANTERELLE, makeRng(42));
    const b = generateSpecimen(CHANTERELLE, makeRng(42));
    expect(a).toEqual(b);
  });

  it('produces different individuals from different seeds', () => {
    const individuals = seeds.map((seed) => generateSpecimen(CHANTERELLE, makeRng(seed)));
    const shapes = new Set(
      individuals.map((s) => `${s.age}:${s.unavailableFeatures.join(',')}`),
    );
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('realises exactly the features the taxon defines, with legal values', () => {
    for (const seed of seeds) {
      const specimen = generateSpecimen(JACK_O_LANTERN, makeRng(seed));
      const defined = Object.keys(JACK_O_LANTERN.features).sort();
      expect(Object.keys(specimen.observedFeatures).sort()).toEqual(defined);
      for (const [feature, value] of Object.entries(specimen.observedFeatures)) {
        expect(JACK_O_LANTERN.features[feature as FeatureId]).toContain(value);
        expect(FEATURE_VALUES[feature as FeatureId]).toContain(value);
      }
    }
  });

  it('never marks a feature unavailable that the taxon does not have', () => {
    for (const seed of seeds) {
      const specimen = generateSpecimen(FIXTURE_MOREL, makeRng(seed), { detachedChance: 1 });
      for (const feature of specimen.unavailableFeatures) {
        expect(Object.keys(FIXTURE_MOREL.features)).toContain(feature);
      }
      expect(specimen.unavailableFeatures).not.toContain('gills.attachment');
    }
  });

  it("does not expose a button Amanita's gill attachment", () => {
    for (const seed of seeds) {
      const specimen = generateSpecimen(FIXTURE_DESTROYING_ANGEL, makeRng(seed), { age: 'button' });
      expect(specimen.unavailableFeatures).toContain('gills.attachment');
      expect(isAvailable(specimen, 'gills.attachment')).toBe(false);
      // A closed button hides the whole hymenium, and has no ring or spores yet.
      // This is the lesson that makes "cut it in half" the only move.
      expect(availableFeatures(specimen)).not.toContain('hymenium.type');
      expect(availableFeatures(specimen)).not.toContain('spore.print');
      expect(availableFeatures(specimen)).not.toContain('stem.ring');
      expect(availableFeatures(specimen)).toContain('flesh.section');
    }
  });

  it('does not expose a ring on anything weathered past 0.7', () => {
    for (const seed of seeds) {
      const specimen = generateSpecimen(FIXTURE_DESTROYING_ANGEL, makeRng(seed), {
        age: 'mature',
        weathering: 0.71,
      });
      expect(specimen.unavailableFeatures).toContain('stem.ring');
      expect(isAvailable(specimen, 'stem.ring')).toBe(false);
    }
  });

  it('keeps the ring readable just below the threshold', () => {
    const specimen = generateSpecimen(FIXTURE_DESTROYING_ANGEL, makeRng(7), {
      age: 'mature',
      weathering: 0.69,
      snapChance: 0,
      detachedChance: 0,
    });
    expect(isAvailable(specimen, 'stem.ring')).toBe(true);
  });

  it('washes the odor out of a rained-on specimen', () => {
    const dry = generateSpecimen(CHANTERELLE, makeRng(3), { age: 'mature', weathering: 0.1 });
    const soaked = generateSpecimen(CHANTERELLE, makeRng(3), { age: 'mature', weathering: 0.5 });
    expect(isAvailable(dry, 'odor')).toBe(true);
    expect(isAvailable(soaked, 'odor')).toBe(false);
  });

  it('gives up everything on a fresh, undamaged, in-situ individual', () => {
    const specimen = generateSpecimen(CHANTERELLE, makeRng(11), {
      age: 'mature',
      weathering: 0,
      snapChance: 0,
      detachedChance: 0,
    });
    expect(specimen.unavailableFeatures).toEqual([]);
    expect(availableFeatures(specimen).sort()).toEqual(Object.keys(CHANTERELLE.features).sort());
  });

  it('loses substrate and growth habit when found off its substrate', () => {
    const specimen = generateSpecimen(CHANTERELLE, makeRng(5), {
      age: 'mature',
      weathering: 0,
      detachedChance: 1,
    });
    expect(specimen.unavailableFeatures).toContain('substrate');
    expect(specimen.unavailableFeatures).toContain('growth.habit');
  });

  it('presents an overridden substrate — the buried-root trap', () => {
    const specimen = generateSpecimen(JACK_O_LANTERN, makeRng(9), {
      age: 'mature',
      weathering: 0,
      snapChance: 0,
      detachedChance: 0,
      substrateOverride: 'soil-mycorrhizal',
    });
    expect(specimen.observedFeatures.substrate).toBe('soil-mycorrhizal');
    expect(specimen.substrateOverride).toBe('soil-mycorrhizal');
    // Growth habit does NOT rescue you here. Both chanterelles cluster too, so
    // a clustered specimen apparently rising from soil is consistent with all
    // three. The underside and the smell are what settle it.
    expect(specimen.observedFeatures['growth.habit']).toBe('clustered');
    expect(specimen.observedFeatures['hymenium.type']).toBe('gills');
    expect(specimen.observedFeatures.odor).toBe('none');
  });

  it('clamps weathering into 0..1', () => {
    expect(generateSpecimen(CHANTERELLE, makeRng(1), { weathering: 4 }).weathering).toBe(1);
    expect(generateSpecimen(CHANTERELLE, makeRng(1), { weathering: -4 }).weathering).toBe(0);
    for (const seed of seeds) {
      const { weathering } = generateSpecimen(CHANTERELLE, makeRng(seed));
      expect(weathering).toBeGreaterThanOrEqual(0);
      expect(weathering).toBeLessThanOrEqual(1);
    }
  });

  it('ages buttons less than past-prime individuals', () => {
    const weatherings = (age: 'button' | 'past-prime') =>
      seeds.map((seed) => generateSpecimen(CHANTERELLE, makeRng(seed), { age }).weathering);
    expect(Math.max(...weatherings('button'))).toBeLessThan(Math.min(...weatherings('past-prime')));
  });
});
