/**
 * Scan-result disk cache.
 *
 * Stores the last discovery scan so the UI can show apps instantly on launch.
 * A background re-scan refreshes results; a manual refresh forces one.
 * Only the entry `id`s + detection methods are cached; the full entry is
 * re-resolved from the active catalog on load (keeps the cache small and
 * decoupled from catalog schema changes).
 */

import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Catalog } from "../catalog/types.ts";
import { cacheDir, ensureDir } from "../paths.ts";
import type {
  DetectionMethod,
  InstalledApp,
  ScanResult,
} from "./scan.ts";
import { scan } from "./scan.ts";

const CACHE_VERSION = 1;
const CACHE_FILE = "scan-cache.json";

interface CachedRecord {
  id: string;
  detectedVia: DetectionMethod[];
}

interface CacheShape {
  version: number;
  scannedAt: number;
  records: CachedRecord[];
}

function cachePath(): string {
  return join(cacheDir(), CACHE_FILE);
}

/** Read the cached scan, resolving ids against the active catalog. */
export function readScanCache(catalog: Catalog): ScanResult | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  let data: CacheShape;
  try {
    data = JSON.parse(readFileSync(path, "utf8")) as CacheShape;
  } catch {
    return null;
  }
  if (data.version !== CACHE_VERSION) return null;

  const byId = new Map(catalog.entries.map((e) => [e.id, e]));
  const installed: InstalledApp[] = [];
  for (const rec of data.records) {
    const entry = byId.get(rec.id);
    if (entry) installed.push({ entry, detectedVia: rec.detectedVia });
  }

  return {
    installed,
    managersQueried: [],
    scannedAt: data.scannedAt,
  };
}

/** Persist a scan result to disk (best-effort). */
export function writeScanCache(result: ScanResult): void {
  ensureDir(cacheDir());
  const data: CacheShape = {
    version: CACHE_VERSION,
    scannedAt: result.scannedAt,
    records: result.installed.map((a) => ({
      id: a.entry.id,
      detectedVia: a.detectedVia,
    })),
  };
  try {
    writeFileSync(cachePath(), JSON.stringify(data));
  } catch {
    // Non-fatal: caching is an optimization.
  }
}

/** True if the cached scan is older than `ttlMs`. */
export function isStale(result: ScanResult, ttlMs: number): boolean {
  return Date.now() - result.scannedAt > ttlMs;
}

export interface LoadOptions {
  ttlMs: number;
  /** Called when a background refresh produces newer results. */
  onRefresh?: (result: ScanResult) => void;
}

/**
 * Load installed apps with cache-first semantics:
 *   - If a fresh cache exists, return it immediately.
 *   - If cache is stale (or missing), trigger a scan.
 *   - When cache exists but is stale, return it now and refresh in background.
 */
export async function loadInstalled(
  catalog: Catalog,
  opts: LoadOptions,
): Promise<ScanResult> {
  const cached = readScanCache(catalog);

  if (cached && !isStale(cached, opts.ttlMs)) {
    return cached;
  }

  if (cached) {
    // Stale: return cached immediately, refresh in background.
    void refreshInBackground(catalog, opts.onRefresh);
    return cached;
  }

  // No cache: must scan synchronously.
  const fresh = await scan(catalog);
  writeScanCache(fresh);
  return fresh;
}

async function refreshInBackground(
  catalog: Catalog,
  onRefresh?: (result: ScanResult) => void,
): Promise<void> {
  try {
    const fresh = await scan(catalog);
    writeScanCache(fresh);
    onRefresh?.(fresh);
  } catch {
    // Ignore background failures; stale cache remains usable.
  }
}

/** Force a fresh scan, updating the cache. Used by the manual refresh key. */
export async function forceRescan(catalog: Catalog): Promise<ScanResult> {
  const fresh = await scan(catalog);
  writeScanCache(fresh);
  return fresh;
}
