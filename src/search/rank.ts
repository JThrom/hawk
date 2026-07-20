/**
 * Search ranking (spec §8) — find-by-function.
 *
 * TUIs have non-descriptive names, so search weights description + tags as
 * heavily as name/id/binary. To avoid noise, descriptions are matched with a
 * higher quality bar (word/substring), while identity fields (name/id/tags/
 * binaries) accept looser fuzzy matches.
 *
 * Two grouped sections: installed matches (always above), then registry
 * suggestions (below, + popularity).
 */

import type { AppEntry } from "../catalog/types.ts";
import type { InstalledApp } from "../discovery/scan.ts";
import { fuzzyScore, kindAtLeast, type MatchKind } from "./fuzzy.ts";

export interface RankedApp {
  entry: AppEntry;
  installed: boolean;
  score: number;
  /** Which field produced the best match (for potential UI hints). */
  matchedField: "name" | "id" | "binary" | "tag" | "description";
}

export interface SearchResults {
  installed: RankedApp[];
  registry: RankedApp[];
}

/** Field weights: identity fields rank above function fields on ties. */
const WEIGHT = {
  name: 1.0,
  id: 0.9,
  binary: 0.85,
  tag: 0.95, // tags are curated function signals — weight them high
  description: 0.8,
} as const;

/**
 * Minimum quality required for a DESCRIPTION match to count. Scattered
 * subsequence matches in prose are almost always noise ("chess" hitting
 * "...cha[r]t...s...s"), so require at least a contiguous substring.
 */
const DESCRIPTION_MIN_KIND: MatchKind = "substring";

interface FieldMatch {
  score: number;
  field: RankedApp["matchedField"];
}

/** Best match for an app across all fields, applying per-field quality rules. */
function scoreEntry(query: string, entry: AppEntry): FieldMatch | null {
  let best: FieldMatch | null = null;
  const consider = (
    value: string,
    field: RankedApp["matchedField"],
    weight: number,
    minKind?: MatchKind,
  ) => {
    const m = fuzzyScore(query, value);
    if (!m) return;
    if (minKind && !kindAtLeast(m.kind, minKind)) return;
    const weighted = m.score * weight;
    if (!best || weighted > best.score) best = { score: weighted, field };
  };

  consider(entry.name, "name", WEIGHT.name);
  consider(entry.id, "id", WEIGHT.id);
  for (const bin of entry.binaries) consider(bin, "binary", WEIGHT.binary);
  for (const tag of entry.tags ?? []) consider(tag, "tag", WEIGHT.tag);
  consider(entry.description, "description", WEIGHT.description, DESCRIPTION_MIN_KIND);

  return best;
}

/**
 * Rank a query against installed apps and (optionally) registry-only entries.
 * `registryEntries` should exclude anything already installed.
 */
export function search(
  query: string,
  installed: InstalledApp[],
  registryEntries: AppEntry[] = [],
): SearchResults {
  const q = query.trim();

  const installedRanked: RankedApp[] = [];
  for (const app of installed) {
    const m = scoreEntry(q, app.entry);
    if (m) {
      installedRanked.push({
        entry: app.entry,
        installed: true,
        score: m.score,
        matchedField: m.field,
      });
    }
  }
  installedRanked.sort((a, b) => b.score - a.score);

  const registryRanked: RankedApp[] = [];
  for (const entry of registryEntries) {
    const m = scoreEntry(q, entry);
    if (m) {
      // Blend match score with popularity (log-scaled) for suggestions.
      const pop = entry.popularity ? Math.log10(entry.popularity + 1) * 20 : 0;
      registryRanked.push({
        entry,
        installed: false,
        score: m.score + pop,
        matchedField: m.field,
      });
    }
  }
  registryRanked.sort((a, b) => b.score - a.score);

  return { installed: installedRanked, registry: registryRanked };
}
