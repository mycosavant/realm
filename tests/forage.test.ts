import { describe, expect, it } from 'vitest';

import {
  fruitsInMonth,
  type FeatureId,
  type Foray,
  type Species,
  type Specimen,
} from '../data/schema';
import {
  applyExamination,
  candidatesGivenObservations,
  generatePatch,
  grade,
  makeRng,
} from '../src/game';
import {
  AUGUST_FORAY,
  CHANTERELLE,
  CHANTERELLE_SET,
  JACK_O_LANTERN,
  SMOOTH_CHANTERELLE,
  SPECIES_INDEX,
} from './fixtures';

/** A foray built for one property, so the shipped file stays a fixture. */
function foray(overrides: Partial<Foray>): Foray {
  return {
    id: 'test-foray',
    confusionSetId: CHANTERELLE_SET.id,
    title: 'Test',
    month: 8,
    specimenCount: 8,
    speciesWeights: [
      { speciesId: CHANTERELLE.id, weight: 1 },
      { speciesId: JACK_O_LANTERN.id, weight: 1 },
    ],
    traps: [],
    designNote: 'test',
    ...overrides,
  };
}

const idsIn = (patch: readonly Specimen[]) => new Set(patch.map((s) => s.speciesId));

describe('generatePatch', () => {
  it('reproduces a forest exactly from a seed', () => {
    const a = generatePatch(makeRng(20260804), AUGUST_FORAY, SPECIES_INDEX);
    const b = generatePatch(makeRng(20260804), AUGUST_FORAY, SPECIES_INDEX);
    expect(a).toEqual(b);
  });

  it('produces a different forest from a different seed', () => {
    const a = generatePatch(makeRng(1), AUGUST_FORAY, SPECIES_INDEX);
    const b = generatePatch(makeRng(2), AUGUST_FORAY, SPECIES_INDEX);
    expect(a).not.toEqual(b);
  });

  it('spawns exactly specimenCount individuals', () => {
    const patch = generatePatch(makeRng(7), foray({ specimenCount: 13 }), SPECIES_INDEX);
    expect(patch).toHaveLength(13);
  });

  it('spawns only species the foray weights', () => {
    const patch = generatePatch(makeRng(11), foray({ specimenCount: 60 }), SPECIES_INDEX);
    expect([...idsIn(patch)].sort()).toEqual([CHANTERELLE.id, JACK_O_LANTERN.id].sort());
  });

  it('honours the member ratio', () => {
    const lopsided = foray({
      specimenCount: 200,
      speciesWeights: [
        { speciesId: CHANTERELLE.id, weight: 1 },
        { speciesId: JACK_O_LANTERN.id, weight: 99 },
      ],
    });
    const patch = generatePatch(makeRng(3), lopsided, SPECIES_INDEX);
    const jacks = patch.filter((s) => s.speciesId === JACK_O_LANTERN.id).length;
    expect(jacks).toBeGreaterThan(150);
    expect(jacks).toBeLessThan(200);
  });

  it('throws rather than silently thinning the patch on an unknown species', () => {
    const bad = foray({
      speciesWeights: [{ speciesId: 'cantharellus-imaginarius', weight: 1 }],
    });
    expect(() => generatePatch(makeRng(1), bad, SPECIES_INDEX)).toThrow(/unknown species/);
  });
});

describe('phenology gating', () => {
  // June: both chanterelles are up, the jack-o'-lantern is not (August to
  // November). The engine drops it even though the foray weights it — the
  // validator refuses to let a *file* say this, but the rule belongs to the
  // world, not to the lint.
  it('drops a species that does not fruit in the foray month', () => {
    const june = foray({ month: 6, specimenCount: 40 });
    const patch = generatePatch(makeRng(5), june, SPECIES_INDEX);
    expect(idsIn(patch)).toEqual(new Set([CHANTERELLE.id]));
  });

  it('throws when the month puts nothing in the woods', () => {
    const january = foray({ month: 1 });
    expect(() => generatePatch(makeRng(1), january, SPECIES_INDEX)).toThrow(
      /nothing fruiting in month 1/,
    );
  });

  it('reads a season that wraps the new year', () => {
    const winter = { startMonth: 11, endMonth: 3 };
    expect(fruitsInMonth(winter, 12)).toBe(true);
    expect(fruitsInMonth(winter, 1)).toBe(true);
    expect(fruitsInMonth(winter, 3)).toBe(true);
    expect(fruitsInMonth(winter, 4)).toBe(false);
    expect(fruitsInMonth(winter, 10)).toBe(false);
  });

  it('reads an ordinary season', () => {
    const summer = { startMonth: 6, endMonth: 8 };
    expect(fruitsInMonth(summer, 6)).toBe(true);
    expect(fruitsInMonth(summer, 8)).toBe(true);
    expect(fruitsInMonth(summer, 9)).toBe(false);
    expect(fruitsInMonth(summer, 1)).toBe(false);
  });

  it('puts all three members of the shipped set in the woods in August, and only then', () => {
    // Not a preference — the reason the shipped foray is an August foray. The
    // window in which a forager can be confused by all three is one month wide.
    const members = [CHANTERELLE, SMOOTH_CHANTERELLE, JACK_O_LANTERN];
    const monthsWithAllThree = Array.from({ length: 12 }, (_, i) => i + 1).filter((month) =>
      members.every((species) => fruitsInMonth(species.phenology, month)),
    );
    expect(monthsWithAllThree).toEqual([8]);
  });
});

describe('the buried-root trap', () => {
  const alwaysTrapped = foray({
    specimenCount: 20,
    speciesWeights: [{ speciesId: JACK_O_LANTERN.id, weight: 1 }],
    traps: [
      {
        speciesId: JACK_O_LANTERN.id,
        presentsSubstrate: 'soil-mycorrhizal',
        chance: 1,
        designNote: 'test',
      },
    ],
  });

  it('makes the individual genuinely present the counterfeit substrate', () => {
    const patch = generatePatch(makeRng(13), alwaysTrapped, SPECIES_INDEX);
    expect(patch).toHaveLength(20);
    for (const specimen of patch) {
      expect(specimen.substrateOverride).toBe('soil-mycorrhizal');
      expect(specimen.observedFeatures.substrate).toBe('soil-mycorrhizal');
    }
  });

  it('leaves the individual untrapped at chance 0', () => {
    // The validator forbids writing this, and the engine still has to mean it.
    const never = foray({
      specimenCount: 20,
      speciesWeights: [{ speciesId: JACK_O_LANTERN.id, weight: 1 }],
      traps: [
        {
          speciesId: JACK_O_LANTERN.id,
          presentsSubstrate: 'soil-mycorrhizal',
          chance: 0,
          designNote: 'test',
        },
      ],
    });
    const patch = generatePatch(makeRng(13), never, SPECIES_INDEX);
    for (const specimen of patch) {
      expect(specimen.substrateOverride).toBeUndefined();
      expect(JACK_O_LANTERN.features.substrate).toContain(specimen.observedFeatures.substrate);
    }
  });

  it('traps only the species named', () => {
    const mixed = foray({
      specimenCount: 60,
      traps: [
        {
          speciesId: JACK_O_LANTERN.id,
          presentsSubstrate: 'soil-mycorrhizal',
          chance: 1,
          designNote: 'test',
        },
      ],
    });
    const patch = generatePatch(makeRng(17), mixed, SPECIES_INDEX);
    const chanterelles = patch.filter((s) => s.speciesId === CHANTERELLE.id);
    expect(chanterelles.length).toBeGreaterThan(0);
    for (const specimen of chanterelles) {
      expect(specimen.substrateOverride).toBeUndefined();
    }
  });

  /** The first trapped individual across seeds that satisfies `wanted`. */
  function findTrapped(wanted: (specimen: Specimen) => boolean): Specimen {
    for (let seed = 0; seed < 40; seed += 1) {
      const found = generatePatch(makeRng(seed), alwaysTrapped, SPECIES_INDEX).find(wanted);
      if (found) return found;
    }
    throw new Error('no trapped specimen matching the predicate in 40 forays');
  }

  const readable = (specimen: Specimen, ...features: FeatureId[]) =>
    features.every((feature) => !specimen.unavailableFeatures.includes(feature));

  it('costs the player the substrate character, and only that character', () => {
    const specimen = findTrapped((candidate) =>
      readable(candidate, 'substrate', 'hymenium.type', 'odor'),
    );

    // One look at the substrate, read correctly, and the shortlist has deleted
    // the species the player is actually holding — the toxic one.
    const substrateOnly = [applyExamination(specimen, 'substrate')];
    expect(substrateOnly[0].value).toBe('soil-mycorrhizal');
    expect(
      candidatesGivenObservations(substrateOnly, CHANTERELLE_SET, SPECIES_INDEX),
    ).not.toContain(JACK_O_LANTERN.id);

    // The underside and the smell get it back, which is what the teaching note
    // says they do. Nothing about the way it grows would have.
    const withUnderside = [
      ...substrateOnly,
      applyExamination(specimen, 'hymenium.type'),
      applyExamination(specimen, 'odor'),
    ];
    expect(candidatesGivenObservations(withUnderside, CHANTERELLE_SET, SPECIES_INDEX)).toEqual([
      JACK_O_LANTERN.id,
    ]);
  });

  it('is unrecoverable on a button, and declining is then the full-credit answer', () => {
    // The recovery above needs the underside, and a button has not opened. What
    // is left is a lying substrate against a truthful odor, one character each
    // way, and the individual genuinely cannot be resolved. Rule 5 covers this:
    // refusing to call it is worth full marks.
    const specimen = findTrapped(
      (candidate) => candidate.age === 'button' && readable(candidate, 'substrate', 'odor'),
    );
    expect(specimen.unavailableFeatures).toContain('hymenium.type');

    const looked = [
      applyExamination(specimen, 'substrate'),
      applyExamination(specimen, 'odor'),
      applyExamination(specimen, 'hymenium.type'),
      applyExamination(specimen, 'spore.print'),
    ];
    expect(candidatesGivenObservations(looked, CHANTERELLE_SET, SPECIES_INDEX)).toHaveLength(3);

    const result = grade(
      {
        specimenId: specimen.id,
        featuresChecked: ['hymenium.type', 'substrate', 'odor', 'spore.print'],
        answer: { kind: 'declined' },
      },
      CHANTERELLE_SET,
      specimen,
      SPECIES_INDEX,
    );
    expect(result.underdetermined).toBe(true);
    expect(result.correctlyDeclined).toBe(true);
    expect(result.xp).toBe(100);
  });

  it('does not stop grade() resolving the individual', () => {
    // grade() applies every reachable discriminator at once rather than one at a
    // time, so the lying character is outvoted. A player who checks all four and
    // says jack-o'-lantern is right, and is told which character lied.
    const specimen = findTrapped((candidate) =>
      readable(candidate, 'substrate', 'hymenium.type', 'odor'),
    );

    const result = grade(
      {
        specimenId: specimen.id,
        featuresChecked: ['hymenium.type', 'substrate', 'odor', 'spore.print'],
        answer: { kind: 'species', speciesId: JACK_O_LANTERN.id },
      },
      CHANTERELLE_SET,
      specimen,
      SPECIES_INDEX,
    );

    expect(result.correct).toBe(true);
    expect(result.candidateSpeciesIds).toEqual([JACK_O_LANTERN.id]);
    expect(result.feedback.join(' ')).toMatch(/A single character can lie/);
  });
});

describe('the shipped August foray', () => {
  const patch = generatePatch(makeRng(20260804), AUGUST_FORAY, SPECIES_INDEX);

  it('puts every member of the set in the woods over a few forays', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 10; seed += 1) {
      for (const specimen of generatePatch(makeRng(seed), AUGUST_FORAY, SPECIES_INDEX)) {
        seen.add(specimen.speciesId);
      }
    }
    expect(seen).toEqual(
      new Set([CHANTERELLE.id, SMOOTH_CHANTERELLE.id, JACK_O_LANTERN.id]),
    );
  });

  it('springs the buried-root trap inside a handful of forays', () => {
    // If the rate ever drops so low that a player never meets one, the trap has
    // stopped being part of the curriculum.
    let trapped = 0;
    for (let seed = 0; seed < 10; seed += 1) {
      trapped += generatePatch(makeRng(seed), AUGUST_FORAY, SPECIES_INDEX).filter(
        (specimen) => specimen.substrateOverride !== undefined,
      ).length;
    }
    expect(trapped).toBeGreaterThan(0);
  });

  it('never counterfeits a substrate onto a chanterelle', () => {
    const species = (id: string): Species | undefined => SPECIES_INDEX[id];
    for (const specimen of patch) {
      if (specimen.substrateOverride === undefined) {
        expect(species(specimen.speciesId)?.features.substrate).toContain(
          specimen.observedFeatures.substrate,
        );
      } else {
        expect(specimen.speciesId).toBe(JACK_O_LANTERN.id);
      }
    }
  });
});
