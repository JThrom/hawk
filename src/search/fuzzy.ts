/**
 * Lightweight fuzzy matcher.
 *
 * Returns a score (higher = better) AND a match "kind" describing quality, so
 * callers can require stronger matches for noisy fields (e.g. descriptions)
 * than for identity fields (name/tags). Dependency-free.
 */

/**
 * Match quality, best to worst:
 *  - exact:       target equals query
 *  - prefix:      target starts with query
 *  - word:        query is a substring starting at a word boundary
 *  - substring:   query is a substring anywhere
 *  - subsequence: query chars appear in order but not contiguous (weakest)
 */
export type MatchKind = "exact" | "prefix" | "word" | "substring" | "subsequence";

export interface FuzzyMatch {
  score: number;
  kind: MatchKind;
}

const KIND_RANK: Record<MatchKind, number> = {
  exact: 5,
  prefix: 4,
  word: 3,
  substring: 2,
  subsequence: 1,
};

/** True if `a` is a stronger (or equal) match kind than `b`. */
export function kindAtLeast(a: MatchKind, b: MatchKind): boolean {
  return KIND_RANK[a] >= KIND_RANK[b];
}

function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === " " || ch === "-" || ch === "_" || ch === "/" || ch === ".";
}

/** Score a single query token (no spaces) against a target string. */
function scoreToken(q: string, t: string): FuzzyMatch | null {
  if (q.length === 0) return { score: 0, kind: "substring" };

  if (t === q) return { score: 1000, kind: "exact" };
  if (t.startsWith(q)) return { score: 800 - (t.length - q.length), kind: "prefix" };

  const idx = t.indexOf(q);
  if (idx >= 0) {
    const boundary = isBoundary(t[idx - 1]);
    const kind: MatchKind = boundary ? "word" : "substring";
    const boundaryBonus = boundary ? 100 : 0;
    return { score: 500 - idx - (t.length - q.length) + boundaryBonus, kind };
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
      score += 15 + run * 5;
    } else {
      run = 0;
      score += 5;
    }
    if (isBoundary(t[found - 1])) score += 10;
    prevMatch = found;
    ti = found + 1;
  }
  score -= Math.max(0, t.length - q.length) * 0.5;
  return { score, kind: "subsequence" };
}

/**
 * Score a query against a target. Multi-word queries ("file manager") are
 * matched token-by-token: every token must be found somewhere in the target;
 * the result kind is the WEAKEST token kind (so a phrase only counts as a
 * strong match if all its words match strongly), and the score is the sum.
 */
export function fuzzyScore(query: string, target: string): FuzzyMatch | null {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();
  if (q.length === 0) return { score: 0, kind: "substring" };

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return scoreToken(q, t);

  // Whole-phrase match takes precedence if present.
  const whole = scoreToken(q, t);
  if (whole && (whole.kind === "exact" || whole.kind === "prefix" || whole.kind === "word")) {
    return whole;
  }

  let total = 0;
  let weakest: MatchKind = "exact";
  for (const tok of tokens) {
    const m = scoreToken(tok, t);
    if (!m) return null;
    total += m.score;
    if (KIND_RANK[m.kind] < KIND_RANK[weakest]) weakest = m.kind;
  }
  return { score: total, kind: weakest };
}

/** Best match across multiple candidate strings (e.g. name, tags). */
export function fuzzyScoreMany(query: string, targets: string[]): FuzzyMatch | null {
  let best: FuzzyMatch | null = null;
  for (const target of targets) {
    const m = fuzzyScore(query, target);
    if (m && (!best || m.score > best.score)) best = m;
  }
  return best;
}
