import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXAMINATIONS } from '../data/examinations';
import { VALUE_LABELS, type FeatureId, type Specimen } from '../data/schema';
import { makeRng } from '../src/game/rng';
import {
  actionsRemaining,
  actionsSpent,
  applySessionEvent,
  canExamine,
  misreadings,
  sessionView,
  startSession,
  type Session,
  type SessionContext,
  type SessionEvent,
} from '../src/game/session';
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
    const session = run(
      startSession(jackOLantern(2), { actionBudget: 9, tools: ALL_TOOLS }),
      look('hymenium.type'),
      look('substrate'),
      look('odor'),
      look('spore.print'),
      { kind: 'commit', answer: { kind: 'species', speciesId: JACK_O_LANTERN.id } },
    );

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

  it('narrows candidates only on what the player has looked at', () => {
    const session = startSession(jackOLantern(7), { actionBudget: 9, tools: ALL_TOOLS });
    expect(sessionView(session, CTX).candidateSpeciesIds).toEqual(
      CHANTERELLE_SET.memberSpeciesIds,
    );

    const looked = run(session, look('hymenium.type'), look('substrate'));
    expect(sessionView(looked, CTX).candidateSpeciesIds).toEqual([JACK_O_LANTERN.id]);
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
    const session = run(
      startSession(jackOLantern(9), { actionBudget: 9 }),
      look('hymenium.type'),
    );
    const observation = session.performed[0];
    expect(observation.readingMode).toBe('given');
    expect(observation.reading).toBe(observation.value);
    expect(sessionView(session, CTX).awaitingReading).toEqual([]);
  });

  it('every shipped character is given, so a reading can never be wrong in v1', () => {
    const judged = (Object.keys(EXAMINATIONS) as FeatureId[]).filter(
      (feature) => EXAMINATIONS[feature].reading === 'judged',
    );
    expect(judged).toEqual([]);
  });

  it('ignores a reading the player tries to supply for a given character', () => {
    const session = run(
      startSession(jackOLantern(10), { actionBudget: 9 }),
      look('hymenium.type'),
      { kind: 'record-reading', feature: 'hymenium.type', reading: 'smooth' },
    );
    expect(session.performed[0].reading).toBe('gills');
    expect(misreadings(session.performed)).toEqual([]);
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
  beforeEach(() => {
    vi.spyOn(EXAMINATIONS['spore.print'], 'reading', 'get').mockReturnValue('judged');
  });

  // Without this the flip leaks out of this block and quietly makes the
  // "everything ships as given" assertion above meaningless for later tests.
  afterEach(() => {
    vi.restoreAllMocks();
    expect(EXAMINATIONS['spore.print'].reading).toBe('given');
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
    expect(sessionView(session, CTX).candidateSpeciesIds).toEqual(
      CHANTERELLE_SET.memberSpeciesIds,
    );
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
    const candidates = sessionView(misread, CTX).candidateSpeciesIds;
    expect(candidates).toEqual([CHANTERELLE.id, JACK_O_LANTERN.id]);
    expect(candidates).not.toContain(SMOOTH_CHANTERELLE.id);

    // Read correctly, the same action settles it outright.
    const correct = run(takePrint(14), {
      kind: 'record-reading',
      feature: 'spore.print',
      reading: 'pinkish-yellow',
    });
    expect(sessionView(correct, CTX).candidateSpeciesIds).toEqual([SMOOTH_CHANTERELLE.id]);
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
      { feature: 'spore.print', reading: 'cream', truth: 'pinkish-yellow' },
    ]);
    expect(view.feedback.join('\n')).toContain('the evidence was there and the reading is what missed it');
    expect(view.feedback.join('\n')).toContain('pale pinkish yellow');
  });

  it('lets the player revise a reading for free, and keeps it across a re-look', () => {
    const revised = run(
      takePrint(16),
      { kind: 'record-reading', feature: 'spore.print', reading: 'cream' },
      { kind: 'record-reading', feature: 'spore.print', reading: 'pinkish-yellow' },
    );
    expect(actionsSpent(revised)).toBe(3);
    expect(misreadings(revised.performed)).toEqual([]);

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
