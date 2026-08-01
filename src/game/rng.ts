/**
 * Deterministic RNG. Every generator in `src/game/` takes an `Rng` so that a
 * seed reproduces a forest exactly — required for tests, and later for
 * "share this specimen with a friend" without a server.
 */
export type Rng = () => number;

/** mulberry32 — small, fast, good enough for content generation. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() called with an empty list');
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/** Weighted pick. Weights need not sum to 1. */
export function pickWeighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) throw new Error('pickWeighted() needs at least one positive weight');
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[entries.length - 1][0];
}

export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
