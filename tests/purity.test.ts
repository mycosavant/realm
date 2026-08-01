import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md: `src/game/` is pure TypeScript — no `three`, no `react`, no DOM.
 * That rule is load-bearing, so it is checked, not trusted.
 */
const gameDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'game');

const FORBIDDEN_IMPORTS = [/\bfrom '(three|react|react-dom|zustand|idb)/, /@react-three\//];
const FORBIDDEN_GLOBALS = [/\bdocument\./, /\bwindow\./, /\blocalStorage\b/, /\bindexedDB\b/];

const sources = readdirSync(gameDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(join(gameDir, name), 'utf8') }));

describe('src/game purity', () => {
  it('has source files to check', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources)('$name imports no rendering, state or storage library', ({ text }) => {
    for (const pattern of FORBIDDEN_IMPORTS) {
      expect(text).not.toMatch(pattern);
    }
  });

  it.each(sources)('$name touches no DOM or browser global', ({ text }) => {
    for (const pattern of FORBIDDEN_GLOBALS) {
      expect(text).not.toMatch(pattern);
    }
  });

  it.each(sources)('$name imports only from data/ or within game/', ({ text }) => {
    const imports = [...text.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    for (const specifier of imports) {
      expect(specifier.startsWith('./') || specifier.startsWith('../../data/')).toBe(true);
    }
  });
});
