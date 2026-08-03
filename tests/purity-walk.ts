/**
 * The import-closure walk behind `tests/purity.test.ts`.
 *
 * It lives in its own module, and reads through an injected `read`, so that the
 * checker can be run against synthetic files that genuinely violate the rule.
 * The previous version was a regex sweep that had never been pointed at a real
 * violation; measured, it caught none of `import 'three'` (no `from`, so both
 * patterns missed), `from "react"` (double quotes), or `await import('zustand')`
 * — and `readdirSync` was non-recursive, so any future `src/game/session/`
 * would have gone unchecked entirely.
 *
 * The walk is transitive on purpose. `src/game/` importing `data/schema` means
 * anything `data/` imports is also in `game/`'s closure, and a package pulled
 * in there breaks the rule just as thoroughly.
 */

export type ViolationKind =
  | 'bare-import'
  | 'escapes-allowed-roots'
  | 'unresolved-import'
  | 'browser-global';

export interface Violation {
  kind: ViolationKind;
  /** Repo-relative posix path of the offending file. */
  file: string;
  detail: string;
}

export interface WalkInput {
  /** Repo-relative posix paths of the files to start from. */
  entries: readonly string[];
  /** Repo-relative posix directory prefixes the closure may not leave. */
  allowedRoots: readonly string[];
  /** Returns file text, or undefined when the path does not resolve. */
  read: (path: string) => string | undefined;
}

export interface WalkResult {
  /** Every file reached, in visit order. Includes the entries. */
  visited: string[];
  violations: Violation[];
}

/**
 * Anchored to statement position, and the span between the keyword and `from`
 * may contain no quote and no semicolon — so it cannot leap the body of a long
 * declaration to reach an unrelated string.
 *
 * Both guards are load-bearing. Without them, `export const FEATURE_VALUES = {`
 * in `data/schema.ts` matched all the way down to the comment reading
 * "'clustered' is separate from 'clustered-fused'", and the checker reported
 * `clustered-fused` as an imported package.
 *
 * Dynamic `import()` is not anchored, because it is an expression.
 */
const STATEMENT_IMPORTS = [
  /^[ \t]*import\s+[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm,
  /^[ \t]*import\s*['"]([^'"]+)['"]/gm,
  /^[ \t]*export\s+[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm,
];
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const BROWSER_GLOBALS: readonly RegExp[] = [
  /\bdocument\./,
  /\bwindow\./,
  /\bnavigator\./,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bindexedDB\b/,
  /\bHTMLElement\b/,
];

/**
 * Remove comments while leaving string literals — and line numbering — intact.
 *
 * A regex cannot do this: prose about packages lives in comments all over this
 * repo, and a specifier lives in a string. Anything that erases one without
 * understanding the other gets both wrong. Newlines inside block comments are
 * preserved so that `^`-anchored patterns still mean "start of statement".
 */
export function stripComments(text: string): string {
  type Mode = 'code' | 'line' | 'block' | "'" | '"' | '`';
  let out = '';
  let mode: Mode = 'code';

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    const next = text[i + 1];

    if (mode === 'code') {
      if (char === '/' && next === '/') {
        mode = 'line';
        i += 1;
      } else if (char === '/' && next === '*') {
        mode = 'block';
        i += 1;
      } else {
        if (char === "'" || char === '"' || char === '`') mode = char;
        out += char;
      }
      continue;
    }

    if (mode === 'line') {
      if (char === '\n') {
        mode = 'code';
        out += char;
      }
      continue;
    }

    if (mode === 'block') {
      if (char === '*' && next === '/') {
        mode = 'code';
        i += 1;
      } else if (char === '\n') {
        out += char;
      }
      continue;
    }

    // Inside a string literal.
    if (char === '\\') {
      out += char + (next ?? '');
      i += 1;
      continue;
    }
    if (char === mode) mode = 'code';
    out += char;
  }

  return out;
}

/** Every module specifier the file imports, in any syntactic form. */
export function extractSpecifiers(source: string): string[] {
  const text = stripComments(source);
  const found: string[] = [];
  for (const pattern of [...STATEMENT_IMPORTS, DYNAMIC_IMPORT]) {
    for (const match of text.matchAll(pattern)) {
      if (match[1] !== undefined) found.push(match[1]);
    }
  }
  return [...new Set(found)];
}

function posixDirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/** Resolve `./x` or `../x` against a directory, without touching the filesystem. */
export function resolveRelative(fromDir: string, specifier: string): string {
  const segments = fromDir === '' ? [] : fromDir.split('/');
  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.json', '/index.ts'];

export function walkPurity({ entries, allowedRoots, read }: WalkInput): WalkResult {
  const violations: Violation[] = [];
  const visited: string[] = [];
  const seen = new Set<string>();
  const queue = [...entries];

  const inAllowedRoot = (path: string) =>
    allowedRoots.some((root) => path === root || path.startsWith(`${root}/`));

  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    const text = read(file);
    if (text === undefined) {
      violations.push({ kind: 'unresolved-import', file, detail: 'file could not be read' });
      continue;
    }
    visited.push(file);

    // JSON declares no imports and touches no globals; scanning it would only
    // produce noise from the URLs and prose inside species files.
    if (file.endsWith('.json')) continue;

    const code = stripComments(text);
    for (const pattern of BROWSER_GLOBALS) {
      const match = pattern.exec(code);
      if (match) {
        violations.push({
          kind: 'browser-global',
          file,
          detail: `touches the browser global \`${match[0]}\``,
        });
      }
    }

    for (const specifier of extractSpecifiers(text)) {
      if (!specifier.startsWith('.')) {
        violations.push({
          kind: 'bare-import',
          file,
          detail: `imports the package \`${specifier}\``,
        });
        continue;
      }

      const base = resolveRelative(posixDirname(file), specifier);
      const resolved = CANDIDATE_SUFFIXES.map((suffix) => `${base}${suffix}`).find(
        (candidate) => read(candidate) !== undefined,
      );

      if (resolved === undefined) {
        violations.push({
          kind: 'unresolved-import',
          file,
          detail: `\`${specifier}\` resolves to nothing under ${base}`,
        });
        continue;
      }
      if (!inAllowedRoot(resolved)) {
        violations.push({
          kind: 'escapes-allowed-roots',
          file,
          detail: `\`${specifier}\` reaches ${resolved}, outside ${allowedRoots.join(' and ')}`,
        });
        continue;
      }
      if (!seen.has(resolved)) queue.push(resolved);
    }
  }

  return { visited, violations };
}

export function formatViolations(violations: readonly Violation[]): string {
  return violations.map((v) => `${v.file}: ${v.detail} [${v.kind}]`).join('\n');
}
