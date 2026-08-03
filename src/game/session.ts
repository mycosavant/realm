import { EXAMINATIONS } from '../../data/examinations';
import {
  FEATURE_LABELS,
  FEATURE_VALUES,
  valueLabel,
  type ConfusionSet,
  type FeatureId,
  type Grade,
  type IdAttempt,
  type ReadingMode,
  type Specimen,
  type ToolId,
} from '../../data/schema';
import {
  applyExamination,
  totalActionCost,
  type ExaminationResult,
  type ExaminationStatus,
} from './examination';
import { candidatesGivenObservations, grade, type SpeciesIndex } from './scoring';

/**
 * One individual, one run. This is the state machine the interface drives, and
 * it lives here rather than in a React store because every rule in it is a rule
 * — what an action costs, when looking is free, what the player is allowed to
 * see. None of that is presentation.
 *
 * The load-bearing idea is that an observation carries **two** values.
 * `ExaminationResult.value` is what the individual actually shows; `reading` is
 * what the player recorded. For a `given` character they are the same by
 * construction. For a `judged` one they can differ, and that gap is the thing
 * an identification trainer exists to train — a player who misreads a pale
 * spore print, follows it confidently to the wrong chanterelle, and is told at
 * the verdict that their *evidence* was sound and their *reading* was what
 * failed has learned something no quiz can teach.
 *
 * `grade()` cannot see readings and is not changed here. Everything reading-
 * aware is additive and lives in this module.
 */
export interface Observation extends ExaminationResult {
  /**
   * What the player recorded. Set only when `status === 'observed'`: there is
   * nothing to read on a character this individual does not show. For a `given`
   * character it is filled in at examination time and equals `value`.
   */
  reading?: string;
  /** Copied from the examination so an observation is self-describing. */
  readingMode: ReadingMode;
}

export interface Session {
  specimen: Specimen;
  actionBudget: number;
  tools: readonly ToolId[];
  performed: readonly Observation[];
  committed: IdAttempt | null;
  grade: Grade | null;
}

/**
 * Content is passed as objects, never as ids. `grade()` needs a `ConfusionSet`
 * and a `SpeciesIndex`; a `confusionSetId: string` on the session could not
 * satisfy either, so a commit event would set `committed` and nothing else — no
 * grade, no hard stop.
 */
export interface SessionContext {
  confusionSet: ConfusionSet;
  index: SpeciesIndex;
}

export type SessionEvent =
  | { kind: 'examine'; feature: FeatureId }
  | { kind: 'record-reading'; feature: FeatureId; reading: string }
  | { kind: 'commit'; answer: IdAttempt['answer'] };

export function startSession(
  specimen: Specimen,
  options: { actionBudget: number; tools?: readonly ToolId[] },
): Session {
  return {
    specimen,
    actionBudget: options.actionBudget,
    tools: options.tools ?? [],
    performed: [],
    committed: null,
    grade: null,
  };
}

/**
 * Actions spent so far. Derived, never stored — a counter kept alongside the
 * list that justifies it is a counter that drifts from it.
 *
 * A repeated examination is charged once. That is deliberate and it is why
 * `'already-checked'` is not a reason `canExamine` may refuse: re-looking at
 * something you have already paid for must stay free, or the player is punished
 * for double-checking.
 */
export function actionsSpent(session: Session): number {
  return totalActionCost(session.performed);
}

export function actionsRemaining(session: Session): number {
  return Math.max(0, session.actionBudget - actionsSpent(session));
}

export type ExamineRefusal = 'already-committed' | 'missing-tool' | 'not-enough-actions';

export function canExamine(
  session: Session,
  feature: FeatureId,
): { ok: true } | { ok: false; reason: ExamineRefusal } {
  if (session.committed !== null) return { ok: false, reason: 'already-committed' };

  const examination = EXAMINATIONS[feature];
  if (examination.requiresTool && !session.tools.includes(examination.requiresTool)) {
    return { ok: false, reason: 'missing-tool' };
  }

  const alreadyPaid = session.performed.some((o) => o.feature === feature);
  if (!alreadyPaid && examination.actionCost > actionsRemaining(session)) {
    return { ok: false, reason: 'not-enough-actions' };
  }

  return { ok: true };
}

/**
 * Observations the player has committed to a reading of, with that reading in
 * place of the truth. Exported because a caller wanting `candidatesGivenObser-
 * vations` off a session must go through this — handing it `performed` directly
 * would narrow on ground truth the player has not interpreted.
 */
export function settledObservations(performed: readonly Observation[]): ExaminationResult[] {
  return performed
    .filter((o) => o.status !== 'observed' || o.reading !== undefined)
    .map((o) => (o.status === 'observed' ? { ...o, value: o.reading } : o));
}

export interface Misreading {
  feature: FeatureId;
  reading: string;
  truth: string;
  /**
   * Whether reading it correctly would have left a different set of candidates
   * standing. A misreading can be entirely inconsequential, and saying otherwise
   * is worse than saying nothing — see `misreadingFeedback`.
   */
  consequential: boolean;
}

/**
 * Characters the player recorded differently from what the individual shows.
 *
 * Always empty while every examination ships `reading: 'given'`. It is built
 * now because the alternative is discovering at art time that `Session` cannot
 * express the case.
 */
export function misreadings(
  performed: readonly Observation[],
  ctx: SessionContext,
): Misreading[] {
  const asRead = candidatesGivenObservations(settledObservations(performed), ctx.confusionSet, ctx.index);

  return performed.flatMap((o) => {
    if (o.status !== 'observed' || o.reading === undefined || o.value === undefined) return [];
    if (o.reading === o.value) return [];

    const corrected = candidatesGivenObservations(
      settledObservations(performed.map((other) => (other === o ? { ...other, reading: other.value } : other))),
      ctx.confusionSet,
      ctx.index,
    );

    return [
      {
        feature: o.feature,
        reading: o.reading,
        truth: o.value,
        consequential: corrected.join() !== asRead.join(),
      },
    ];
  });
}

/**
 * Feedback for a misread character. Separate from `Grade.feedback` because it
 * says something different: not "you were wrong" but "you gathered the right
 * evidence and read it wrong", which is a better mistake and a fixable one.
 *
 * The consequential branch is gated for a reason that is specific to this
 * curriculum. The one pairing the spore print cannot resolve is the Appalachian
 * chanterelle against the jack-o'-lantern — both carry white and cream — and
 * that is the pair a forager is most likely to be holding and the pair where
 * being wrong costs the most. Telling a player who misread white as cream that
 * "the evidence was there" would teach them to trust the print on exactly the
 * pairing the teaching note says it fails.
 */
export function misreadingFeedback(found: readonly Misreading[]): string[] {
  return found.map((m) => {
    const opening =
      `You recorded the ${FEATURE_LABELS[m.feature]} as "${valueLabel(m.feature, m.reading)}". ` +
      `This one is "${valueLabel(m.feature, m.truth)}"`;
    return m.consequential
      ? `${opening} — the evidence was there and the reading is what missed it.`
      : `${opening}. It happens not to change what is still standing here, which is worth knowing about this character: it does not separate every pair in this set.`;
  });
}

function examine(session: Session, feature: FeatureId): Session {
  if (!canExamine(session, feature).ok) return session;

  const result = applyExamination(session.specimen, feature);
  const mode = EXAMINATIONS[feature].reading;
  const observation: Observation = {
    ...result,
    readingMode: mode,
    // A `given` character is read by the game; a `judged` one waits for the
    // player. Either way there is nothing to read unless it was observed.
    ...(result.status === 'observed' && mode === 'given' ? { reading: result.value } : {}),
  };

  const existing = session.performed.findIndex((o) => o.feature === feature);
  if (existing === -1) {
    return { ...session, performed: [...session.performed, observation] };
  }

  // Re-looking is free and must not discard a reading the player already made.
  const previous = session.performed[existing];
  const performed = [...session.performed];
  performed[existing] = {
    ...observation,
    ...(previous.reading !== undefined ? { reading: previous.reading } : {}),
  };
  return { ...session, performed };
}

function recordReading(session: Session, feature: FeatureId, reading: string): Session {
  if (session.committed !== null) return session;
  if (!FEATURE_VALUES[feature].includes(reading)) return session;

  const index = session.performed.findIndex((o) => o.feature === feature);
  if (index === -1) return session;

  const observation = session.performed[index];
  // Nothing to read on an unavailable or not-applicable outcome, and a `given`
  // character was already read by the game — overriding it would let the
  // interface fabricate evidence the player never looked at.
  if (observation.status !== 'observed' || observation.readingMode !== 'judged') return session;

  const performed = [...session.performed];
  performed[index] = { ...observation, reading };
  return { ...session, performed };
}

function commit(session: Session, answer: IdAttempt['answer'], ctx: SessionContext): Session {
  if (session.committed !== null) return session;

  const attempt: IdAttempt = {
    specimenId: session.specimen.id,
    // Looking is the graded behaviour, so an `unavailable` outcome counts: the
    // player did everything they could and the individual gave up nothing. An
    // *observed* character the player never read is different — they stopped
    // short of interpreting evidence they had paid for, and counting it would
    // pay full evidence credit for work not done. Unreachable while everything
    // ships `given`; wrong the day anything does not.
    featuresChecked: [
      ...new Set(
        session.performed
          .filter((o) => o.status !== 'observed' || o.reading !== undefined)
          .map((o) => o.feature),
      ),
    ],
    answer,
  };

  return {
    ...session,
    committed: attempt,
    grade: grade(attempt, ctx.confusionSet, session.specimen, ctx.index),
  };
}

export function applySessionEvent(
  session: Session,
  event: SessionEvent,
  ctx: SessionContext,
): Session {
  switch (event.kind) {
    case 'examine':
      return examine(session, event.feature);
    case 'record-reading':
      return recordReading(session, event.feature, event.reading);
    case 'commit':
      return commit(session, event.answer, ctx);
  }
}

export interface ObservationView {
  feature: FeatureId;
  label: string;
  status: ExaminationStatus;
  /** The player's reading, never the specimen's truth. */
  reading?: string;
  readingLabel?: string;
  actionCost: number;
  destructive: boolean;
  note?: string;
  readingMode: ReadingMode;
  /** Observed, `judged`, and the player has not decided yet. */
  awaitingReading: boolean;
}

export interface SessionView {
  specimenId: string;
  actionsSpent: number;
  actionsRemaining: number;
  tools: readonly ToolId[];
  observations: readonly ObservationView[];
  awaitingReading: readonly FeatureId[];
  committed: boolean;
  grade: Grade | null;
  /** Empty until commit. Revealing a misreading earlier would be the answer. */
  misreadings: readonly Misreading[];
  feedback: readonly string[];
}

/**
 * The only thing the interface may read.
 *
 * `Session.specimen.observedFeatures` is the complete ground truth for this
 * individual, including every character the player has not paid for. Put the
 * session in a store as-is and any component can render unearned evidence, and
 * the bug looks exactly like a working feature. This returns observations only,
 * with `value` stripped and the player's own reading in its place — so the cost
 * model cannot be bypassed by accident, and a misreading stays a misreading
 * on screen until the verdict.
 *
 * It deliberately carries **no candidate list**. A "candidates remaining" panel
 * reads as the obvious thing to build here and it is a trap twice over. The
 * design doc rejects it on principle — showing surviving candidates leaks the
 * answer — and `candidatesGivenObservations` has a failure window that makes it
 * worse than a leak: argmax over a single observation is strict elimination, so
 * one free look at the substrate of a jack-o'-lantern fruiting from a buried
 * root removes the toxic species from the shortlist, at zero cost, on the exact
 * character the teaching note says counterfeits itself. Callers that want the
 * list can call the function and own that caveat.
 */
export function sessionView(session: Session, ctx: SessionContext): SessionView {
  const committed = session.committed !== null;
  const found = committed ? misreadings(session.performed, ctx) : [];

  return {
    specimenId: session.specimen.id,
    actionsSpent: actionsSpent(session),
    actionsRemaining: actionsRemaining(session),
    tools: session.tools,
    observations: session.performed.map((o) => {
      const awaiting = o.status === 'observed' && o.reading === undefined;
      return {
        feature: o.feature,
        label: EXAMINATIONS[o.feature].label,
        status: o.status,
        ...(o.reading !== undefined
          ? { reading: o.reading, readingLabel: valueLabel(o.feature, o.reading) }
          : {}),
        actionCost: o.actionCost,
        destructive: o.destructive,
        ...(o.note !== undefined ? { note: o.note } : {}),
        readingMode: o.readingMode,
        awaitingReading: awaiting,
      };
    }),
    awaitingReading: session.performed
      .filter((o) => o.status === 'observed' && o.reading === undefined)
      .map((o) => o.feature),
    committed,
    grade: session.grade,
    misreadings: found,
    feedback: [...(session.grade?.feedback ?? []), ...misreadingFeedback(found)],
  };
}
