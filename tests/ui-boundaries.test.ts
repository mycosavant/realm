import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { FORAGING_STATUSES } from '../data/schema';

/**
 * CLAUDE.md non-negotiable 2: the app never tells a user a specimen is safe to
 * eat. `Species` has no `edible` field, and `src/game/` is clean — but a clean
 * data model still leaks if the interface reconstructs the verdict. Three ways
 * it does:
 *
 *   1. A notebook page that prints `commonly-eaten-when-confirmed` *is* an
 *      edibility verdict with extra syllables.
 *   2. A verdict screen naming the true species, plus a notebook page saying
 *      commonly-eaten, composes into "you identified it, and it is safe" out of
 *      two individually defensible screens.
 *   3. Absence as verdict: if a toxin panel appears for toxic species and
 *      nothing appears otherwise, silence becomes the safe signal.
 *
 * So: `foragingStatus` never reaches anything above `src/game/`, in any form,
 * and `toxinNotes` is read only inside `grade()`. The UI gets the consequence —
 * `Grade.hardStop.message` — which exists only after a mistake already made in
 * game, and which is a warning, never a clearance.
 *
 * The word "edible" is deliberately *not* banned here. The disclaimer copy has
 * to be able to say the app will not tell you what is edible.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const BANNED = [
  'foragingStatus',
  'toxinNotes',
  'FORAGING_STATUSES',
  // A label lookup table keyed by status is the same leak wearing a hat.
  ...FORAGING_STATUSES.flatMap((status) => [`'${status}'`, `"${status}"`]),
];

const CODE = /\.(ts|tsx|js|jsx|css)$/;

function listCode(relativeDir: string): string[] {
  return readdirSync(join(repoRoot, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) return listCode(path);
    return entry.isFile() && CODE.test(path) ? [path] : [];
  });
}

/** Everything above the `game/` line: ui, scene, state, persist, content, App. */
const aboveTheLine = listCode('src').filter((path) => !path.startsWith('src/game/'));

describe('the interface cannot reconstruct an edibility verdict', () => {
  it('has files above src/game/ to check', () => {
    expect(aboveTheLine.length).toBeGreaterThan(0);
  });

  it('never mentions foraging status or toxin notes outside src/game/', () => {
    const found = aboveTheLine.flatMap((path) => {
      const text = readFileSync(join(repoRoot, path), 'utf8');
      return BANNED.filter((token) => text.includes(token)).map(
        (token) => `${path}: \`${token}\` — see CLAUDE.md non-negotiable 2`,
      );
    });
    expect(found.join('\n')).toBe('');
  });

  it('reads foraging status in exactly one place inside src/game/', () => {
    const readers = listCode('src/game').filter((path) =>
      readFileSync(join(repoRoot, path), 'utf8').includes('foragingStatus'),
    );
    expect(readers).toEqual(['src/game/scoring.ts']);
  });

  it('reads toxin notes exactly once, inside the hard-stop assignment', () => {
    const readers = listCode('src/game').filter((path) =>
      readFileSync(join(repoRoot, path), 'utf8').includes('toxinNotes'),
    );
    expect(readers).toEqual(['src/game/scoring.ts']);

    const scoring = readFileSync(join(repoRoot, 'src/game/scoring.ts'), 'utf8');
    expect([...scoring.matchAll(/toxinNotes/g)]).toHaveLength(1);

    // The read must sit inside the branch that justifies it — a toxin note is a
    // consequence of a mistake already made, never a property on display.
    const assignment = scoring.indexOf('hardStop = {');
    expect(assignment).toBeGreaterThan(-1);
    expect(scoring.indexOf('toxinNotes')).toBeGreaterThan(assignment);
  });
});
