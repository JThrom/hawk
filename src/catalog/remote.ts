/**
 * Remote registry fetch (Phase 2).
 *
 * Fetches the CI-built `dist/index.yaml` from the configured URLs (jsDelivr
 * first, raw.githubusercontent fallback), caches it to disk with a configurable
 * TTL, and degrades gracefully: fresh cache → network → stale cache → bundled
 * registry. The parsed shape matches the local registry file, so the merge
 * logic in registry.ts is reused unchanged.
 */

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Catalog, CategoryDef, AppEntry } from "./types.ts";
import { cacheDir, ensureDir } from "../paths.ts";
import type { RegistryConfig } from "../config/schema.ts";

// Local cache remains JSON (fast native parse); the remote source is YAML.
const CACHE_FILE = "registry-index.json";
const CACHE_VERSION = 1;
const FETCH_TIMEOUT_MS = 10_000;

interface RemoteIndex {
  categories?: CategoryDef[];
  entries?: AppEntry[];
}

interface CacheShape {
  version: number;
  fetchedAt: number;
  index: RemoteIndex;
}

function cachePath(): string {
  return join(cacheDir(), CACHE_FILE);
}

function toCatalog(index: RemoteIndex): Catalog | null {
  if (!index.entries || index.entries.length === 0) return null;
  return {
    entries: index.entries,
    categories: index.categories ?? [],
    source: "registry",
  };
}

/** Read the cached remote index, or null. */
export function readRemoteCache(): { catalog: Catalog; fetchedAt: number } | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as CacheShape;
    if (data.version !== CACHE_VERSION) return null;
    const catalog = toCatalog(data.index);
    if (!catalog) return null;
    return { catalog, fetchedAt: data.fetchedAt };
  } catch {
    return null;
  }
}

function writeRemoteCache(index: RemoteIndex): void {
  ensureDir(cacheDir());
  const data: CacheShape = {
    version: CACHE_VERSION,
    fetchedAt: Date.now(),
    index,
  };
  try {
    writeFileSync(cachePath(), JSON.stringify(data));
  } catch {
    // Non-fatal.
  }
}

/** Parse an index document (YAML or JSON — YAML is a JSON superset). */
function parseIndex(text: string): RemoteIndex | null {
  try {
    const doc = parseYaml(text) as RemoteIndex;
    if (doc && Array.isArray(doc.entries) && doc.entries.length > 0) return doc;
  } catch {
    // fall through
  }
  return null;
}

/** Attempt to fetch the index from the configured URLs in order. */
async function fetchIndex(urls: string[]): Promise<RemoteIndex | null> {
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      const index = parseIndex(text);
      if (index) return index;
    } catch {
      // Try next URL.
    }
  }
  return null;
}

export interface RemoteResult {
  catalog: Catalog | null;
  /** How the catalog was obtained. */
  origin: "network" | "cache" | "stale-cache" | "none";
}

/**
 * Resolve the remote registry with cache-first semantics.
 *
 * - Registry disabled → { none }.
 * - Fresh cache → return it (no network).
 * - Otherwise fetch; on success cache + return network.
 * - On fetch failure → stale cache if present, else none.
 *
 * `onRefresh` is invoked if a background network refresh (for stale cache)
 * yields a newer catalog.
 */
export async function resolveRemoteRegistry(
  config: RegistryConfig,
  ttlMs: number,
  onRefresh?: (catalog: Catalog) => void,
): Promise<RemoteResult> {
  if (!config.enabled) return { catalog: null, origin: "none" };

  const cached = readRemoteCache();
  const fresh = cached && Date.now() - cached.fetchedAt <= ttlMs;

  if (cached && fresh) {
    return { catalog: cached.catalog, origin: "cache" };
  }

  if (cached && !fresh) {
    // Return stale immediately; refresh in background.
    void refreshInBackground(config.urls, onRefresh);
    return { catalog: cached.catalog, origin: "stale-cache" };
  }

  // No cache: must fetch synchronously.
  const index = await fetchIndex(config.urls);
  if (index) {
    writeRemoteCache(index);
    return { catalog: toCatalog(index), origin: "network" };
  }
  return { catalog: null, origin: "none" };
}

async function refreshInBackground(
  urls: string[],
  onRefresh?: (catalog: Catalog) => void,
): Promise<void> {
  const index = await fetchIndex(urls);
  if (!index) return;
  writeRemoteCache(index);
  const catalog = toCatalog(index);
  if (catalog) onRefresh?.(catalog);
}

/** Force a fresh fetch, ignoring cache. Returns null on failure. */
export async function forceFetchRemote(urls: string[]): Promise<Catalog | null> {
  const index = await fetchIndex(urls);
  if (!index) return null;
  writeRemoteCache(index);
  return toCatalog(index);
}
