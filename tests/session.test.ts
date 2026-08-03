import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXAMINATIONS } from '../data/examinations';
import { VALUE_LABELS, type FeatureId, type ReadingMode, type Specimen } from '../data/schema';
import { makeRng } from '../src/game/rng';
import {
  actionsRemaining,
  actionsSpent,
  applySessionEvent,
  canExamine,
  misreadings,
  sessionView,
  settledObservations,
  startSession,
  type Session,
  type SessionContext,
  type SessionEvent,
} from '../src/game/session';
import { candidatesGivenObservations } from '../src/game/scoring';
import { generateSpecimen } from '../src/game/specimen';
import {
  CHANTERELLE,
  CHANTERELLE_SET,
  JACK_O_LANTERN,
  SMOOTH_CHANTERELLE,
  SPECIES_INDEX,
} from './fixtures';

const CTX: SessionContext = { confusionSet: CHANTERELLE_SET, index: SPECIES_INDEX };
const IN_SITU = { age: 'mature', weathering: 0, snapChance: 0, detachedChance: 0 } as const;
const ALL_TOOLS = ['knife', 'paper', 'loupe'] as const;

function jackOLantern(seed = 1): Specimen {
  return generateSpecimen(JACK_O_LANTERN, makeRng(seed), IN_SITU);
}

function run(session: Session, ...events: SessionEvent[]): Session {
  return events.reduce((state, event) => applySessionEvent(state, event, CTX), session);
}

const look = (feature: FeatureId): SessionEvent => ({ kind: 'examine', feature });

/**
 * Record the true value as the reading for anything still awaiting one. A test
 * that wants to exercise something other than the reading model should not also
 * have to encode which characters are `judged` today.
 */
function readEverything(session: Session): Session {
  return session.performed
    .filter((o) => o.status === 'observed' && o.reading === undefined)
    .reduce(
      (state, o) =>
        applySessionEvent(
          state,
          { kind: 'record-reading', feature: o.feature, reading: o.value as string },
          CTX,
        ),
      session,
    );
}

describe('the action economy is derived, not stored', () => {
  it('charges a repeated examination once, so double-checking is free', () => {
    const session = run(
      startSession(jackOLantern(), { actionBudget: 6, tools: ALL_TOOLS }),
      look('spore.print'),
      look('spore.print'),
      look('spore.print'),
    );
    expect(actionsSpent(session)).toBe(3);
    expect(actionsRemaining(session)).toBe(3);
    expect(session.performed).toHaveLength(1);
  });

  it('never refuses a re-look — the cost model exists so it stays free', () => {
    const session = run(
      startSession(jackOLantern(), { actionBudget: 3, tools: ALL_TOOLS }),
      look('spore.print'),
    );
    expect(actionsRemaining(session)).toBe(0);
    expect(canExamine(session, 'spore.print')).toEqual({ ok: true });
    expect(canExamine(session, 'gills.edge')).toEqual({ ok: false, reason: 'not-enough-actions' });
  });

  it('refuses an examination whose tool the player does not carry', () => {
    const session = startSession(jackOLantern(), { actionBudget: 9, tools: ['knife'] });
    expect(canExamine(session, 'spore.print')).toEqual({ ok: false, reason: 'missing-tool' });
    expect(canExamine(session, 'stem.base')).toEqual({ ok: true });
    expect(run(session, look('spore.print')).performed).toHaveLength(0);
  });

  it('lets free examinations through on a zero budget', () => {
    const free = (Object.keys(EXAMINATIONS) as FeatureId[]).filter(
      (feature) => EXAMINATIONS[feature].actionCost === 0,
    );
    const session = run(startSession(jackOLantern(), { actionBudget: 0 }), ...free.map(look));
    expect(session.performed.map((o) => o.feature)).toEqual(free);
    expect(actionsSpent(session)).toBe(0);
  });
});

describe('committing', () => {
  it('grades against real content and stops the session', () => {
    const looked = run(
      startSession(jackOLantern(2), { actionBudget: 9, tools: ALL_TOOLS }),
      look('hymenium.type'),
      look('substrate'),
      look('odor'),
      look('spore.print'),
    );
    const session = run(readEverything(looked), {
      kind: 'commit',
      answer: { kind: 'species', speciesId: JACK_O_LANTERN.id },
    });

    expect(session.committed?.featuresChecked).toEqual([
      'hymenium.type',
      'substrate',
      'odor',
      'spore.print',
    ]);
    expect(session.grade?.correct).toBe(true);
    expect(session.grade?.evidenceRatio).toBe(1);
  });

  it('refuses every event after the commit', () => {
    const committed = run(
      startSession(jackOLantern(3), { actionBudget: 9, tools: ALL_TOOLS }),
      look('odor'),
      { kind: 'commit', answer: { kind: 'declined' } },
    );
    expect(canExamine(committed, 'substrate')).toEqual({
      ok: false,
      reason: 'already-committed',
    });

    const after = run(
      committed,
      look('substrate'),
      { kind: 'commit', answer: { kind: 'species', speciesId: CHANTERELLE.id } },
    );
    expect(after.performed).toHaveLength(1);
    expect(after.committed?.answer).toEqual({ kind: 'declined' });
  });

  it('counts an unavailable reading as checked — looking is the graded behaviour', () => {
    const weathered = generateSpecimen(JACK_O_LANTERN, makeRng(4), {
      age: 'mature',
      weathering: 0.95,
      snapChance: 0,
      detachedChance: 0,
    });
    const session = run(
      startSession(weathered, { actionBudget: 9, tools: ALL_TOOLS }),
      look('spore.print'),
      { kind: 'commit', answer: { kind: 'declined' } },
    );
    expect(session.performed[0].status).toBe('unavailable');
    expect(session.committed?.featuresChecked).toEqual(['spore.print']);
  });
});

describe('sessionView is the only thing the interface may read', () => {
  it('exposes no ground truth the player has not paid for', () => {
    const specimen = jackOLantern(5);
    const paid: FeatureId[] = ['odor'];
    const session = run(
      startSession(specimen, { actionBudget: 9, tools: ALL_TOOLS }),
      ...paid.map(look),
    );
    const view = sessionView(session, CTX);

    // The specimen knows all eleven characters; the view shows the one paid for,
    // and carries no `value` key at all — `reading` is the player's, not truth's.
    expect(Object.keys(specimen.observedFeatures).length).toBeGreaterThan(paid.length);
    expect(view.observations.map((o) => o.feature)).toEqual(paid);
    for (const observation of view.observations) {
      expect(Object.keys(observation)).not.toContain('value');
    }

    // A blunt substring sweep as a backstop. Values that a paid-for observation
    // legitimately shows are excluded, because the vocabulary shares values
    // across characters — `odor: none` and `bruising: none` serialise the same
    // and no string check can tell them apart.
    const shown = new Set(paid.map((feature) => specimen.observedFeatures[feature]));
    const serialised = JSON.stringify(view);
    for (const [feature, value] of Object.entries(specimen.observedFeatures)) {
      if (paid.includes(feature as FeatureId) || shown.has(value)) continue;
      expect(serialised, `${feature} leaked into the view`).not.toContain(`"${value}"`);
    }
  });

  it('labels values instead of handing the interface raw identifiers', () => {
    const specimen = jackOLantern(6);
    const view = sessionView(
      run(startSession(specimen, { actionBudget: 9 }), look('substrate')),
      CTX,
    );
    expect(view.observations[0].reading).toBe(specimen.observedFeatures.substrate);
    expect(view.observations[0].readingLabel).toBe(
      VALUE_LABELS.substrate[specimen.observedFeatures.substrate as string],
    );
    expect(view.observations[0].readingLabel).toMatch(/hardwood/);
    expect(view.observations[0].label).toBe('Look at what it is growing from');
  });

  it('carries no candidate list — one free look would delete the toxic species', () => {
    const buriedRoot = generateSpecimen(JACK_O_LANTERN, makeRng(7), {
      ...IN_SITU,
      substrateOverride: 'soil-mycorrhizal',
    });
    const session = run(
      startSession(buriedRoot, { actionBudget: 9, tools: ALL_TOOLS }),
      look('substrate'),
    );

    expect(sessionView(session, CTX)).not.toHaveProperty('candidateSpeciesIds');

    // Why: argmax over one observation is strict elimination. The function is
    // still correct to call with enough evidence — it just must not drive a
    // panel off the first, free, most tempting look.
    expect(actionsSpent(session)).toBe(0);
    expect(candidatesGivenObservations(session.performed, CHANTERELLE_SET, SPECIES_INDEX)).toEqual([
      CHANTERELLE.id,
      SMOOTH_CHANTERELLE.id,
    ]);
  });

  it('withholds misreadings until the verdict', () => {
    const session = run(
      startSession(jackOLantern(8), { actionBudget: 9, tools: ALL_TOOLS }),
      look('hymenium.type'),
    );
    expect(sessionView(session, CTX).misreadings).toEqual([]);
    expect(sessionView(session, CTX).committed).toBe(false);
  });
});

describe('readings', () => {
  it('fills the reading in itself for a given character', () => {
    // `substrate`, not `hymenium.type`: the latter is a candidate for the
    // documented flip to `judged`, and this test is about the `given` path.
    const session = run(startSession(jackOLantern(9), { actionBudget: 9 }), look('substrate'));
    const observation = session.performed[0];
    expect(observation.readingMode).toBe('given');
    expect(observation.reading).toBe(observation.value);
    expect(sessionView(session, CTX).awaitingReading).toEqual([]);
  });

  /**
   * A tripwire, not an invariant. It is meant to fail the day someone flips a
   * character to `judged`, so that the two gates in data/examinations.ts — the
   * reviewed art, and the scoring pass on declining after a misreading — get
   * looked at deliberately rather than skipped.
   */
  it('every shipped character is given, so a reading can never be wrong in v1', () => {
    const judged = (Object.keys(EXAMINATIONS) as FeatureId[]).filter(
      (feature) => EXAMINATIONS[feature].reading === 'judged',
    );
    expect(judged, 'flipping a character to judged? read the gates first').toEqual([]);
  });

  it('ignores a reading the player tries to supply for a given character', () => {
    const session = run(
      startSession(jackOLantern(10), { actionBudget: 9 }),
      look('substrate'),
      { kind: 'record-reading', feature: 'substrate', reading: 'dung' },
    );
    expect(session.performed[0].reading).toBe(session.performed[0].value);
    expect(misreadings(session.performed, CTX)).toEqual([]);
  });

  it('leaves a not-applicable outcome unreadable', () => {
    const smooth = generateSpecimen(SMOOTH_CHANTERELLE, makeRng(11), IN_SITU);
    const session = run(
      startSession(smooth, { actionBudget: 9, tools: ALL_TOOLS }),
      look('gills.edge'),
      { kind: 'record-reading', feature: 'gills.edge', reading: 'sharp' },
    );
    expect(session.performed[0].status).toBe('not-applicable');
    expect(session.performed[0].reading).toBeUndefined();
    expect(sessionView(session, CTX).awaitingReading).toEqual([]);
  });
});

/**
 * Nothing ships as `judged` — see the note in data/examinations.ts. These
 * exercise the machinery against a character flipped for the test, so that the
 * shape is proven before any art exists rather than after.
 */
describe('a judged character, which nothing is yet', () => {
  // Captured rather than hardcoded. An earlier version asserted restoration to
  // the literal 'given', which hard-coupled this block to the pre-flip data and
  // would have made the tests written to survive the flip its first casualty.
  let original: ReadingMode;

  beforeEach(() => {
    original = EXAMINATIONS['spore.print'].reading;
    vi.spyOn(EXAMINATIONS['spore.print'], 'reading', 'get').mockReturnValue('judged');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(EXAMINATIONS['spore.print'].reading).toBe(original);
  });

  const takePrint = (seed: number) =>
    run(
      startSession(generateSpecimen(SMOOTH_CHANTERELLE, makeRng(seed), IN_SITU), {
        actionBudget: 9,
        tools: ALL_TOOLS,
      }),
      look('spore.print'),
    );

  it('charges the action and then waits for the player to decide', () => {
    const session = takePrint(12);
    expect(actionsSpent(session)).toBe(3);
    expect(session.performed[0].value).toBe('pinkish-yellow');
    expect(session.performed[0].reading).toBeUndefined();
    expect(sessionView(session, CTX).awaitingReading).toEqual(['spore.print']);
    expect(sessionView(session, CTX).observations[0].awaitingReading).toBe(true);
  });

  it('narrows nothing until the player has committed to a reading', () => {
    const session = takePrint(13);
    expect(sessionView(session, CTX).awaitingReading).toEqual(['spore.print']);
    expect(
      candidatesGivenObservations(
        settledObservations(session.performed),
        CHANTERELLE_SET,
        SPECIES_INDEX,
      ),
    ).toEqual(CHANTERELLE_SET.memberSpeciesIds);
  });

  it('narrows on the reading, not on the truth — and this is the whole case for it', () => {
    const misread = run(takePrint(14), {
      kind: 'record-reading',
      feature: 'spore.print',
      reading: 'cream',
    });

    // The specimen is a smooth chanterelle: pinkish-yellow, readable as cream on
    // white paper. Note what the misreading actually does. It does not merely
    // point at the wrong chanterelle — cream is within the jack-o'-lantern's
    // range too, so a single misread character eliminates the specimen's own
    // species and readmits the toxic one. Three actions spent, and the player is
    // further from an answer than before they looked.
    const candidates = candidatesGivenObservations(
      settledObservations(misread.performed),
      CHANTERELLE_SET,
      SPECIES_INDEX,
    );
    expect(candidates).toEqual([CHANTERELLE.id, JACK_O_LANTERN.id]);
    expect(candidates).not.toContain(SMOOTH_CHANTERELLE.id);

    // Read correctly, the same action settles it outright.
    const correct = run(takePrint(14), {
      kind: 'record-reading',
      feature: 'spore.print',
      reading: 'pinkish-yellow',
    });
    expect(
      candidatesGivenObservations(
        settledObservations(correct.performed),
        CHANTERELLE_SET,
        SPECIES_INDEX,
      ),
    ).toEqual([SMOOTH_CHANTERELLE.id]);
  });

  it('names the misreading at the verdict, and calls the evidence sound', () => {
    const view = sessionView(
      run(
        takePrint(15),
        { kind: 'record-reading', feature: 'spore.print', reading: 'cream' },
        { kind: 'commit', answer: { kind: 'species', speciesId: CHANTERELLE.id } },
      ),
      CTX,
    );

    expect(view.misreadings).toEqual([
      { feature: 'spore.print', reading: 'cream', truth: 'pinkish-yellow', consequential: true },
    ]);
    expect(view.feedback.join('\n')).toContain('the evidence was there and the reading is what missed it');
    expect(view.feedback.join('\n')).toContain('pale pinkish yellow');
  });

  /**
   * The spore print separates the smooth chanterelle from the other two, and it
   * does *not* separate the Appalachian chanterelle from the jack-o'-lantern —
   * both carry white and cream. That is the pair a forager is most likely to be
   * holding and the pair where being wrong costs the most, and the teaching note
   * says so. Feedback that congratulates the evidence here would teach a player
   * to trust the print on exactly the pairing it fails.
   */
  it('does not claim the evidence was there when the misreading changed nothing', () => {
    const jack = generateSpecimen(JACK_O_LANTERN, makeRng(20), IN_SITU);
    const session = run(
      startSession(jack, { actionBudget: 9, tools: ALL_TOOLS }),
      look('spore.print'),
    );
    const truth = session.performed[0].value as string;
    const otherPaleValue = truth === 'cream' ? 'white' : 'cream';

    const view = sessionView(
      run(
        session,
        { kind: 'record-reading', feature: 'spore.print', reading: otherPaleValue },
        { kind: 'commit', answer: { kind: 'species', speciesId: CHANTERELLE.id } },
      ),
      CTX,
    );

    expect(view.misreadings).toHaveLength(1);
    expect(view.misreadings[0].consequential).toBe(false);
    expect(view.feedback.join('\n')).not.toContain('the evidence was there');
    expect(view.feedback.join('\n')).toContain('does not separate every pair in this set');
  });

  it('does not pay evidence credit for a look the player never interpreted', () => {
    const session = run(
      startSession(generateSpecimen(SMOOTH_CHANTERELLE, makeRng(21), IN_SITU), {
        actionBudget: 9,
        tools: ALL_TOOLS,
      }),
      look('spore.print'),
      { kind: 'commit', answer: { kind: 'declined' } },
    );
    expect(session.performed[0].status).toBe('observed');
    expect(session.performed[0].reading).toBeUndefined();
    expect(session.committed?.featuresChecked).toEqual([]);
  });

  it('lets the player revise a reading for free, and keeps it across a re-look', () => {
    const revised = run(
      takePrint(16),
      { kind: 'record-reading', feature: 'spore.print', reading: 'cream' },
      { kind: 'record-reading', feature: 'spore.print', reading: 'pinkish-yellow' },
    );
    expect(actionsSpent(revised)).toBe(3);
    expect(misreadings(revised.performed, CTX)).toEqual([]);

    const relooked = run(revised, look('spore.print'));
    expect(relooked.performed[0].reading).toBe('pinkish-yellow');
    expect(actionsSpent(relooked)).toBe(3);
  });

  it('rejects a reading outside the controlled vocabulary', () => {
    const session = run(takePrint(17), {
      kind: 'record-reading',
      feature: 'spore.print',
      reading: 'chartreuse',
    });
    expect(session.performed[0].reading).toBeUndefined();
  });

  it('ignores a reading for a character never examined', () => {
    const session = run(startSession(jackOLantern(18), { actionBudget: 9 }), {
      kind: 'record-reading',
      feature: 'spore.print',
      reading: 'white',
    });
    expect(session.performed).toEqual([]);
  });
});
