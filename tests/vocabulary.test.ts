import { describe, expect, it } from 'vitest';

import {
  FEATURE_IDS,
  FEATURE_LABELS,
  FEATURE_VALUES,
  VALUE_LABELS,
  valueLabel,
  type FeatureId,
} from '../data/schema';

/**
 * A missing label is a raw identifier on screen — `soil-mycorrhizal` or
 * `blunt-forking` in front of a beginner, possibly a child. A label for a value
 * that no longer exists is a quieter failure: the vocabulary moved and the
 * prose did not, so the check runs both ways.
 */
describe('VALUE_LABELS covers the controlled vocabulary', () => {
  it.each(FEATURE_IDS)('%s has a label for every value it allows', (feature) => {
    const labelled = Object.keys(VALUE_LABELS[feature]).sort();
    expect(labelled).toEqual([...FEATURE_VALUES[feature]].sort());
  });

  it('labels no value the vocabulary does not allow', () => {
    const orphans = FEATURE_IDS.flatMap((feature) =>
      Object.keys(VALUE_LABELS[feature])
        .filter((value) => !FEATURE_VALUES[feature].includes(value))
        .map((value) => `${feature}.${value}`),
    );
    expect(orphans).toEqual([]);
  });

  it('names every feature too', () => {
    expect(Object.keys(FEATURE_LABELS).sort()).toEqual([...FEATURE_IDS].sort());
  });

  it('has no empty label, and none that just repeats the identifier verbatim', () => {
    const lazy = FEATURE_IDS.flatMap((feature) =>
      Object.entries(VALUE_LABELS[feature])
        .filter(([value, label]) => label.trim() === '' || label === value)
        // Colour words are their own best label: `spore.print: white` reads as
        // "white" and dressing it up would add nothing.
        .filter(([, label]) => !/^(white|cream|pink|brown|black|olive)$/.test(label))
        .map(([value]) => `${feature}.${value}`),
    );
    expect(lazy).toEqual([]);
  });
});

describe('the same value under different characters means different things', () => {
  it('does not collapse none, absent or brown', () => {
    expect(valueLabel('bruising', 'none')).not.toBe(valueLabel('odor', 'none'));
    expect(valueLabel('stem.base', 'absent')).not.toBe(valueLabel('stem.ring', 'absent'));
    expect(valueLabel('spore.print', 'brown')).not.toBe(valueLabel('bruising', 'brown'));
  });

  it('finds every value shared across characters, so a new collision is caught', () => {
    const owners = new Map<string, FeatureId[]>();
    for (const feature of FEATURE_IDS) {
      for (const value of FEATURE_VALUES[feature]) {
        owners.set(value, [...(owners.get(value) ?? []), feature]);
      }
    }
    const shared = [...owners.entries()].filter(([, features]) => features.length > 1);

    // Exactly three today. If this list grows, the new collision needs a
    // distinct label under each character that claims it.
    expect(shared.map(([value]) => value).sort()).toEqual(['absent', 'brown', 'none']);

    for (const [value, features] of shared) {
      const labels = features.map((feature) => valueLabel(feature, value));
      expect(new Set(labels).size, `"${value}" reads identically under ${features.join(' and ')}`)
        .toBe(features.length);
    }
  });
});

describe('valueLabel', () => {
  it('falls back to the raw value rather than throwing', () => {
    expect(valueLabel('odor', 'petrichor')).toBe('petrichor');
  });
});
