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
  const weighted = foray.speciesWeights.map((entry) => {
    const species = lookupSpecies(index, entry.speciesId);
    if (!species) {
      // A silently thinner patch is the failure that looks like a working app.
      throw new Error(
        `foray "${foray.id}" weights unknown species "${entry.speciesId}"`,
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

  const entries = inSeason.map(({ species, weight }) => [species, weight] as const);
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
