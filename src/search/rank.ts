/**
 * Search ranking (spec §8).
 *
 * Two grouped sections:
 *   1. Installed matches (always above), fuzzy-scored.
 *   2. Registry suggestions (below), fuzzy-scored + popularity.
 * The registry group is empty in Phase 1 (no registry).
 */

import type { AppEntry } from "../catalog/types.ts";
import type { InstalledApp } from "../discovery/scan.ts";
import { fuzzyScoreMany } from "./fuzzy.ts";

export interface RankedApp {
  entry: AppEntry;
  installed: boolean;
  score: number;
}

export interface SearchResults {
  installed: RankedApp[];
  registry: RankedApp[];
}

/** Primary identity fields — strong match signals. */
function primaryFields(entry: AppEntry): string[] {
  return [entry.name, entry.id, ...(entry.tags ?? []), ...entry.binaries];
}

/** All fields including description — broader, noisier match. */
function searchFields(entry: AppEntry): string[] {
  return [...primaryFields(entry), entry.description];
}

/**
 * Minimum score to accept a match, scaling with query length. Longer queries
 * that only scrape a scattered subsequence should be rejected as noise.
 */
function minScore(query: string): number {
  const len = query.trim().length;
  if (len <= 1) return 0;
  if (len <= 3) return 20;
  return 30 + (len - 3) * 8;
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
  const floor = minScore(q);

  // Installed matches search all fields (broad) but still respect the floor.
  const installedRanked: RankedApp[] = [];
  for (const app of installed) {
    const m = fuzzyScoreMany(q, searchFields(app.entry));
    if (m && m.score >= floor) {
      installedRanked.push({ entry: app.entry, installed: true, score: m.score });
    }
  }
  installedRanked.sort((a, b) => b.score - a.score);

  // Registry suggestions match primary identity fields only (less noise) and
  // require a higher bar so they read as relevant alternatives.
  const registryFloor = floor + 20;
  const registryRanked: RankedApp[] = [];
  for (const entry of registryEntries) {
    const m = fuzzyScoreMany(q, primaryFields(entry));
    if (m && m.score >= registryFloor) {
      // Blend match score with popularity (log-scaled) for suggestions.
      const pop = entry.popularity ? Math.log10(entry.popularity + 1) * 20 : 0;
      registryRanked.push({ entry, installed: false, score: m.score + pop });
    }
  }
  registryRanked.sort((a, b) => b.score - a.score);

  return { installed: installedRanked, registry: registryRanked };
}
