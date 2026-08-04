import {
  FEATURE_LABELS,
  valueLabel,
  type ConfusionSet,
  type FeatureId,
  type Grade,
  type IdAttempt,
  type Species,
  type Specimen,
} from '../../data/schema';
import type { ExaminationResult } from './examination';
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

/**
 * Resolve a species id against either index shape. Exported because every
 * module that takes a `SpeciesIndex` needs it and a second copy would be a
 * second chance to get the `Map`/`Record` branch wrong.
 */
export function lookupSpecies(index: SpeciesIndex, id: string): Species | undefined {
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

function scoreMembers(
  specimen: Specimen,
  confusionSet: ConfusionSet,
  index: SpeciesIndex,
): { speciesId: string; score: number }[] {
  const reachable = reachableDiscriminators(specimen, confusionSet);
  return confusionSet.memberSpeciesIds
    .map((speciesId) => ({ speciesId, species: lookupSpecies(index, speciesId) }))
    .filter((entry): entry is { speciesId: string; species: Species } => entry.species !== undefined)
    .map(({ speciesId, species }) => ({
      speciesId,
      score: reachable.filter((feature) => matchesFeature(species, feature, specimen)).length,
    }));
}

/**
 * Members consistent with *every* reachable discriminator — strict elimination.
 *
 * An empty result is not "nobody knows", it is a third thing: the individual
 * contradicts itself. A jack-o'-lantern on a buried root shows true gills and
 * apparent soil, and no member of the set can satisfy both. Something visible is
 * lying, and that is a different situation from two species genuinely remaining.
 *
 * `candidateSpecies` cannot tell those apart, which is why this exists. Its
 * argmax returns the same list — everybody, tied — for "all three fit
 * everything" and for "nobody fits anything".
 */
export function consistentSpecies(
  specimen: Specimen,
  confusionSet: ConfusionSet,
  index: SpeciesIndex,
): string[] {
  const reachable = reachableDiscriminators(specimen, confusionSet);
  return scoreMembers(specimen, confusionSet, index)
    .filter((entry) => entry.score === reachable.length)
    .map((entry) => entry.speciesId);
}

/**
 * Members of the set best supported by everything this individual will give up.
 *
 * Best match, not strict elimination. An individual can present a character
 * that contradicts its own species — a jack-o'-lantern from a buried root reads
 * as growing from soil — and the lesson there is that the weight of the other
 * evidence still resolves it, not that the specimen becomes unknowable. So when
 * strict elimination leaves nobody standing this still names whoever is closest,
 * rather than going empty.
 *
 * A tie therefore means one of two opposite things, and callers that care must
 * ask `consistentSpecies` which: everyone fits the evidence, or nobody does.
 * Reading a tie as "equally possible" is false in the second case and says so to
 * a player looking at a mushroom with true gills.
 */
export function candidateSpecies(
  specimen: Specimen,
  confusionSet: ConfusionSet,
  index: SpeciesIndex,
): string[] {
  const scored = scoreMembers(specimen, confusionSet, index);
  if (scored.length === 0) return [];
  const best = Math.max(...scored.map((entry) => entry.score));
  return scored.filter((entry) => entry.score === best).map((entry) => entry.speciesId);
}

/**
 * Members still standing given what the player has actually paid to see.
 *
 * `candidateSpecies` above answers a different question — who is left once
 * *every* reachable discriminator is applied — and it reads the specimen's
 * ground truth directly. Player evidence never enters it. Backing a "candidates
 * remaining" panel with it would render the correct species before the player
 * clicks anything, which is why this exists separately.
 *
 * The three examination outcomes carry different weight, and collapsing them
 * would be the bug:
 *
 *  - `observed`       — narrows to members whose recorded values include it.
 *  - `not-applicable` — narrows to members that do not have the character at
 *                       all. This is the one that resolves *C. lateritius*:
 *                       a smooth hymenium has no gill edge to read, and the
 *                       other two members define one.
 *  - `unavailable`    — narrows nothing. The player spent an action and the
 *                       individual gave up no reading. It still counts as
 *                       checked for `evidenceRatio`; it just cannot exclude
 *                       anybody.
 *
 * Best match rather than strict elimination — but read the limit before putting
 * this on a screen. Argmax over a *single* observation is strict elimination,
 * because the one member the observation contradicts scores zero and everyone
 * else scores one. On the buried-root trap that means one free look at the
 * substrate deletes the jack-o'-lantern outright, on the exact character the
 * teaching note says counterfeits itself. It recovers at two observations and
 * resolves correctly at three, so `grade()` — which applies every reachable
 * discriminator — is unaffected. A live panel driven off the first look is not.
 *
 * This is why `sessionView` does not carry candidates. A tie means the evidence
 * so far singles nobody out.
 *
 * Red herrings are not filtered out, and one consequence is worth stating
 * because it is easy to assert the opposite. A validated red herring is one
 * whose members' value sets *overlap* — not one whose members are identical.
 * The player observes a single realised value, so a red herring still narrows
 * whenever the value they happened to see lies outside some member's set.
 *
 * `growth.habit` in the shipped set is exactly this: the chanterelles carry
 * solitary, scattered and clustered, *Omphalotus* carries only clustered. A
 * solitary specimen really is inconsistent with a jack-o'-lantern, and saying
 * otherwise would be lying to the player. The information runs one way only,
 * which is the whole lesson — `solitary` excludes the jack-o'-lantern, while
 * `clustered` excludes nobody, because chanterelles cluster too. A panel that
 * refuses to narrow on a clustered specimen is teaching precisely the inference
 * the teaching note names as dangerous.
 *
 * Red herrings whose members share an identical value — every member decurrent,
 * every member solid — narrow nothing, whatever the player sees.
 */
export function candidatesGivenObservations(
  performed: readonly ExaminationResult[],
  confusionSet: ConfusionSet,
  index: SpeciesIndex,
): string[] {
  const informative = performed.filter((result) => result.status !== 'unavailable');

  const consistent = (species: Species, result: ExaminationResult): boolean => {
    const groundTruth = species.features[result.feature];
    const defined = groundTruth !== undefined && groundTruth.length > 0;

    if (result.status === 'not-applicable') return !defined;
    // A member with no recorded value for a character cannot be excluded by an
    // observation of it — the same rule `matchesFeature` applies, and the same
    // reason: silence in the data is missing information, not a mismatch.
    if (!defined) return true;
    return result.value !== undefined && groundTruth.includes(result.value);
  };

  const scored = confusionSet.memberSpeciesIds
    .map((speciesId) => ({ speciesId, species: lookupSpecies(index, speciesId) }))
    .filter((entry): entry is { speciesId: string; species: Species } => entry.species !== undefined)
    .map(({ speciesId, species }) => ({
      speciesId,
      score: informative.filter((result) => consistent(species, result)).length,
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
  const species = lookupSpecies(index, specimen.speciesId);
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
        const groundTruth = lookupSpecies(index, speciesId)?.features[feature];
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
  const consistent = consistentSpecies(specimen, confusionSet, index);
  const settling = settlingFeatures(specimen, confusionSet, index);

  // Three situations, not two. One member consistent with everything reachable:
  // resolvable. Two or more: genuinely ambiguous. None: the individual
  // contradicts itself — a jack-o'-lantern on a buried root shows true gills and
  // apparent soil, and no chanterelle has gills. That is still resolvable when
  // some single reachable character cuts the set down to the species in the
  // player's hand, and reading it as "everyone is equally possible" told a
  // player holding a gilled mushroom that it might be an edible chanterelle.
  const contradictory = consistent.length === 0;
  const underdetermined = contradictory ? settling.length === 0 : consistent.length !== 1;

  const specimenSpecies = lookupSpecies(index, specimen.speciesId);
  const specimenName = displayName(specimenSpecies, specimen.speciesId);

  const correct = attempt.answer.kind === 'species' && attempt.answer.speciesId === specimen.speciesId;
  const correctlyDeclined = attempt.answer.kind === 'declined' && underdetermined;

  const feedback: string[] = [];
  let xp: number;
  let hardStop: Grade['hardStop'];

  const underdeterminedReason = contradictory
    ? `The characters on this individual disagree: no species in this set fits all of ${labels(
        reachableDiscriminators(specimen, confusionSet),
      )} at once. One of them is lying, and nothing left settles which.`
    : candidateSpeciesIds.length > 1
      ? `Even with everything this individual will give up, ${candidateSpeciesIds
          .map((id) => displayName(lookupSpecies(index, id), id))
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
      if (settling.length > 0) {
        const feature = settling[0];
        feedback.push(
          `The ${FEATURE_LABELS[feature]} alone would have settled it: ${valueLabel(feature, specimen.observedFeatures[feature]!)}.`,
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
    const answeredSpecies = lookupSpecies(index, attempt.answer.speciesId);
    feedback.push(
      `Not ${displayName(answeredSpecies, attempt.answer.speciesId)}. This is ${specimenName}.`,
    );
    const missedSettling = settling.filter((feature) => !checked.includes(feature));
    if (missedSettling.length > 0) {
      const feature = missedSettling[0];
      feedback.push(
        `The ${FEATURE_LABELS[feature]} would have told you: ${valueLabel(feature, specimen.observedFeatures[feature]!)}.`,
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
      `Note the ${FEATURE_LABELS[feature]} on this one: "${valueLabel(feature, specimen.observedFeatures[feature]!)}" does not fit ${specimenName}. A single character can lie; the weight of the rest is what settles it.`,
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
