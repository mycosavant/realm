import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { formatViolations, resolveRelative, stripComments, walkPurity } from './purity-walk';

/**
 * CLAUDE.md: `src/game/` is pure TypeScript — no `three`, no `react`, no DOM.
 * It imports only `data/` and itself.
 *
 * That rule is load-bearing, so it is checked rather than trusted — and the
 * check itself is checked, below, against files that actually break it.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_ROOTS = ['src/game', 'data'] as const;

function readFromRepo(path: string): string | undefined {
  try {
    return readFileSync(join(repoRoot, path), 'utf8');
  } catch {
    return undefined; // missing, or a directory
  }
}

/** Recursive, so a future `src/game/session/` is covered without an edit here. */
function listTypeScript(relativeDir: string): string[] {
  return readdirSync(join(repoRoot, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) return listTypeScript(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

const entries = listTypeScript('src/game');
const actual = walkPurity({ entries, allowedRoots: ALLOWED_ROOTS, read: readFromRepo });

describe('src/game import closure', () => {
  it('has source files to check', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('reaches nothing outside src/game/ and data/, and imports no package', () => {
    expect(formatViolations(actual.violations)).toBe('');
  });

  it('actually followed the edges into data/ — a walk that resolved nothing would pass vacuously', () => {
    expect(actual.visited).toContain('data/schema.ts');
    expect(actual.visited).toContain('data/examinations.ts');
    expect(actual.visited.length).toBeGreaterThan(entries.length);
  });
});

/**
 * The synthetic closures below are the regression suite for the checker. The
 * first three are the exact leaks the previous regex version let through.
 */
function check(files: Record<string, string>, entryList = ['src/game/index.ts']) {
  return walkPurity({
    entries: entryList,
    allowedRoots: ALLOWED_ROOTS,
    read: (path) => files[path],
  });
}

describe('the purity checker catches real leaks', () => {
  it('catches a side-effect import with no `from`', () => {
    const { violations } = check({ 'src/game/index.ts': "import 'three';\n" });
    expect(violations).toEqual([
      { kind: 'bare-import', file: 'src/game/index.ts', detail: 'imports the package `three`' },
    ]);
  });

  it('catches double-quoted specifiers', () => {
    const { violations } = check({
      'src/game/index.ts': 'import { useState } from "react";\n',
    });
    expect(violations.map((v) => v.detail)).toEqual(['imports the package `react`']);
  });

  it('catches dynamic import', () => {
    const { violations } = check({
      'src/game/index.ts': 'export async function f() { return await import("zustand"); }\n',
    });
    expect(violations.map((v) => v.detail)).toEqual(['imports the package `zustand`']);
  });

  it('catches a leak in a subdirectory the old readdirSync never opened', () => {
    const { violations } = check({
      'src/game/index.ts': "export * from './session/state';\n",
      'src/game/session/state.ts': "import { create } from 'zustand';\n",
    });
    expect(violations).toEqual([
      {
        kind: 'bare-import',
        file: 'src/game/session/state.ts',
        detail: 'imports the package `zustand`',
      },
    ]);
  });

  it('catches a leak reached transitively through data/', () => {
    const { violations } = check({
      'src/game/index.ts': "import type { X } from '../../data/schema';\nexport type Y = X;\n",
      'data/schema.ts': "import { Vector3 } from 'three';\nexport type X = Vector3;\n",
    });
    expect(violations).toEqual([
      { kind: 'bare-import', file: 'data/schema.ts', detail: 'imports the package `three`' },
    ]);
  });

  it('catches a relative import that climbs out into the UI', () => {
    const { violations } = check({
      'src/game/index.ts': "import { panel } from '../ui/panel';\n",
      'src/ui/panel.ts': 'export const panel = 1;\n',
    });
    expect(violations[0]?.kind).toBe('escapes-allowed-roots');
    expect(violations[0]?.detail).toContain('src/ui/panel.ts');
  });

  it('catches node builtins, which are packages too', () => {
    const { violations } = check({ 'src/game/index.ts': "import { readFileSync } from 'node:fs';\n" });
    expect(violations.map((v) => v.detail)).toEqual(['imports the package `node:fs`']);
  });

  it('catches DOM access', () => {
    const { violations } = check({
      'src/game/index.ts': 'export const el = document.getElementById("root");\n',
    });
    expect(violations.map((v) => v.kind)).toEqual(['browser-global']);
  });

  it('does not fire on a package name inside a comment', () => {
    const { violations } = check({
      'src/game/index.ts': '// no three, no react — see CLAUDE.md\nexport const x = 1;\n',
    });
    expect(violations).toEqual([]);
  });

  it('does not fire on a comment inside a long export, which is how it first failed', () => {
    // Reduced from data/schema.ts. The first version of this checker matched
    // `export const FEATURE_VALUES = {` all the way down to this comment and
    // reported `clustered-fused` as an imported package.
    const { violations } = check({
      'src/game/index.ts': [
        'export const FEATURE_VALUES: Record<string, readonly string[]> = {',
        "  // 'clustered' is separate from 'clustered-fused': one is suggestive,",
        '  // the other is a structural claim.',
        "  'growth.habit': ['clustered', 'clustered-fused'],",
        '};',
      ].join('\n'),
    });
    expect(violations).toEqual([]);
  });

  it('does not fire on a browser global named only in prose', () => {
    const { violations } = check({
      'src/game/index.ts': '/** Never touches document. or window. — see CLAUDE.md */\nexport const x = 1;\n',
    });
    expect(violations).toEqual([]);
  });

  it('still finds an import that follows a comment mentioning another package', () => {
    const { violations } = check({
      'src/game/index.ts': "// unrelated: we do not use zustand here\nimport { Vector3 } from 'three';\n",
    });
    expect(violations.map((v) => v.detail)).toEqual(['imports the package `three`']);
  });

  it('accepts a clean closure that spans a subdirectory and data/', () => {
    const { violations, visited } = check({
      'src/game/index.ts': "export * from './session/state';\n",
      'src/game/session/state.ts':
        "import type { Species } from '../../../data/schema';\nexport type S = Species;\n",
      'data/schema.ts': 'export interface Species { id: string }\n',
    });
    expect(violations).toEqual([]);
    expect(visited).toHaveLength(3);
  });
});

describe('stripComments', () => {
  it('removes comments and keeps string literals', () => {
    expect(stripComments("const a = 'keep'; // drop\n")).toBe("const a = 'keep'; \n");
    expect(stripComments('/* drop */ const b = 1;')).toBe(' const b = 1;');
  });

  it('does not treat a comment marker inside a string as a comment', () => {
    expect(stripComments("const url = 'https://example.com';")).toBe(
      "const url = 'https://example.com';",
    );
  });

  it('preserves newlines so that ^-anchored patterns still mean start of statement', () => {
    const stripped = stripComments('/*\n a\n b\n*/\nimport x from "./y";');
    expect(stripped.split('\n')).toHaveLength(5);
    expect(stripped.endsWith('import x from "./y";')).toBe(true);
  });

  it('handles escaped quotes', () => {
    expect(stripComments("const a = 'it\\'s fine'; // drop")).toBe("const a = 'it\\'s fine'; ");
  });
});

describe('resolveRelative', () => {
  it('walks up and back down', () => {
    expect(resolveRelative('src/game', '../../data/schema')).toBe('data/schema');
    expect(resolveRelative('src/game', './rng')).toBe('src/game/rng');
    expect(resolveRelative('src/game/session', '../availability')).toBe('src/game/availability');
  });
});
