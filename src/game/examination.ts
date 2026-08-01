import { EXAMINATIONS } from '../../data/examinations';
import type { Examination, FeatureId, Specimen } from '../../data/schema';
import { unavailabilityReason } from './availability';

export type ExaminationStatus = 'observed' | 'unavailable' | 'not-applicable';

export interface ExaminationResult {
  feature: FeatureId;
  status: ExaminationStatus;
  /** Only set when `status === 'observed'`. */
  value?: string;
  /** Charged regardless of outcome — looking costs the same as finding. */
  actionCost: number;
  destructive: boolean;
  requiresTool?: Examination['requiresTool'];
  /** Player-facing sentence for the non-observed outcomes. */
  note?: string;
}

/**
 * Spend an action on one feature of one individual.
 *
 * Three outcomes, and the two empty ones are not the same lesson:
 *  - `observed`        — here is the value.
 *  - `unavailable`     — this taxon has the character, this individual does
 *                        not show it (a button, a rain-washed stem).
 *  - `not-applicable`  — this taxon does not have the character at all. That is
 *                        real evidence, so it is charged for like any other.
 */
export function applyExamination(specimen: Specimen, feature: FeatureId): ExaminationResult {
  const examination = EXAMINATIONS[feature];
  if (!examination) {
    throw new Error(`No examination defined for feature "${feature}"`);
  }

  const base = {
    feature,
    actionCost: examination.actionCost,
    destructive: examination.destructive,
    ...(examination.requiresTool ? { requiresTool: examination.requiresTool } : {}),
  };

  const value = specimen.observedFeatures[feature];
  if (value === undefined) {
    return {
      ...base,
      status: 'not-applicable',
      note: 'This one does not have that character at all.',
    };
  }

  if (specimen.unavailableFeatures.includes(feature)) {
    return {
      ...base,
      status: 'unavailable',
      note: unavailabilityReason(specimen, feature),
    };
  }

  return { ...base, status: 'observed', value };
}

/**
 * Add a result to the running list of checks. An `unavailable` outcome still
 * counts as checked — the player looked, and looking is the graded behaviour.
 */
export function recordExamination(
  checked: readonly FeatureId[],
  result: ExaminationResult,
): FeatureId[] {
  return checked.includes(result.feature) ? [...checked] : [...checked, result.feature];
}

/** Total actions spent, charging a repeated examination only once. */
export function totalActionCost(results: readonly ExaminationResult[]): number {
  const seen = new Set<FeatureId>();
  let total = 0;
  for (const result of results) {
    if (seen.has(result.feature)) continue;
    seen.add(result.feature);
    total += result.actionCost;
  }
  return total;
}
