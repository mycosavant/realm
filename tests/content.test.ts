import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { ConfusionSet, Species } from '../data/schema';
import {
  loadContent,
  report,
  validateAll,
  validateConfusionSet,
  validateForay,
  validateSpecies,
  type Issue,
} from '../scripts/validate-species';
import {
  AUGUST_FORAY,
  CHANTERELLE,
  CHANTERELLE_SET,
  JACK_O_LANTERN,
  SMOOTH_CHANTERELLE,
} from './fixtures';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const content = loadContent(dataDir);
const issues = validateAll(content);

const SPECIES_FILE = `species/${CHANTERELLE.id}.json`;

const errors = (found: Issue[]) => found.filter((issue) => issue.level === 'error');
const messages = (found: Issue[]) => found.map((issue) => issue.message).join('\n');

const speciesIndex = new Map<string, Species>([
  [CHANTERELLE.id, CHANTERELLE],
  [SMOOTH_CHANTERELLE.id, SMOOTH_CHANTERELLE],
  [JACK_O_LANTERN.id, JACK_O_LANTERN],
]);

const confusionSetIndex = new Map<string, ConfusionSet>([[CHANTERELLE_SET.id, CHANTERELLE_SET]]);

describe('shipped content', () => {
  it('is structurally valid', () => {
    expect(messages(errors(issues))).toBe('');
  });

  it('is entirely unreviewed — Claude never signs off on content', () => {
    const unreviewed = issues.filter((issue) => issue.level === 'unreviewed');
    expect(unreviewed.map((issue) => issue.file).sort()).toEqual([
      'species/cantharellus-appalachiensis.json',
      'species/cantharellus-lateritius.json',
      'species/omphalotus-illudens.json',
    ]);
  });

  it('passes in normal mode and fails the release gate while unreviewed', () => {
    expect(report(issues, false).exitCode).toBe(0);
    expect(report(issues, true).exitCode).toBe(1);
    expect(report(issues, true).text).toMatch(/no unreviewed taxon ships/);
  });

  it('states the toxin mechanism for the toxic member of the set', () => {
    expect(JACK_O_LANTERN.foragingStatus).toBe('toxic');
    expect(JACK_O_LANTERN.toxinNotes).toMatch(/illudin/i);
  });

  it('leaves the dangerous pair unresolved by spore print', () => {
    // The safety claim in the teaching note, pinned. The print isolates the
    // smooth chanterelle from everything, and is silent on exactly the pairing
    // a forager is most likely to be holding: dull orange chanterelle against
    // jack-o'-lantern. If a data edit ever makes the print decisive there, the
    // teaching note becomes a lie and this fails.
    const print = (species: Species) => new Set(species.features['spore.print'] ?? []);
    const overlaps = (a: Set<string>, b: Set<string>) => [...a].some((value) => b.has(value));

    expect(overlaps(print(CHANTERELLE), print(JACK_O_LANTERN))).toBe(true);
    expect(overlaps(print(SMOOTH_CHANTERELLE), print(CHANTERELLE))).toBe(false);
    expect(overlaps(print(SMOOTH_CHANTERELLE), print(JACK_O_LANTERN))).toBe(false);
  });

  it('has no edibility verdict anywhere in the data', () => {
    for (const entry of content.species) {
      expect(Object.keys(entry.data as object)).not.toContain('edible');
    }
  });
});

describe('validateSpecies', () => {
  const valid = () => structuredClone(CHANTERELLE) as unknown as Record<string, unknown>;

  it('accepts the shipped chanterelle', () => {
    expect(errors(validateSpecies(valid(), SPECIES_FILE))).toEqual([]);
  });

  it('rejects a feature value outside the vocabulary', () => {
    const broken = valid();
    (broken.features as Record<string, string[]>)['spore.print'] = ['chartreuse'];
    expect(messages(errors(validateSpecies(broken, SPECIES_FILE)))).toMatch(
      /outside the vocabulary/,
    );
  });

  it('rejects an unknown feature id', () => {
    const broken = valid();
    (broken.features as Record<string, string[]>)['cap.colour'] = ['orange'];
    expect(messages(errors(validateSpecies(broken, SPECIES_FILE)))).toMatch(
      /unknown feature/,
    );
  });

  it('rejects an `edible` field outright', () => {
    const broken = valid();
    broken.edible = true;
    expect(messages(errors(validateSpecies(broken, SPECIES_FILE)))).toMatch(
      /forbidden/,
    );
  });

  it('requires toxin notes on anything toxic or deadly', () => {
    const broken = valid();
    broken.foragingStatus = 'deadly';
    expect(messages(errors(validateSpecies(broken, SPECIES_FILE)))).toMatch(
      /requires toxinNotes/,
    );
  });

  it('requires the id to match the filename', () => {
    expect(messages(errors(validateSpecies(valid(), 'species/something-else.json')))).toMatch(
      /does not match the filename/,
    );
  });

  it('requires sources and a date once a reviewer signs off', () => {
    const signed = valid();
    signed.review = { reviewedBy: 'A. Mycologist', reviewedOn: 'last tuesday', sources: [] };
    const found = messages(errors(validateSpecies(signed, SPECIES_FILE)));
    expect(found).toMatch(/YYYY-MM-DD/);
    expect(found).toMatch(/at least one source/);
  });

  it('stops reporting UNREVIEWED once a reviewer signs off', () => {
    const signed = valid();
    signed.review = {
      reviewedBy: 'A. Mycologist',
      reviewedOn: '2026-08-01',
      sources: ['Kuo, M. (2015). MushroomExpert.Com'],
    };
    const found = validateSpecies(signed, SPECIES_FILE);
    expect(found).toEqual([]);
  });

  it('rejects a phenology outside the calendar', () => {
    const broken = valid();
    broken.phenology = { startMonth: 0, endMonth: 13 };
    const found = messages(errors(validateSpecies(broken, SPECIES_FILE)));
    expect(found).toMatch(/phenology.startMonth/);
    expect(found).toMatch(/phenology.endMonth/);
  });
});

describe('validateConfusionSet', () => {
  const file = 'confusion-sets/chanterelle-vs-jack-o-lantern.json';
  const valid = () => structuredClone(CHANTERELLE_SET) as unknown as Record<string, unknown>;

  it('accepts the shipped set', () => {
    expect(errors(validateConfusionSet(valid(), speciesIndex, file))).toEqual([]);
  });

  it('rejects a discriminator that discriminates nothing', () => {
    const broken = valid();
    // All three species have decurrent hymenia — that is the whole lesson.
    (broken.discriminators as string[]).push('gills.attachment');
    (broken.redHerrings as string[]) = (broken.redHerrings as string[]).filter(
      (feature) => feature !== 'gills.attachment',
    );
    expect(messages(errors(validateConfusionSet(broken, speciesIndex, file)))).toMatch(
      /separates no pair/,
    );
  });

  it('rejects a red herring that separates only some pairs', () => {
    const broken = valid();
    // Odor tells a jack-o'-lantern from either chanterelle while saying nothing
    // about which chanterelle. Separating *some* pairs is still real
    // information — it is a discriminator, and the weaker "overlaps at least
    // one pair" rule let it hide here once the set grew past two members.
    (broken.redHerrings as string[]).push('odor');
    (broken.discriminators as string[]) = (broken.discriminators as string[]).filter(
      (feature) => feature !== 'odor',
    );
    expect(messages(errors(validateConfusionSet(broken, speciesIndex, file)))).toMatch(
      /it is a discriminator/,
    );
  });

  it('rejects a red herring that some members do not define', () => {
    const thin = structuredClone(SMOOTH_CHANTERELLE);
    delete thin.features.bruising;
    const index = new Map(speciesIndex).set(thin.id, thin);
    expect(messages(errors(validateConfusionSet(valid(), index, file)))).toMatch(
      /a character some members lack is a character that separates them/,
    );
  });

  it('rejects a feature listed as both discriminator and red herring', () => {
    const broken = valid();
    (broken.redHerrings as string[]).push('substrate');
    expect(messages(errors(validateConfusionSet(broken, speciesIndex, file)))).toMatch(
      /both a discriminator and a red herring/,
    );
  });

  it('rejects a member species that does not exist', () => {
    const broken = valid();
    (broken.memberSpeciesIds as string[]).push('cantharellus-imaginarius');
    expect(messages(errors(validateConfusionSet(broken, speciesIndex, file)))).toMatch(
      /unknown species/,
    );
  });

  it('requires a member to define every discriminator', () => {
    const thin = structuredClone(CHANTERELLE);
    delete thin.features.odor;
    const index = new Map(speciesIndex).set(thin.id, thin);
    expect(messages(errors(validateConfusionSet(valid(), index, file)))).toMatch(
      /every member must define every discriminator/,
    );
  });

  it('rejects a set with fewer than two members', () => {
    const broken = valid();
    broken.memberSpeciesIds = [CHANTERELLE.id];
    expect(messages(errors(validateConfusionSet(broken, speciesIndex, file)))).toMatch(
      /at least two species/,
    );
  });
});

describe('validateForay', () => {
  const file = 'forays/appalachian-august.json';
  const valid = () => structuredClone(AUGUST_FORAY) as unknown as Record<string, unknown>;
  const check = (raw: Record<string, unknown>, name = file) =>
    messages(errors(validateForay(raw, speciesIndex, confusionSetIndex, name)));

  type Weight = { speciesId: string; weight: number };
  type Trap = { speciesId: string; presentsSubstrate: string; chance: number; designNote: string };
  const weights = (raw: Record<string, unknown>) => raw.speciesWeights as Weight[];
  const traps = (raw: Record<string, unknown>) => raw.traps as Trap[];

  it('accepts the shipped foray', () => {
    expect(errors(validateForay(valid(), speciesIndex, confusionSetIndex, file))).toEqual([]);
  });

  it('requires the id to match the filename', () => {
    expect(check(valid(), 'forays/something-else.json')).toMatch(/does not match the filename/);
  });

  it('rejects a month outside the calendar', () => {
    const broken = valid();
    broken.month = 13;
    expect(check(broken)).toMatch(/month must be an integer/);
  });

  it('rejects an unknown confusion set', () => {
    const broken = valid();
    broken.confusionSetId = 'amanita-vs-agaricus';
    expect(check(broken)).toMatch(/unknown confusion set/);
  });

  it('rejects a species that is not a member of the named set', () => {
    const broken = valid();
    weights(broken).push({ speciesId: 'morchella-americana', weight: 1 });
    // Unknown to the index as well as to the set — the first check fires.
    expect(check(broken)).toMatch(/unknown species/);
  });

  it('rejects a species that does not fruit in the foray month', () => {
    const broken = valid();
    // The Appalachian chanterelle stops at August; a September foray that still
    // weights it is a file asserting something the engine will drop.
    broken.month = 9;
    expect(check(broken)).toMatch(/does not fruit in month 9/);
  });

  it('rejects dropping a member that the month puts in the woods', () => {
    // The dangerous one. Quietly leaving the toxic species out of an August
    // foray gives a patch where every specimen is edible, and the file reads
    // like an ordinary curriculum.
    const broken = valid();
    broken.speciesWeights = weights(broken).filter((w) => w.speciesId !== JACK_O_LANTERN.id);
    broken.traps = [];
    expect(check(broken)).toMatch(/never because the author did/);
  });

  it('accepts covering fewer members when the month is the reason', () => {
    // June: both chanterelles, no jack-o'-lantern, and that is honest.
    const june = valid();
    june.month = 6;
    june.speciesWeights = [
      { speciesId: CHANTERELLE.id, weight: 1 },
      { speciesId: SMOOTH_CHANTERELLE.id, weight: 1 },
    ];
    june.traps = [];
    expect(check(june)).toBe('');
  });

  it('rejects a foray that can only spawn one species', () => {
    const broken = valid();
    broken.month = 6;
    broken.speciesWeights = [{ speciesId: CHANTERELLE.id, weight: 1 }];
    broken.traps = [];
    expect(check(broken)).toMatch(/one species is a specimen, not a confusion/);
  });

  it('rejects a zero weight, which is an omission dressed as inclusion', () => {
    const broken = valid();
    weights(broken)[2].weight = 0;
    expect(check(broken)).toMatch(/must be a positive number/);
  });

  it('rejects the same species weighted twice', () => {
    const broken = valid();
    weights(broken).push({ speciesId: CHANTERELLE.id, weight: 5 });
    expect(check(broken)).toMatch(/twice/);
  });

  it('rejects a trap on a species this foray does not spawn', () => {
    const broken = valid();
    traps(broken)[0].speciesId = SMOOTH_CHANTERELLE.id;
    broken.speciesWeights = weights(broken).filter((w) => w.speciesId !== SMOOTH_CHANTERELLE.id);
    expect(check(broken)).toMatch(/which this foray does not spawn/);
  });

  it('rejects a trap that presents a substrate the species really grows on', () => {
    const broken = valid();
    traps(broken)[0].presentsSubstrate = 'hardwood-dead';
    expect(check(broken)).toMatch(/it is a no-op/);
  });

  it('rejects a trap that counterfeits nobody', () => {
    const broken = valid();
    // Nothing in this foray grows on conifer, so an individual presenting it
    // is not impersonating a member of the set — it is just noise.
    traps(broken)[0].presentsSubstrate = 'conifer';
    expect(check(broken)).toMatch(/has to counterfeit somebody/);
  });

  it('rejects a substrate outside the vocabulary', () => {
    const broken = valid();
    traps(broken)[0].presentsSubstrate = 'astroturf';
    expect(check(broken)).toMatch(/presentsSubstrate must be one of/);
  });

  it('rejects a trap chance outside (0, 1]', () => {
    const broken = valid();
    traps(broken)[0].chance = 0;
    expect(check(broken)).toMatch(/a zero-chance trap is a comment/);
  });

  it('requires a design note on the foray and on every trap', () => {
    const broken = valid();
    broken.designNote = '';
    traps(broken)[0].designNote = '   ';
    const found = check(broken);
    expect(found).toMatch(/designNote is required — every number/);
    expect(found).toMatch(/asserts how often this happens in the woods/);
  });
});
