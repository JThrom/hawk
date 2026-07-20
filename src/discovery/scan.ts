/**
 * Installed-app discovery.
 *
 * Matches catalog entries against the system using two complementary
 * strategies (spec §4):
 *   1. PATH match      - any of the entry's binaries exists on $PATH.
 *   2. Package match   - the entry's package name is in a manager's
 *                        installed set.
 *
 * Both run together so newly-installed apps are always caught.
 */

import type { AppEntry, Catalog, PackageManagerId } from "../catalog/types.ts";
import { hasAny } from "../env/path.ts";
import { detectPackageManagers } from "../env/package-managers.ts";
import { getAdapter } from "../managers/adapters.ts";

export type DetectionMethod = "path" | PackageManagerId;

export interface InstalledApp {
  entry: AppEntry;
  /** How the app was detected (may be multiple). */
  detectedVia: DetectionMethod[];
}

export interface ScanResult {
  installed: InstalledApp[];
  /** Managers that were queried during this scan. */
  managersQueried: PackageManagerId[];
  /** Timestamp (ms) the scan completed. */
  scannedAt: number;
}

/**
 * Query every available package manager once, returning a map of installed
 * package-name sets. Runs adapters in parallel.
 */
async function collectInstalledPackages(): Promise<
  Map<PackageManagerId, Set<string>>
> {
  const managers = detectPackageManagers();
  const results = await Promise.all(
    managers.map(async (id) => {
      const set = await getAdapter(id).listInstalled();
      return [id, set] as const;
    }),
  );
  return new Map(results);
}

/** Run a full discovery scan against the given catalog. */
export async function scan(catalog: Catalog): Promise<ScanResult> {
  const installedPackages = await collectInstalledPackages();
  const managersQueried = [...installedPackages.keys()];

  const installed: InstalledApp[] = [];

  for (const entry of catalog.entries) {
    const detectedVia: DetectionMethod[] = [];

    // 1. PATH match.
    if (hasAny(entry.binaries)) {
      detectedVia.push("path");
    }

    // 2. Package-manager match.
    if (entry.packages) {
      for (const [managerId, pkgName] of Object.entries(entry.packages)) {
        if (!pkgName) continue;
        const set = installedPackages.get(managerId as PackageManagerId);
        if (set && set.has(pkgName.toLowerCase())) {
          detectedVia.push(managerId as PackageManagerId);
        }
      }
    }

    if (detectedVia.length > 0) {
      installed.push({ entry, detectedVia });
    }
  }

  return {
    installed,
    managersQueried,
    scannedAt: Date.now(),
  };
}
