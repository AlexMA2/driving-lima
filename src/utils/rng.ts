// Deterministic PRNG so the generated city (buildings, intersections, breakdowns...)
// is stable across reloads instead of reshuffling every run.
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rng = mulberry32(20090161); // seed references D.S. N 016-2009-MTC ;)

export function rand(min: number, max: number): number {
  return min + rng() * (max - min);
}

export function choice<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
