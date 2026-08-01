/**
 * Content gate for `data/`.
 *
 * Two tiers, on purpose:
 *   - structural errors always fail, in any mode;
 *   - `review.reviewedBy: null` is reported as UNREVIEWED and fails only under
 *     `--strict`, which is the release gate. Per CLAUDE.md rule 4, that field
 *     is filled in by a human or not at all.
 *
 * Run: `npm run validate` / `npm run validate:strict`
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FEATURE_IDS,
  FEATURE_VALUES,
  FORAGING_STATUSES,
  type ConfusionSet,
  type FeatureId,
  type Species,
} from '../data/schema';

export type IssueLevel = 'error' | 'unreviewed';

export interface Issue {
  level: IssueLevel;
  file: string;
  message: string;
}

export interface ContentFile<T> {
  file: string;
  data: T;
}

export interface Content {
  species: ContentFile<unknown>[];
  confusionSets: ContentFile<unknown>[];
}

const FEATURE_ID_SET = new Set<string>(FEATURE_IDS);
const STATUS_SET = new Set<string>(FORAGING_STATUSES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function basename(file: string): string {
  const name = file.split('/').pop() ?? file;
  return name.replace(/\.json$/, '');
}

export function loadContent(dataDir: string): Content {
  const read = (subdir: string): ContentFile<unknown>[] => {
    const dir = join(dataDir, subdir);
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        const file = `${subdir}/${name}`;
        const text = readFileSync(join(dir, name), 'utf8');
        try {
          return { file, data: JSON.parse(text) as unknown };
        } catch (error) {
          throw new Error(`${file}: invalid JSON — ${(error as Error).message}`);
        }
      });
  };
  return { species: read('species'), confusionSets: read('confusion-sets') };
}

export function validateSpecies(raw: unknown, file: string): Issue[] {
  const issues: Issue[] = [];
  const error = (message: string) => issues.push({ level: 'error', file, message });

  if (!isRecord(raw)) {
    error('not an object');
    return issues;
  }

  if (!isNonEmptyString(raw.id)) error('id is required');
  else if (raw.id !== basename(file)) error(`id "${raw.id}" does not match the filename`);

  if (!isNonEmptyString(raw.scientificName)) error('scientificName is required');
  if (!isStringArray(raw.commonNames) || raw.commonNames.length === 0) {
    error('commonNames must be a non-empty array of strings');
  }
  if (!isNonEmptyString(raw.ecologyNotes)) error('ecologyNotes is required');

  for (const key of ['gbifTaxonKey', 'inatTaxonId'] as const) {
    if (raw[key] !== undefined && !Number.isInteger(raw[key])) {
      error(`${key} must be an integer when present`);
    }
  }

  if ('edible' in raw) {
    error('`edible` is forbidden — see CLAUDE.md non-negotiable 2. The app never renders a verdict.');
  }

  if (!isRecord(raw.features)) {
    error('features is required');
  } else {
    for (const [feature, values] of Object.entries(raw.features)) {
      if (!FEATURE_ID_SET.has(feature)) {
        error(`unknown feature "${feature}"`);
        continue;
      }
      if (!isStringArray(values) || values.length === 0) {
        error(`features["${feature}"] must be a non-empty array of strings`);
        continue;
      }
      const vocabulary = FEATURE_VALUES[feature as FeatureId];
      for (const value of values) {
        if (!vocabulary.includes(value)) {
          error(
            `features["${feature}"] has value "${value}" outside the vocabulary (${vocabulary.join(' | ')})`,
          );
        }
      }
      if (new Set(values).size !== values.length) {
        error(`features["${feature}"] has duplicate values`);
      }
    }
  }

  const status = raw.foragingStatus;
  if (typeof status !== 'string' || !STATUS_SET.has(status)) {
    error(`foragingStatus must be one of ${FORAGING_STATUSES.join(' | ')}`);
  } else if ((status === 'toxic' || status === 'deadly') && !isNonEmptyString(raw.toxinNotes)) {
    error(`foragingStatus "${status}" requires toxinNotes (onset and mechanism)`);
  }

  if (!isRecord(raw.phenology)) {
    error('phenology is required');
  } else {
    for (const key of ['startMonth', 'endMonth'] as const) {
      const month = raw.phenology[key];
      if (!Number.isInteger(month) || (month as number) < 1 || (month as number) > 12) {
        error(`phenology.${key} must be an integer 1..12`);
      }
    }
  }

  if (!isRecord(raw.review)) {
    error('review is required — review is structural, not aspirational');
  } else {
    const { reviewedBy, reviewedOn, sources } = raw.review;
    if (reviewedBy !== null && !isNonEmptyString(reviewedBy)) {
      error('review.reviewedBy must be a name or null');
    }
    if (!Array.isArray(sources)) {
      error('review.sources must be an array');
    }
    if (isNonEmptyString(reviewedBy)) {
      if (!isNonEmptyString(reviewedOn) || !/^\d{4}-\d{2}-\d{2}$/.test(reviewedOn)) {
        error('review.reviewedOn must be YYYY-MM-DD once reviewedBy is set');
      }
      if (!isStringArray(sources) || sources.length === 0) {
        error('a reviewed species must cite at least one source');
      }
    } else {
      issues.push({
        level: 'unreviewed',
        file,
        message: 'review.reviewedBy is null — content is unreviewed and cannot ship',
      });
    }
  }

  return issues;
}

export function validateConfusionSet(
  raw: unknown,
  speciesById: Map<string, Species>,
  file: string,
): Issue[] {
  const issues: Issue[] = [];
  const error = (message: string) => issues.push({ level: 'error', file, message });

  if (!isRecord(raw)) {
    error('not an object');
    return issues;
  }

  if (!isNonEmptyString(raw.id)) error('id is required');
  else if (raw.id !== basename(file)) error(`id "${raw.id}" does not match the filename`);
  if (!isNonEmptyString(raw.teachingNote)) error('teachingNote is required');

  const members = raw.memberSpeciesIds;
  if (!isStringArray(members) || members.length < 2) {
    error('memberSpeciesIds must list at least two species');
    return issues;
  }
  const known: Species[] = [];
  for (const id of members) {
    const species = speciesById.get(id);
    if (!species) error(`unknown species "${id}"`);
    else known.push(species);
  }

  const featureList = (key: 'discriminators' | 'redHerrings'): FeatureId[] => {
    const value = raw[key];
    if (!Array.isArray(value)) {
      error(`${key} must be an array`);
      return [];
    }
    const valid: FeatureId[] = [];
    for (const feature of value) {
      if (typeof feature !== 'string' || !FEATURE_ID_SET.has(feature)) {
        error(`${key} contains unknown feature "${String(feature)}"`);
        continue;
      }
      valid.push(feature as FeatureId);
    }
    return valid;
  };

  const discriminators = featureList('discriminators');
  const redHerrings = featureList('redHerrings');

  if (discriminators.length === 0) error('a confusion set needs at least one discriminator');

  for (const feature of discriminators) {
    if (redHerrings.includes(feature)) {
      error(`"${feature}" is listed as both a discriminator and a red herring`);
    }
  }

  if (known.length !== members.length) return issues;

  const valuesOf = (species: Species, feature: FeatureId) => new Set(species.features[feature] ?? []);
  const disjoint = (a: Set<string>, b: Set<string>) => ![...a].some((value) => b.has(value));

  for (const feature of discriminators) {
    const missing = known.filter((species) => valuesOf(species, feature).size === 0);
    if (missing.length > 0) {
      error(
        `discriminator "${feature}" is undefined on ${missing.map((s) => s.id).join(', ')} — every member must define every discriminator`,
      );
      continue;
    }
    const separatesSomePair = known.some((a, i) =>
      known.slice(i + 1).some((b) => disjoint(valuesOf(a, feature), valuesOf(b, feature))),
    );
    if (!separatesSomePair) {
      error(
        `discriminator "${feature}" separates no pair in this set — every member shares a value, so it is a red herring`,
      );
    }
  }

  // A red herring must carry no separating information at all. "Separates some
  // pairs but not others" is not a red herring — with three or more members it
  // is how the single most important character in a set can hide in the wrong
  // list. Growth habit tells a jack-o'-lantern from either chanterelle while
  // saying nothing about which chanterelle; that is a discriminator.
  for (const feature of redHerrings) {
    const missing = known.filter((species) => valuesOf(species, feature).size === 0);
    if (missing.length > 0) {
      error(
        `red herring "${feature}" is undefined on ${missing.map((s) => s.id).join(', ')} — a character some members lack is a character that separates them`,
      );
      continue;
    }
    const separatedPair = known
      .flatMap((a, i) => known.slice(i + 1).map((b) => [a, b] as const))
      .find(([a, b]) => disjoint(valuesOf(a, feature), valuesOf(b, feature)));
    if (separatedPair) {
      error(
        `red herring "${feature}" separates ${separatedPair[0].id} from ${separatedPair[1].id} — it carries real information, so it is a discriminator and the teaching note is lying`,
      );
    }
  }

  return issues;
}

export function validateAll(content: Content): Issue[] {
  const issues: Issue[] = [];
  const speciesById = new Map<string, Species>();

  for (const entry of content.species) {
    issues.push(...validateSpecies(entry.data, entry.file));
    const record = entry.data as Species;
    if (isRecord(entry.data) && isNonEmptyString(record.id)) {
      if (speciesById.has(record.id)) {
        issues.push({
          level: 'error',
          file: entry.file,
          message: `duplicate species id "${record.id}"`,
        });
      }
      speciesById.set(record.id, record);
    }
  }

  const seenSetIds = new Set<string>();
  for (const entry of content.confusionSets) {
    issues.push(...validateConfusionSet(entry.data, speciesById, entry.file));
    const record = entry.data as ConfusionSet;
    if (isRecord(entry.data) && isNonEmptyString(record.id)) {
      if (seenSetIds.has(record.id)) {
        issues.push({
          level: 'error',
          file: entry.file,
          message: `duplicate confusion set id "${record.id}"`,
        });
      }
      seenSetIds.add(record.id);
    }
  }

  const referenced = new Set(
    content.confusionSets.flatMap((entry) =>
      isRecord(entry.data) && Array.isArray(entry.data.memberSpeciesIds)
        ? (entry.data.memberSpeciesIds as string[])
        : [],
    ),
  );
  for (const [id] of speciesById) {
    if (!referenced.has(id)) {
      issues.push({
        level: 'error',
        file: `species/${id}.json`,
        message: 'species belongs to no confusion set — the confusion sets are the curriculum',
      });
    }
  }

  return issues;
}

export function report(issues: Issue[], strict: boolean): { text: string; exitCode: number } {
  const errors = issues.filter((issue) => issue.level === 'error');
  const unreviewed = issues.filter((issue) => issue.level === 'unreviewed');
  const lines: string[] = [];

  for (const issue of errors) lines.push(`  ERROR       ${issue.file}: ${issue.message}`);
  for (const issue of unreviewed) lines.push(`  UNREVIEWED  ${issue.file}: ${issue.message}`);

  if (errors.length === 0 && unreviewed.length === 0) {
    lines.push('  content OK — all files valid and reviewed');
  } else if (errors.length === 0) {
    lines.push('');
    lines.push(
      strict
        ? `  ${unreviewed.length} unreviewed file(s). --strict is the release gate: no unreviewed taxon ships.`
        : `  ${unreviewed.length} unreviewed file(s). Structurally valid; a mycologist still has to sign off.`,
    );
  }

  const failed = errors.length > 0 || (strict && unreviewed.length > 0);
  return { text: ['validate-species:', ...lines].join('\n'), exitCode: failed ? 1 : 0 };
}

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const strict = process.argv.includes('--strict');
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const { text, exitCode } = report(validateAll(loadContent(dataDir)), strict);
  console.log(text);
  process.exit(exitCode);
}
