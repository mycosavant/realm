import type { FeatureId, Specimen, SpecimenAge } from '../../data/schema';

/**
 * Why a feature cannot be read off THIS individual. One rule table, used both
 * by the generator (to build `unavailableFeatures`) and by examination (to
 * explain the refusal), so the two can never drift apart.
 */
export interface AvailabilityRule {
  feature: FeatureId;
  /** Human sentence, shown when the player spends the action and gets nothing. */
  reason: string;
  applies(context: { age: SpecimenAge; weathering: number }): boolean;
}

const isButton = (age: SpecimenAge) => age === 'button';

export const AVAILABILITY_RULES: readonly AvailabilityRule[] = [
  {
    feature: 'hymenium.type',
    reason: 'The universal veil is still closed — the spore-bearing surface has not been exposed yet.',
    applies: ({ age }) => isButton(age),
  },
  {
    feature: 'gills.attachment',
    reason: 'Nothing is attached to anything yet: this button has not expanded.',
    applies: ({ age }) => isButton(age),
  },
  {
    feature: 'gills.edge',
    reason: 'The edge is too degraded to read.',
    applies: ({ age, weathering }) => isButton(age) || age === 'past-prime' || weathering > 0.85,
  },
  {
    feature: 'spore.print',
    reason: 'This individual is not shedding spores — a print will come up blank.',
    applies: ({ age, weathering }) => isButton(age) || weathering > 0.85,
  },
  {
    feature: 'stem.ring',
    reason: 'Rain has washed the stem clean; if there was a ring, it is gone.',
    applies: ({ age, weathering }) => isButton(age) || weathering > 0.7,
  },
  {
    feature: 'bruising',
    reason: 'The flesh is too old and waterlogged to give a reliable reaction.',
    applies: ({ age, weathering }) => age === 'past-prime' || weathering > 0.6,
  },
  {
    feature: 'odor',
    reason: 'Rain-soaked. Any odor it had has washed out.',
    applies: ({ weathering }) => weathering > 0.4,
  },
];

/**
 * Features lost to age and weather, before the per-individual damage rolls in
 * `generateSpecimen` (a snapped stem base, a specimen found off its substrate).
 */
export function baselineUnavailable(age: SpecimenAge, weathering: number): FeatureId[] {
  const context = { age, weathering };
  return AVAILABILITY_RULES.filter((rule) => rule.applies(context)).map((rule) => rule.feature);
}

const DAMAGE_REASONS: Partial<Record<FeatureId, string>> = {
  'stem.base': 'The base snapped off in the leaf litter — whatever was down there stayed down there.',
  substrate: 'This one was already picked when you found it. There is no telling what it grew from.',
  'growth.habit': 'Out of context in a basket, a single fruitbody says nothing about how it grew.',
};

/**
 * The sentence shown when an examination comes back empty. Prefers the
 * age/weather rule; falls back to the damage explanation.
 */
export function unavailabilityReason(specimen: Specimen, feature: FeatureId): string {
  const context = { age: specimen.age, weathering: specimen.weathering };
  const rule = AVAILABILITY_RULES.find((r) => r.feature === feature && r.applies(context));
  if (rule) return rule.reason;
  return DAMAGE_REASONS[feature] ?? 'Not readable on this individual.';
}
