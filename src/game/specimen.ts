import {
  FEATURE_VALUES,
  type FeatureId,
  type Species,
  type Specimen,
  type SpecimenAge,
} from '../../data/schema';
import { baselineUnavailable } from './availability';
import { clamp01, pick, pickWeighted, range, type Rng } from './rng';

export interface GenerateSpecimenOptions {
  /** Force the age instead of rolling for it. */
  age?: SpecimenAge;
  /** Force weathering (0..1) instead of deriving it from age. */
  weathering?: number;
  /**
   * Chance the stem base snapped off when the specimen was collected. Defaults
   * to a value that rises with weathering.
   */
  snapChance?: number;
  /** Chance the specimen is found off its substrate — no substrate, no habit. */
  detachedChance?: number;
  /**
   * Present a substrate other than the species' own. The honest use is buried
   * hardwood: an *Omphalotus* on a buried oak root reads as "growing from
   * soil". The caller opts in — the generator never invents a trap on its own.
   */
  substrateOverride?: string;
}

const AGE_WEIGHTS: readonly (readonly [SpecimenAge, number])[] = [
  ['button', 12],
  ['young', 25],
  ['mature', 45],
  ['past-prime', 18],
];

const WEATHERING_BY_AGE: Record<SpecimenAge, readonly [number, number]> = {
  button: [0, 0.25],
  young: [0, 0.4],
  mature: [0.05, 0.75],
  'past-prime': [0.4, 1],
};

/**
 * Realise one individual of `species`.
 *
 * Deterministic for a given `(species, seed, options)`: the rng is consumed in
 * a fixed order — id, age, weathering, one draw per defined feature in
 * `FEATURE_VALUES` order, then the snap and detach rolls.
 */
export function generateSpecimen(
  species: Species,
  rng: Rng,
  options: GenerateSpecimenOptions = {},
): Specimen {
  const id = `spc_${Math.floor(rng() * 0xffffffff).toString(36)}`;
  const age = options.age ?? pickWeighted(rng, AGE_WEIGHTS);

  const [minWeathering, maxWeathering] = WEATHERING_BY_AGE[age];
  const weathering =
    options.weathering !== undefined
      ? clamp01(options.weathering)
      : clamp01(range(rng, minWeathering, maxWeathering));

  const definedFeatures = (Object.keys(FEATURE_VALUES) as FeatureId[]).filter(
    (feature) => (species.features[feature]?.length ?? 0) > 0,
  );

  // One concrete value per feature the taxon defines. Where the taxon varies,
  // this individual picks a side.
  const observedFeatures: Partial<Record<FeatureId, string>> = {};
  for (const feature of definedFeatures) {
    observedFeatures[feature] = pick(rng, species.features[feature]!);
  }
  if (options.substrateOverride !== undefined) {
    observedFeatures.substrate = options.substrateOverride;
  }

  const unavailable = new Set<FeatureId>(baselineUnavailable(age, weathering));

  const snapChance = options.snapChance ?? 0.08 + 0.22 * weathering;
  if (rng() < snapChance) unavailable.add('stem.base');

  const detachedChance = options.detachedChance ?? 0.06;
  if (rng() < detachedChance) {
    unavailable.add('substrate');
    unavailable.add('growth.habit');
  }

  const specimen: Specimen = {
    id,
    speciesId: species.id,
    age,
    weathering,
    // Only ever list features this taxon actually has. "You cannot see the
    // gills of a morel" is not a fact about the individual.
    unavailableFeatures: definedFeatures.filter((feature) => unavailable.has(feature)),
    observedFeatures,
  };
  if (options.substrateOverride !== undefined) {
    specimen.substrateOverride = options.substrateOverride;
  }
  return specimen;
}

export function isAvailable(specimen: Specimen, feature: FeatureId): boolean {
  return (
    specimen.observedFeatures[feature] !== undefined &&
    !specimen.unavailableFeatures.includes(feature)
  );
}

/** Every feature this individual will actually give up, in schema order. */
export function availableFeatures(specimen: Specimen): FeatureId[] {
  return (Object.keys(FEATURE_VALUES) as FeatureId[]).filter((feature) =>
    isAvailable(specimen, feature),
  );
}
