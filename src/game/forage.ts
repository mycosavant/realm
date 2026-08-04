import { fruitsInMonth, type Foray, type Species, type Specimen } from '../../data/schema';
import { pickWeighted, type Rng } from './rng';
import { lookupSpecies, type SpeciesIndex } from './scoring';
import { generateSpecimen, type GenerateSpecimenOptions } from './specimen';

/**
 * Realise a foray into a patch of individuals.
 *
 * Pure, and it has to be: `makeRng` promises that a seed reproduces a forest
 * exactly, and that promise is only keepable if *selection* is pure too. Which
 * species, which trap, which individual — all of it comes out of the rng and
 * the foray, and nothing else.
 *
 * The rng is consumed in a fixed order per specimen: the weighted species pick,
 * then the trap roll if and only if the chosen species has a trap, then
 * whatever `generateSpecimen` consumes. Conditional draws are fine — the stream
 * is still a function of the inputs — but the order is not free to change,
 * because changing it silently reshuffles every saved seed.
 */
export function generatePatch(rng: Rng, foray: Foray, index: SpeciesIndex): Specimen[] {
  if (!Number.isInteger(foray.month)) {
    // A fractional month silently drops taxa through `fruitsInMonth`.
    throw new Error(`foray "${foray.id}" has a non-integer month ${foray.month}`);
  }

  const seen = new Set<string>();
  const weighted = foray.speciesWeights.map((entry) => {
    // Every one of these is caught in a *file* by the validator. They are
    // re-checked here for the same reason phenology is: a silently thinner
    // patch is the failure that looks like a working app, and a caller
    // synthesising a foray at runtime never went past the validator.
    const species = lookupSpecies(index, entry.speciesId);
    if (!species) {
      throw new Error(`foray "${foray.id}" weights unknown species "${entry.speciesId}"`);
    }
    if (seen.has(entry.speciesId)) {
      throw new Error(`foray "${foray.id}" weights "${entry.speciesId}" twice`);
    }
    seen.add(entry.speciesId);
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) {
      throw new Error(
        `foray "${foray.id}" weights "${entry.speciesId}" at ${entry.weight} — a non-positive weight silently rewrites the patch`,
      );
    }
    return { species, weight: entry.weight };
  });

  // Phenology gating. The validator already refuses to let a foray file weight
  // a species that does not fruit in its month, so for shipped content this
  // filter removes nothing — it is here because seasonality is a rule about the
  // world, not a lint about the file, and a caller synthesising a foray at
  // runtime is entitled to the rule rather than to the lint.
  const inSeason = weighted.filter(({ species }) => fruitsInMonth(species.phenology, foray.month));
  if (inSeason.length === 0) {
    throw new Error(
      `foray "${foray.id}" has nothing fruiting in month ${foray.month} — an empty patch is not a forage`,
    );
  }

  // Sorted by id before it reaches `pickWeighted`, whose cumulative walk is
  // order-sensitive. Without this, alphabetising the `speciesWeights` array in a
  // content file is a silent reshuffle of every saved seed — the same failure
  // `src/content/index.ts` sorts to avoid, on the array that actually drives the
  // patch rather than the one that happens to be enumerated by the bundler.
  const entries = [...inSeason]
    .sort((a, b) => a.species.id.localeCompare(b.species.id))
    .map(({ species, weight }) => [species, weight] as const);
  const trapBySpeciesId = new Map(foray.traps.map((trap) => [trap.speciesId, trap]));

  const patch: Specimen[] = [];
  for (let i = 0; i < foray.specimenCount; i += 1) {
    const species: Species = pickWeighted(rng, entries);
    const trap = trapBySpeciesId.get(species.id);

    const options: GenerateSpecimenOptions = {};
    if (trap && rng() < trap.chance) {
      options.substrateOverride = trap.presentsSubstrate;
    }

    patch.push(generateSpecimen(species, rng, options));
  }
  return patch;
}
