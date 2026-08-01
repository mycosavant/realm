import {
  FEATURE_LABELS,
  type ConfusionSet,
  type FeatureId,
  type Grade,
  type IdAttempt,
  type Species,
  type Specimen,
} from '../../data/schema';
import { isAvailable } from './specimen';

export type SpeciesIndex = Record<string, Species> | Map<string, Species>;

/**
 * Full credit. Awarded for a well-evidenced correct ID, and for declining an
 * individual that genuinely cannot be resolved.
 */
export const XP_FULL = 100;
/** Correct, but the player never gathered the evidence. */
export const XP_LUCKY_GUESS = 5;
/** Declined something that was resolvable. Caution is cheap, not free. */
export const XP_UNNECESSARY_DECLINE = 25;
/** Correct on an individual whose evidence could not have supported the call. */
export const XP_RIGHT_WITHOUT_GROUNDS = 25;
/** Below this share of the set's discriminators, a correct answer is a guess. */
export const EVIDENCE_THRESHOLD = 0.5;

function lookup(index: SpeciesIndex, id: string): Species | undefined {
  return index instanceof Map ? index.get(id) : index[id];
}

function displayName(species: Species | undefined, fallbackId: string): string {
  if (!species) return fallbackId;
  return species.commonNames[0] ?? species.scientificName;
}

function labels(features: readonly FeatureId[]): string {
  return features.map((feature) => FEATURE_LABELS[feature] ?? feature).join(', ');
}

function matchesFeature(species: Species, feature: FeatureId, specimen: Specimen): boolean {
  const groundTruth = species.features[feature];
  // A member with no data for a discriminator cannot be excluded by it. The
  // validator rejects that gap, so in practice this never fires.
  if (!groundTruth || groundTruth.length === 0) return true;
  return groundTruth.includes(specimen.observedFeatures[feature]!);
}

/** Discriminators this individual will actually give up. */
export function reachableDiscriminators(
  specimen: Specimen,
  confusionSet: ConfusionSet,
): FeatureId[] {
  return confusionSet.discriminators.filter((feature) => isAvailable(specimen, feature));
}

/**
 * Members of the set best supported by everything this individual will give up.
 *
 * Best match, not strict elimination. An individual can present a character
 * that contradicts its own species — a jack-o'-lantern from a buried root reads
 * as growing from soil — and the lesson there is that the weight of the other
 * evidence still resolves it, not that the specimen becomes unknowable. A tie
 * means the evidence does not single anyone out.
 */
export function candidateSpecies(
  specimen: Specimen,
  confusionSet: ConfusionSet,
  index: SpeciesIndex,
): string[] {
  const reachable = reachableDiscriminators(specimen, confusionSet);
  const scored = confusionSet.memberSpeciesIds
    .map((speciesId) => ({ speciesId, species: lookup(index, speciesId) }))
    .filter((entry): entry is { speciesId: string; species: Species } => entry.species !== undefined)
    .map(({ speciesId, species }) => ({
      speciesId,
      score: reachable.filter((feature) => matchesFeature(species, feature, specimen)).length,
    }));

  if (scored.length === 0) return [];
  const best = Math.max(...scored.map((entry) => entry.score));
  return scored.filter((entry) => entry.score === best).map((entry) => entry.speciesId);
}

/**
 * Reachable discriminators whose value on this individual contradicts its own
 * species — a character that is lying. Feedback names them so the player learns
 * that a single character can mislead.
 */
function misleadingFeatures(
  specimen: Specimen,
  confusionSet: ConfusionSet,
  index: SpeciesIndex,
): FeatureId[] {
  const species = lookup(index, specimen.speciesId);
  if (!species) return [];
  return reachableDiscriminators(specimen, confusionSet).filter(
    (feature) => !matchesFeature(species, feature, specimen),
  );
}

/** Reachable discriminators that on their own cut the set down to one member. */
function settlingFeatures(
  specimen: Specimen,
  confusionSet: ConfusionSet,
  index: SpeciesIndex,
): FeatureId[] {
  return confusionSet.discriminators
    .filter((feature) => isAvailable(specimen, feature))
    .filter((feature) => {
      const survivors = confusionSet.memberSpeciesIds.filter((speciesId) => {
        const groundTruth = lookup(index, speciesId)?.features[feature];
        if (!groundTruth || groundTruth.length === 0) return true;
        return groundTruth.includes(specimen.observedFeatures[feature]!);
      });
      return survivors.length === 1 && survivors[0] === specimen.speciesId;
    });
}

/**
 * Grade one attempt.
 *
 * The scoring rule, stated plainly: evidence is what earns XP. A correct answer
 * with less than half the set's discriminators checked is a guess and pays like
 * one. Declining an individual that cannot be resolved pays full marks. Being
 * confidently wrong about something deadly stops the run.
 *
 * `index` is required — whether an individual is resolvable at all is a fact
 * about the whole confusion set, not about the specimen alone.
 */
export function grade(
  attempt: IdAttempt,
  confusionSet: ConfusionSet,
  specimen: Specimen,
  index: SpeciesIndex,
): Grade {
  const discriminators = confusionSet.discriminators;
  const checked = [...new Set(attempt.featuresChecked)];
  const checkedDiscriminators = discriminators.filter((feature) => checked.includes(feature));
  const missedDiscriminators = discriminators.filter((feature) => !checked.includes(feature));
  const evidenceRatio =
    discriminators.length === 0 ? 1 : checkedDiscriminators.length / discriminators.length;

  const candidateSpeciesIds = candidateSpecies(specimen, confusionSet, index);
  const underdetermined = candidateSpeciesIds.length !== 1;

  const specimenSpecies = lookup(index, specimen.speciesId);
  const specimenName = displayName(specimenSpecies, specimen.speciesId);

  const correct = attempt.answer.kind === 'species' && attempt.answer.speciesId === specimen.speciesId;
  const correctlyDeclined = attempt.answer.kind === 'declined' && underdetermined;

  const feedback: string[] = [];
  let xp: number;
  let hardStop: Grade['hardStop'];

  const underdeterminedReason =
    candidateSpeciesIds.length > 1
      ? `Even with everything this individual will give up, ${candidateSpeciesIds
          .map((id) => displayName(lookup(index, id), id))
          .join(' and ')} remain equally possible.`
      : 'Nothing in this confusion set can be checked against this individual.';

  if (attempt.answer.kind === 'declined') {
    if (underdetermined) {
      xp = XP_FULL;
      feedback.push('Declining was the right call.');
      feedback.push(underdeterminedReason);
      const unreachable = discriminators.filter((feature) => !isAvailable(specimen, feature));
      if (unreachable.length > 0) {
        feedback.push(`Out of reach on this one: ${labels(unreachable)}.`);
      }
    } else {
      xp = XP_UNNECESSARY_DECLINE;
      feedback.push('This individual was resolvable.');
      const settling = settlingFeatures(specimen, confusionSet, index);
      if (settling.length > 0) {
        const feature = settling[0];
        feedback.push(
          `The ${FEATURE_LABELS[feature]} alone would have settled it: ${specimen.observedFeatures[feature]}.`,
        );
      }
      if (missedDiscriminators.length > 0) {
        feedback.push(`You never checked: ${labels(missedDiscriminators)}.`);
      }
    }
  } else if (correct) {
    if (underdetermined) {
      xp = XP_RIGHT_WITHOUT_GROUNDS;
      feedback.push(`Right answer — ${specimenName} — but the evidence could not have told you that.`);
      feedback.push(underdeterminedReason);
      feedback.push('Declining was the full-credit answer here.');
    } else if (evidenceRatio < EVIDENCE_THRESHOLD) {
      xp = XP_LUCKY_GUESS;
      feedback.push(`${specimenName} is correct, but you guessed it.`);
      feedback.push(
        `You checked ${checkedDiscriminators.length} of ${discriminators.length} characters that separate this set. Unchecked: ${labels(missedDiscriminators)}.`,
      );
    } else {
      xp = Math.round(60 + 40 * evidenceRatio);
      feedback.push(
        `Confirmed: ${specimenName}, on ${checkedDiscriminators.length} of ${discriminators.length} separating characters.`,
      );
      if (missedDiscriminators.length > 0) {
        feedback.push(`Still worth checking next time: ${labels(missedDiscriminators)}.`);
      }
    }
  } else {
    xp = 0;
    const answeredSpecies = lookup(index, attempt.answer.speciesId);
    feedback.push(
      `Not ${displayName(answeredSpecies, attempt.answer.speciesId)}. This is ${specimenName}.`,
    );
    const settling = settlingFeatures(specimen, confusionSet, index);
    const missedSettling = settling.filter((feature) => !checked.includes(feature));
    if (missedSettling.length > 0) {
      const feature = missedSettling[0];
      feedback.push(
        `The ${FEATURE_LABELS[feature]} would have told you: ${specimen.observedFeatures[feature]}.`,
      );
    }

    const swappedAnEdibleForAToxin =
      specimenSpecies?.foragingStatus === 'toxic' &&
      answeredSpecies?.foragingStatus === 'commonly-eaten-when-confirmed';

    if (specimenSpecies?.foragingStatus === 'deadly' || swappedAnEdibleForAToxin) {
      hardStop = {
        speciesId: specimen.speciesId,
        message:
          specimenSpecies?.toxinNotes ??
          `${specimenName} is not something to be wrong about.`,
      };
    }
  }

  const misleading = misleadingFeatures(specimen, confusionSet, index);
  if (misleading.length > 0) {
    const feature = misleading[0];
    feedback.push(
      `Note the ${FEATURE_LABELS[feature]} on this one: "${specimen.observedFeatures[feature]}" does not fit ${specimenName}. A single character can lie; the weight of the rest is what settles it.`,
    );
  }

  if (checkedDiscriminators.length === 0 && checked.length > 0) {
    const leanedOn = confusionSet.redHerrings.filter((feature) => checked.includes(feature));
    if (leanedOn.length > 0) {
      feedback.push(
        `Everything you checked (${labels(leanedOn)}) is shared across this set — none of it separates these species.`,
      );
    }
  }

  return {
    correct,
    evidenceRatio,
    correctlyDeclined,
    xp,
    feedback,
    underdetermined,
    candidateSpeciesIds,
    missedDiscriminators,
    ...(hardStop ? { hardStop } : {}),
  };
}
