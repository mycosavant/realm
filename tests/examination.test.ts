import { describe, expect, it } from 'vitest';

import { EXAMINATIONS } from '../data/examinations';
import { applyExamination, recordExamination, totalActionCost } from '../src/game/examination';
import { makeRng } from '../src/game/rng';
import { generateSpecimen } from '../src/game/specimen';
import { CHANTERELLE, FIXTURE_DESTROYING_ANGEL, FIXTURE_MOREL } from './fixtures';

const fresh = () =>
  generateSpecimen(CHANTERELLE, makeRng(11), {
    age: 'mature',
    weathering: 0,
    snapChance: 0,
    detachedChance: 0,
  });

describe('applyExamination', () => {
  it('returns the observed value and charges the action', () => {
    const result = applyExamination(fresh(), 'hymenium.type');
    expect(result).toMatchObject({
      status: 'observed',
      feature: 'hymenium.type',
      value: 'false-ridges',
      actionCost: 0,
      destructive: false,
    });
  });

  it('charges three actions, paper and the specimen for a spore print', () => {
    const result = applyExamination(fresh(), 'spore.print');
    expect(result.status).toBe('observed');
    expect(result.actionCost).toBe(3);
    expect(result.requiresTool).toBe('paper');
    expect(result.destructive).toBe(true);
  });

  it('reports unavailable with a reason, and still charges', () => {
    const button = generateSpecimen(FIXTURE_DESTROYING_ANGEL, makeRng(4), { age: 'button' });
    const result = applyExamination(button, 'gills.attachment');
    expect(result.status).toBe('unavailable');
    expect(result.value).toBeUndefined();
    expect(result.note).toMatch(/button/i);
    expect(result.actionCost).toBe(EXAMINATIONS['gills.attachment'].actionCost);
  });

  it('explains a washed-out odor differently from an unopened button', () => {
    const soaked = generateSpecimen(CHANTERELLE, makeRng(4), { age: 'mature', weathering: 0.9 });
    expect(applyExamination(soaked, 'odor').note).toMatch(/rain/i);
    expect(applyExamination(soaked, 'stem.ring').note).toMatch(/washed/i);
  });

  it('distinguishes "this individual will not show it" from "this taxon has none"', () => {
    const morel = generateSpecimen(FIXTURE_MOREL, makeRng(2), { age: 'mature', weathering: 0 });
    const result = applyExamination(morel, 'gills.attachment');
    expect(result.status).toBe('not-applicable');
    expect(result.note).toMatch(/does not have that character/i);
  });

  it('throws on a feature with no examination defined', () => {
    // @ts-expect-error — guarding the runtime path against bad content
    expect(() => applyExamination(fresh(), 'cap.colour')).toThrow(/No examination defined/);
  });
});

describe('recordExamination', () => {
  it('records a check once, including one that came back empty', () => {
    const button = generateSpecimen(FIXTURE_DESTROYING_ANGEL, makeRng(4), { age: 'button' });
    let checked = recordExamination([], applyExamination(button, 'gills.attachment'));
    checked = recordExamination(checked, applyExamination(button, 'gills.attachment'));
    checked = recordExamination(checked, applyExamination(button, 'stem.base'));
    expect(checked).toEqual(['gills.attachment', 'stem.base']);
  });

  it('does not mutate the list it was given', () => {
    const before: never[] = [];
    recordExamination(before, applyExamination(fresh(), 'substrate'));
    expect(before).toEqual([]);
  });
});

describe('totalActionCost', () => {
  it('charges a repeated examination once', () => {
    const specimen = fresh();
    const results = [
      applyExamination(specimen, 'spore.print'),
      applyExamination(specimen, 'spore.print'),
      applyExamination(specimen, 'flesh.section'),
      applyExamination(specimen, 'substrate'),
    ];
    expect(totalActionCost(results)).toBe(3 + 2 + 0);
  });
});
