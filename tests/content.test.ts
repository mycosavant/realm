import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Species } from '../data/schema';
import {
  loadContent,
  report,
  validateAll,
  validateConfusionSet,
  validateSpecies,
  type Issue,
} from '../scripts/validate-species';
import { CHANTERELLE, CHANTERELLE_SET, JACK_O_LANTERN, SMOOTH_CHANTERELLE } from './fixtures';

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
