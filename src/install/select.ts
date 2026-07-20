/**
 * Package-manager selection for installs (spec §9).
 *
 * Determines which package managers can install a given app: the intersection
 * of the app's declared `install` commands and the managers detected on the
 * system, ordered by the user's `managerPreference`. The first candidate is
 * the auto-pick; the UI can cycle through the rest.
 */

import type { AppEntry, PackageManagerId } from "../catalog/types.ts";
import type { HawkConfig } from "../config/schema.ts";
import { detectPackageManagers } from "../env/package-managers.ts";

export interface InstallCandidate {
  manager: PackageManagerId;
  /** The install command string from the app entry. */
  command: string;
}

/**
 * Ordered list of viable install candidates for `app`.
 *
 * A candidate is viable when the app declares an install command for a manager
 * AND that manager is available on the system. Ordering follows
 * `config.managerPreference`; managers not in the preference list come last.
 */
export function installCandidates(
  app: AppEntry,
  config: HawkConfig,
  available: PackageManagerId[] = detectPackageManagers(),
): InstallCandidate[] {
  if (!app.install) return [];
  const availableSet = new Set(available);

  const declared = Object.entries(app.install)
    .filter(([mgr, cmd]) => cmd && availableSet.has(mgr as PackageManagerId))
    .map(([mgr, cmd]) => ({ manager: mgr as PackageManagerId, command: cmd! }));

  const pref = config.managerPreference;
  const rank = (m: PackageManagerId) => {
    const i = pref.indexOf(m);
    return i === -1 ? pref.length : i;
  };

  return declared.sort((a, b) => rank(a.manager) - rank(b.manager));
}

/**
 * All install commands declared by the app, regardless of availability.
 * Used to show a manual command when nothing is installable locally.
 */
export function allDeclaredInstalls(app: AppEntry): InstallCandidate[] {
  if (!app.install) return [];
  return Object.entries(app.install)
    .filter(([, cmd]) => Boolean(cmd))
    .map(([mgr, cmd]) => ({ manager: mgr as PackageManagerId, command: cmd! }));
}

/** Advance the selected candidate index, wrapping around. */
export function cycleIndex(current: number, count: number): number {
  if (count <= 0) return 0;
  return (current + 1) % count;
}
