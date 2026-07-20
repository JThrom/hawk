/**
 * Active catalog assembly.
 *
 * Combines the curated bundled seed (authoritative for detection/install
 * metadata) with the local registry (breadth). Seed takes precedence so its
 * richer fields win; registry contributes the long tail of apps + categories.
 */

import type { Catalog } from "./types.ts";
import type { HawkConfig } from "../config/schema.ts";
import { getSeedCatalog } from "./seed.ts";
import { loadLocalRegistry, mergeCatalogs } from "./registry.ts";
import { resolveRemoteRegistry } from "./remote.ts";

/**
 * Build the catalog Hawk browses/searches, synchronously.
 * Combines the bundled seed (precedence) with the local registry file.
 * Does not touch the network — safe for startup and diagnostics.
 */
export function getActiveCatalog(): Catalog {
  const seed = getSeedCatalog();
  const registry = loadLocalRegistry();
  if (!registry) return seed;
  return mergeCatalogs(seed, registry);
}

export interface ActiveCatalogResult {
  catalog: Catalog;
  /** Where the registry breadth came from. */
  registryOrigin: "local" | "network" | "cache" | "stale-cache" | "none";
}

/**
 * Build the catalog including the remote registry when enabled (Phase 2).
 * Precedence: seed > remote > local. Remote resolution degrades gracefully
 * (fresh cache → network → stale cache → local only).
 *
 * `onRefresh` fires if a background remote refresh yields a newer catalog;
 * callers should rebuild their view when invoked.
 */
export async function getActiveCatalogAsync(
  config: HawkConfig,
  onRefresh?: (catalog: Catalog) => void,
): Promise<ActiveCatalogResult> {
  const seed = getSeedCatalog();
  const local = loadLocalRegistry();

  const remote = await resolveRemoteRegistry(
    config.registry,
    config.cache.registryTtlMs,
    onRefresh
      ? (remoteCatalog) => {
          onRefresh(assemble(seed, remoteCatalog, local));
        }
      : undefined,
  );

  const catalog = assemble(seed, remote.catalog, local);
  const registryOrigin = remote.catalog
    ? remote.origin === "none"
      ? "local"
      : remote.origin
    : local
      ? "local"
      : "none";

  return { catalog, registryOrigin };
}

/** Merge available sources with seed > remote > local precedence. */
function assemble(
  seed: Catalog,
  remote: Catalog | null,
  local: Catalog | null,
): Catalog {
  const sources: Catalog[] = [seed];
  if (remote) sources.push(remote);
  if (local) sources.push(local);
  return sources.length === 1 ? seed : mergeCatalogs(...sources);
}

export * from "./types.ts";
export { getSeedCatalog } from "./seed.ts";
export { loadLocalRegistry, mergeCatalogs } from "./registry.ts";
export { resolveRemoteRegistry, forceFetchRemote } from "./remote.ts";
