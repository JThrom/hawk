/**
 * Lightweight fuzzy matcher.
 *
 * Subsequence match with a bonus for contiguous runs, word boundaries, and
 * prefix matches. Returns a score (higher = better) or null for no match.
 * Dependency-free; adequate for a launcher's app list.
 */

export interface FuzzyMatch {
  score: number;
}

export function fuzzyScore(query: string, target: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0 };
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Fast paths.
  if (t === q) return { score: 1000 };
  if (t.startsWith(q)) return { score: 800 - (t.length - q.length) };
  const idx = t.indexOf(q);
  if (idx >= 0) {
    // Contiguous substring match; earlier + shorter is better.
    const boundaryBonus = idx === 0 || /\W|_/.test(t[idx - 1] ?? "") ? 100 : 0;
    return { score: 500 - idx - (t.length - q.length) + boundaryBonus };
  }

  // Subsequence match.
  let score = 0;
  let ti = 0;
  let run = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    let found = -1;
    for (; ti < t.length; ti++) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
    }
    if (found === -1) return null;
    if (found === prevMatch + 1) {
      run += 1;
      score += 15 + run * 5; // contiguous bonus grows
    } else {
      run = 0;
      score += 5;
    }
    // Word boundary bonus.
    const before = t[found - 1];
    if (found === 0 || before === " " || before === "-" || before === "_") {
      score += 10;
    }
    prevMatch = found;
    ti = found + 1;
  }
  // Penalize length difference slightly.
  score -= Math.max(0, t.length - q.length) * 0.5;
  return { score };
}

/** Best score across multiple candidate strings (e.g. name, desc, tags). */
export function fuzzyScoreMany(
  query: string,
  targets: string[],
): FuzzyMatch | null {
  let best: FuzzyMatch | null = null;
  for (const target of targets) {
    const m = fuzzyScore(query, target);
    if (m && (!best || m.score > best.score)) best = m;
  }
  return best;
}
