/**
 * The runtime content loader — the only way `data/` reaches a browser.
 *
 * Until now `data/*.json` was read exclusively through `node:fs`, in the tests
 * and in the validator, so nothing could hand a `SpeciesIndex` to a running
 * app. `import.meta.glob` is a bundler feature and therefore cannot live in
 * `src/game/`, which imports nothing but `data/` and itself.
 *
 * This module does not re-validate. `scripts/validate-species.ts` gates every
 * file in CI and there is no second opinion to offer at runtime — but note that
 * the validator walks the directory with `readdirSync` while this walks it with
 * a glob, so the two loaders are only equivalent by assertion.
 * `tests/content-loader.test.ts` is that assertion.
 */
import type { ConfusionSet, Species } from '../../data/schema';
import type { SpeciesIndex } from '../game';

const speciesModules = import.meta.glob('../../data/species/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, Species>;

const confusionSetModules = import.meta.glob('../../data/confusion-sets/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, ConfusionSet>;

function byId<T extends { id: string }>(modules: Record<string, T>): readonly T[] {
  // Sorted rather than left in glob order: content order must not depend on the
  // bundler, or a seeded forage stops reproducing across builds.
  return Object.values(modules).sort((a, b) => a.id.localeCompare(b.id));
}

export const SPECIES: readonly Species[] = byId(speciesModules);
export const CONFUSION_SETS: readonly ConfusionSet[] = byId(confusionSetModules);

if (SPECIES.length === 0 || CONFUSION_SETS.length === 0) {
  // Only reachable if the glob stops matching — a moved directory or a typo.
  // The alternative failure is an empty forest that looks like a working app.
  throw new Error('content loader matched no files; data/ did not reach the bundle');
}

const speciesById = new Map(SPECIES.map((species) => [species.id, species]));
const confusionSetsById = new Map(CONFUSION_SETS.map((set) => [set.id, set]));

/**
 * Typed as the union `src/game/` accepts, so callers pass it straight to
 * `grade()` and cannot reach for `.set()` on the way past.
 */
export const SPECIES_INDEX: SpeciesIndex = speciesById;

export function findSpecies(id: string): Species | undefined {
  return speciesById.get(id);
}

export function findConfusionSet(id: string): ConfusionSet | undefined {
  return confusionSetsById.get(id);
}
