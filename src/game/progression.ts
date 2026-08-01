import type { ConfusionSet, FeatureId, Grade, IdAttempt, Specimen } from '../../data/schema';
import type { ExaminationResult } from './examination';

/** One page of the field notebook. It fills in as you observe, not as you guess. */
export interface NotebookEntry {
  speciesId: string;
  encounters: number;
  correctIds: number;
  /** Features the player has actually observed on this species, with the value. */
  confirmedFeatures: Partial<Record<FeatureId, string[]>>;
}

export interface ConfusionSetProgress {
  confusionSetId: string;
  attempts: number;
  /** Correct IDs backed by at least half the set's discriminators. */
  earnedIds: number;
  correctDeclines: number;
  mastered: boolean;
}

export interface Progress {
  xp: number;
  level: number;
  attempts: number;
  declines: number;
  hardStops: number;
  notebook: Record<string, NotebookEntry>;
  confusionSets: Record<string, ConfusionSetProgress>;
  /** How often the player has spent an action on each character. */
  featureChecks: Partial<Record<FeatureId, number>>;
}

export interface AttemptRecord {
  attempt: IdAttempt;
  grade: Grade;
  specimen: Specimen;
  confusionSet: ConfusionSet;
  /** Every examination the player actually performed on this individual. */
  observations: readonly ExaminationResult[];
}

/** Cumulative XP required to reach each level, index 0 = level 1. */
export const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500] as const;

/** Earned IDs in a confusion set before it counts as learned. */
export const MASTERY_THRESHOLD = 3;

export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i += 1) {
    if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  return level;
}

export function xpToNextLevel(xp: number): number | null {
  const next = LEVEL_THRESHOLDS.find((threshold) => threshold > xp);
  return next === undefined ? null : next - xp;
}

export function emptyProgress(): Progress {
  return {
    xp: 0,
    level: 1,
    attempts: 0,
    declines: 0,
    hardStops: 0,
    notebook: {},
    confusionSets: {},
    featureChecks: {},
  };
}

function withObservation(
  entry: NotebookEntry,
  feature: FeatureId,
  value: string,
): NotebookEntry {
  const existing = entry.confirmedFeatures[feature] ?? [];
  if (existing.includes(value)) return entry;
  return {
    ...entry,
    confirmedFeatures: { ...entry.confirmedFeatures, [feature]: [...existing, value] },
  };
}

/**
 * Fold one graded attempt into the player's progress. Pure: returns a new
 * `Progress`, never mutates the input.
 *
 * The notebook records what was *observed*, not what was answered — a wrong ID
 * still teaches you what that individual looked like.
 */
export function recordAttempt(progress: Progress, record: AttemptRecord): Progress {
  const { attempt, grade, specimen, confusionSet, observations } = record;

  const previousEntry: NotebookEntry = progress.notebook[specimen.speciesId] ?? {
    speciesId: specimen.speciesId,
    encounters: 0,
    correctIds: 0,
    confirmedFeatures: {},
  };

  let entry: NotebookEntry = {
    ...previousEntry,
    encounters: previousEntry.encounters + 1,
    correctIds: previousEntry.correctIds + (grade.correct ? 1 : 0),
    confirmedFeatures: { ...previousEntry.confirmedFeatures },
  };

  const featureChecks: Progress['featureChecks'] = { ...progress.featureChecks };
  for (const observation of observations) {
    featureChecks[observation.feature] = (featureChecks[observation.feature] ?? 0) + 1;
    if (observation.status === 'observed' && observation.value !== undefined) {
      entry = withObservation(entry, observation.feature, observation.value);
    }
  }

  const previousSet: ConfusionSetProgress = progress.confusionSets[confusionSet.id] ?? {
    confusionSetId: confusionSet.id,
    attempts: 0,
    earnedIds: 0,
    correctDeclines: 0,
    mastered: false,
  };

  const earned = grade.correct && grade.evidenceRatio >= 0.5 && !grade.underdetermined;
  const earnedIds = previousSet.earnedIds + (earned ? 1 : 0);
  const setProgress: ConfusionSetProgress = {
    ...previousSet,
    attempts: previousSet.attempts + 1,
    earnedIds,
    correctDeclines: previousSet.correctDeclines + (grade.correctlyDeclined ? 1 : 0),
    mastered: previousSet.mastered || earnedIds >= MASTERY_THRESHOLD,
  };

  const xp = progress.xp + grade.xp;

  return {
    xp,
    level: levelForXp(xp),
    attempts: progress.attempts + 1,
    declines: progress.declines + (attempt.answer.kind === 'declined' ? 1 : 0),
    hardStops: progress.hardStops + (grade.hardStop ? 1 : 0),
    notebook: { ...progress.notebook, [specimen.speciesId]: entry },
    confusionSets: { ...progress.confusionSets, [confusionSet.id]: setProgress },
    featureChecks,
  };
}
