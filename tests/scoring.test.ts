import { describe, expect, it } from 'vitest';

import type { FeatureId, IdAttempt } from '../data/schema';
import { makeRng } from '../src/game/rng';
import {
  candidateSpecies,
  grade,
  XP_FULL,
  XP_LUCKY_GUESS,
  XP_RIGHT_WITHOUT_GROUNDS,
  XP_UNNECESSARY_DECLINE,
} from '../src/game/scoring';
import { generateSpecimen } from '../src/game/specimen';
import {
  CHANTERELLE,
  CHANTERELLE_SET,
  FIXTURE_AMANITA_SET,
  FIXTURE_DESTROYING_ANGEL,
  FIXTURE_INDEX,
  JACK_O_LANTERN,
  SPECIES_INDEX,
} from './fixtures';

const IN_SITU = { age: 'mature', weathering: 0, snapChance: 0, detachedChance: 0 } as const;

const chanterelle = () => generateSpecimen(CHANTERELLE, makeRng(11), IN_SITU);
const jack = () => generateSpecimen(JACK_O_LANTERN, makeRng(12), IN_SITU);

/** A closed button, knocked loose from wherever it grew. Nothing left to key on. */
const uselessButton = () =>
  generateSpecimen(CHANTERELLE, makeRng(13), {
    age: 'button',
    weathering: 0.5,
    snapChance: 0,
    detachedChance: 1,
  });

const attempt = (
  specimenId: string,
  featuresChecked: FeatureId[],
  answer: IdAttempt['answer'],
): IdAttempt => ({ specimenId, featuresChecked, answer });

const id = (speciesId: string) => ({ kind: 'species', speciesId }) as const;
const declined = { kind: 'declined' } as const;

describe('candidateSpecies', () => {
  it('resolves a well-presented individual to one member', () => {
    expect(candidateSpecies(chanterelle(), CHANTERELLE_SET, SPECIES_INDEX)).toEqual([
      CHANTERELLE.id,
    ]);
  });

  it('leaves the whole set standing when nothing can be checked', () => {
    expect(candidateSpecies(uselessButton(), CHANTERELLE_SET, SPECIES_INDEX)).toEqual(
      CHANTERELLE_SET.memberSpeciesIds,
    );
  });

  it('still resolves a jack-o-lantern that appears to grow from soil', () => {
    const buriedRoot = generateSpecimen(JACK_O_LANTERN, makeRng(14), {
      ...IN_SITU,
      substrateOverride: 'soil-mycorrhizal',
    });
    expect(candidateSpecies(buriedRoot, CHANTERELLE_SET, SPECIES_INDEX)).toEqual([
      JACK_O_LANTERN.id,
    ]);
  });
});

describe('grade — evidence earns the XP', () => {
  it('pays full marks for a correct ID backed by every discriminator', () => {
    const specimen = chanterelle();
    const result = grade(
      attempt(specimen.id, [...CHANTERELLE_SET.discriminators], id(CHANTERELLE.id)),
      CHANTERELLE_SET,
      specimen,
      SPECIES_INDEX,
    );
    expect(result.correct).toBe(true);
    expect(result.evidenceRatio).toBe(1);
    expect(result.xp).toBe(XP_FULL);
    expect(result.missedDiscriminators).toEqual([]);
    expect(result.hardStop).toBeUndefined();
  });

  it('scales XP with evidence above the threshold', () => {
    const specimen = chanterelle();
    const result = grade(
      attempt(
        specimen.id,
        ['hymenium.type', 'growth.habit', 'substrate'],
        id(CHANTERELLE.id),
      ),
      CHANTERELLE_SET,
      specimen,
      SPECIES_INDEX,
    );
    expect(result.evidenceRatio).toBeCloseTo(0.6);
    expect(result.xp).toBe(84);
    expect(result.missedDiscriminators).toEqual(['gills.edge', 'odor']);
  });

  it('pays a correct guess almost nothing and names what went unchecked', () => {
    const specimen = chanterelle();
    const result = grade(
      attempt(specimen.id, ['hymenium.type'], id(CHANTERELLE.id)),
      CHANTERELLE_SET,
      specimen,
      SPECIES_INDEX,
    );
    expect(result.correct).toBe(true);
    expect(result.evidenceRatio).toBeCloseTo(0.2);
    expect(result.xp).toBe(XP_LUCKY_GUESS);
    expect(result.feedback.join(' ')).toMatch(/you guessed it/i);
    expect(result.feedback.join(' ')).toMatch(/gill edge/);
  });

  it('counts an examination that came back empty as evidence gathered', () => {
    const soaked = generateSpecimen(CHANTERELLE, makeRng(15), {
      age: 'mature',
      weathering: 0.5, // odor is gone
      snapChance: 0,
      detachedChance: 0,
    });
    const result = grade(
      attempt(soaked.id, [...CHANTERELLE_SET.discriminators], id(CHANTERELLE.id)),
      CHANTERELLE_SET,
      soaked,
      SPECIES_INDEX,
    );
    expect(result.evidenceRatio).toBe(1);
    expect(result.xp).toBe(XP_FULL);
  });
});

describe('grade — declining', () => {
  it('pays full marks for declining an individual that cannot be resolved', () => {
    const specimen = uselessButton();
    const result = grade(
      attempt(specimen.id, ['flesh.section', 'stem.base'], declined),
      CHANTERELLE_SET,
      specimen,
      SPECIES_INDEX,
    );
    expect(result.underdetermined).toBe(true);
    expect(result.correctlyDeclined).toBe(true);
    expect(result.correct).toBe(false);
    expect(result.xp).toBe(XP_FULL);
    expect(result.feedback.join(' ')).toMatch(/right call/i);
  });

  it('pays little for declining something that was resolvable, and says why', () => {
    const specimen = chanterelle();
    const result = grade(
      attempt(specimen.id, ['hymenium.type'], declined),
      CHANTERELLE_SET,
      specimen,
      SPECIES_INDEX,
    );
    expect(result.correctlyDeclined).toBe(false);
    expect(result.xp).toBe(XP_UNNECESSARY_DECLINE);
    expect(result.feedback.join(' ')).toMatch(/resolvable/i);
    expect(result.feedback.join(' ')).toMatch(/false-ridges/);
  });

  it('treats a right answer on an unresolvable individual as unearned', () => {
    const specimen = uselessButton();
    const result = grade(
      attempt(specimen.id, [...CHANTERELLE_SET.discriminators], id(CHANTERELLE.id)),
      CHANTERELLE_SET,
      specimen,
      SPECIES_INDEX,
    );
    expect(result.correct).toBe(true);
    expect(result.xp).toBe(XP_RIGHT_WITHOUT_GROUNDS);
    expect(result.feedback.join(' ')).toMatch(/could not have told you/i);
  });
});

describe('grade — being wrong', () => {
  it('stops the run when an edible call is made on a toxic specimen', () => {
    const specimen = jack();
    const result = grade(
      attempt(specimen.id, ['spore.print', 'gills.attachment'], id(CHANTERELLE.id)),
      CHANTERELLE_SET,
      specimen,
      SPECIES_INDEX,
    );
    expect(result.correct).toBe(false);
    expect(result.xp).toBe(0);
    expect(result.hardStop?.speciesId).toBe(JACK_O_LANTERN.id);
    expect(result.hardStop?.message).toBe(JACK_O_LANTERN.toxinNotes);
    expect(result.feedback.join(' ')).toMatch(/would have told you: gills/);
  });

  it('stops the run for any wrong answer on a deadly specimen', () => {
    const specimen = generateSpecimen(FIXTURE_DESTROYING_ANGEL, makeRng(16), IN_SITU);
    const result = grade(
      attempt(specimen.id, ['gills.attachment'], id('fixture-meadow-mushroom')),
      FIXTURE_AMANITA_SET,
      specimen,
      FIXTURE_INDEX,
    );
    expect(result.xp).toBe(0);
    expect(result.hardStop?.message).toMatch(/amatoxin/i);
  });

  it('names the red herrings the player leaned on', () => {
    const specimen = jack();
    const result = grade(
      attempt(specimen.id, ['spore.print', 'gills.attachment'], id(CHANTERELLE.id)),
      CHANTERELLE_SET,
      specimen,
      SPECIES_INDEX,
    );
    expect(result.evidenceRatio).toBe(0);
    expect(result.feedback.join(' ')).toMatch(/shared across this set/i);
  });
});

describe('grade — a character that lies', () => {
  it('resolves the buried-root jack-o-lantern and flags the misleading substrate', () => {
    const buriedRoot = generateSpecimen(JACK_O_LANTERN, makeRng(17), {
      ...IN_SITU,
      substrateOverride: 'soil-mycorrhizal',
    });
    const result = grade(
      attempt(buriedRoot.id, [...CHANTERELLE_SET.discriminators], id(JACK_O_LANTERN.id)),
      CHANTERELLE_SET,
      buriedRoot,
      SPECIES_INDEX,
    );
    expect(result.underdetermined).toBe(false);
    expect(result.correct).toBe(true);
    expect(result.xp).toBe(XP_FULL);
    expect(result.feedback.join(' ')).toMatch(/does not fit/i);
    expect(result.feedback.join(' ')).toMatch(/substrate/i);
  });
});

describe('grade — degenerate input', () => {
  it('does not divide by zero on a set with no discriminators', () => {
    const specimen = chanterelle();
    const result = grade(
      attempt(specimen.id, [], id(CHANTERELLE.id)),
      { ...CHANTERELLE_SET, discriminators: [] },
      specimen,
      SPECIES_INDEX,
    );
    expect(result.evidenceRatio).toBe(1);
    expect(Number.isFinite(result.xp)).toBe(true);
  });

  it('accepts a Map index as well as a record', () => {
    const specimen = chanterelle();
    const index = new Map(Object.entries(SPECIES_INDEX));
    const result = grade(
      attempt(specimen.id, [...CHANTERELLE_SET.discriminators], id(CHANTERELLE.id)),
      CHANTERELLE_SET,
      specimen,
      index,
    );
    expect(result.xp).toBe(XP_FULL);
  });
});
