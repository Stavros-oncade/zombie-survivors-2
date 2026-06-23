// src/game/utils/Rng.ts
// Tiny seeded PRNG helpers for deterministic, reproducible Job Board generation.
// mulberry32 is a well-known ~5-line seeded generator; given the same seed it
// always yields the same sequence, which lets boards be stable across reloads
// and unit-testable (see JobBoardSystem / outer-loop-job-board.md §4).

export type Rng = () => number; // returns a float in [0, 1)

/** Deterministic 32-bit seeded PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max] inclusive, using the supplied rng. */
export function randInt(rng: Rng, min: number, max: number): number {
  if (max < min) [min, max] = [max, min];
  return min + Math.floor(rng() * (max - min + 1));
}

/** Pick one element from a list using the rng. */
export function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

/**
 * Weighted sample WITHOUT replacement: draws `count` distinct items, each item's
 * probability proportional to its weight. Returns fewer than `count` only if the
 * pool is smaller than `count`.
 */
export function weightedSampleWithoutReplacement<T>(
  rng: Rng,
  items: readonly T[],
  weightOf: (item: T) => number,
  count: number
): T[] {
  const pool = items.slice();
  const weights = pool.map((i) => Math.max(0, weightOf(i)));
  const result: T[] = [];
  const n = Math.min(count, pool.length);
  for (let k = 0; k < n; k++) {
    const total = weights.reduce((s, w) => s + w, 0);
    if (total <= 0) {
      // All remaining weights zero — fall back to uniform over what's left.
      const idx = Math.floor(rng() * pool.length) % pool.length;
      result.push(pool[idx]);
      pool.splice(idx, 1);
      weights.splice(idx, 1);
      continue;
    }
    let r = rng() * total;
    let idx = 0;
    while (idx < weights.length - 1 && r >= weights[idx]) {
      r -= weights[idx];
      idx++;
    }
    result.push(pool[idx]);
    pool.splice(idx, 1);
    weights.splice(idx, 1);
  }
  return result;
}
