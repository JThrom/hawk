/**
 * PATH probing utilities.
 *
 * Framework-agnostic helpers to find executables on the user's $PATH.
 */

import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";

let pathDirsCache: string[] | null = null;

/** Directories on $PATH (cached for the process lifetime). */
export function getPathDirs(): string[] {
  if (pathDirsCache) return pathDirsCache;
  const raw = process.env.PATH ?? "";
  pathDirsCache = raw.split(delimiter).filter((d) => d.length > 0);
  return pathDirsCache;
}

/** Reset the PATH cache (e.g. after an install changed the environment). */
export function resetPathCache(): void {
  pathDirsCache = null;
}

/**
 * Return the absolute path to `binary` if found on $PATH, else null.
 * Synchronous and cheap (stat-based); safe to call many times.
 */
export function which(binary: string): string | null {
  // Absolute or explicitly relative path: check directly.
  if (binary.includes("/")) {
    return existsSync(binary) ? binary : null;
  }
  for (const dir of getPathDirs()) {
    const full = join(dir, binary);
    if (existsSync(full)) return full;
  }
  return null;
}

/** True if any of the given binaries exists on $PATH. */
export function hasAny(binaries: string[]): boolean {
  return binaries.some((b) => which(b) !== null);
}
