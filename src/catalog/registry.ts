/**
 * Local registry loader.
 *
 * Phase 1 reads the generated `data/registry.yaml` bundled with the source
 * (produced by scripts/gen-registry.ts from awesome-tuis). In Phase 2 this
 * module will additionally fetch a remote index.json via jsDelivr; the parsed
 * shape is identical, so the merge logic below is reused.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { AppEntry, Catalog, CategoryDef } from "./types.ts";

interface RegistryFile {
  categories?: CategoryDef[];
  entries?: AppEntry[];
}

/** Candidate locations for the bundled registry file. */
function registryPaths(): string[] {
  return [
    // Relative to this module (src/catalog -> ../../data).
    join(import.meta.dir, "..", "..", "data", "registry.yaml"),
    // Relative to cwd (running from project root).
    join(process.cwd(), "data", "registry.yaml"),
  ];
}

/** Load the local registry file, or null if unavailable / invalid. */
export function loadLocalRegistry(): Catalog | null {
  for (const path of registryPaths()) {
    if (!existsSync(path)) continue;
    try {
      const data = parse(readFileSync(path, "utf8")) as RegistryFile;
      if (!data.entries || data.entries.length === 0) continue;
      return {
        entries: data.entries,
        categories: data.categories ?? [],
        source: "registry",
      };
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

/**
 * Merge multiple catalogs into one.
 *
 * Entry precedence: the first catalog listing an id wins for its fields, but
 * categories from later catalogs are unioned in (so the curated seed can add
 * install commands / packages while the registry contributes breadth).
 * Category defs are unioned by id (first definition wins).
 */
export function mergeCatalogs(...catalogs: Catalog[]): Catalog {
  const entryById = new Map<string, AppEntry>();
  const categoryById = new Map<string, CategoryDef>();

  for (const catalog of catalogs) {
    for (const cat of catalog.categories) {
      if (!categoryById.has(cat.id)) categoryById.set(cat.id, cat);
    }
    for (const entry of catalog.entries) {
      const existing = entryById.get(entry.id);
      if (!existing) {
        entryById.set(entry.id, { ...entry, categories: [...entry.categories] });
      } else {
        // Union categories; keep existing (higher-precedence) fields.
        for (const c of entry.categories) {
          if (!existing.categories.includes(c)) existing.categories.push(c);
        }
        // Fill missing detection fields from the lower-precedence entry.
        if (!existing.packages && entry.packages) existing.packages = entry.packages;
        if (!existing.install && entry.install) existing.install = entry.install;
        if (existing.binaries.length === 0) existing.binaries = entry.binaries;
      }
    }
  }

  return {
    entries: [...entryById.values()],
    categories: [...categoryById.values()],
    source: "merged",
  };
}
