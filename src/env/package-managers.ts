/**
 * Package manager availability detection.
 *
 * Probes each supported package manager's binary on $PATH. Only detected
 * managers are queried during discovery (§4 of spec).
 */

import type { PackageManagerId } from "../catalog/types.ts";
import { which } from "./path.ts";

/** Binary probed to decide whether a manager is available. */
const MANAGER_BINARIES: Record<PackageManagerId, string> = {
  brew: "brew",
  apt: "apt",
  pacman: "pacman",
  cargo: "cargo",
  npm: "npm",
  bun: "bun",
  pipx: "pipx",
  pip: "pip",
  dnf: "dnf",
};

export const ALL_MANAGERS = Object.keys(MANAGER_BINARIES) as PackageManagerId[];

let cache: PackageManagerId[] | null = null;

/** Return the list of package managers available on this system. */
export function detectPackageManagers(): PackageManagerId[] {
  if (cache) return cache;
  cache = ALL_MANAGERS.filter((id) => which(MANAGER_BINARIES[id]) !== null);
  return cache;
}

export function resetPackageManagerCache(): void {
  cache = null;
}

export function managerBinary(id: PackageManagerId): string {
  return MANAGER_BINARIES[id];
}
