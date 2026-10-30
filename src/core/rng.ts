// Deterministic PRNG (mulberry32). Every galaxy and every risk roll can be
// replayed from a seed, which is what makes the benchmark and the save format
// verifiable instead of "probably random".

export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
  seed(): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const api: Rng = {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(maxExclusive: number) {
      if (maxExclusive <= 0) return 0;
      return Math.floor(api.next() * maxExclusive);
    },
    range(min: number, max: number) {
      return min + api.next() * (max - min);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick() from empty list');
      return items[api.int(items.length)] as T;
    },
    chance(probability: number) {
      return api.next() < probability;
    },
    seed() {
      return seed >>> 0;
    },
  };
  return api;
}
