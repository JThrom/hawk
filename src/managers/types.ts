/**
 * Common package-manager adapter interface.
 *
 * Each adapter can report availability and list installed package names.
 * Phase 3 will extend this with `installCommand(entry)`.
 */

import type { PackageManagerId } from "../catalog/types.ts";

export interface PackageManagerAdapter {
  readonly id: PackageManagerId;
  /** True if this manager's binary is present on the system. */
  isAvailable(): boolean;
  /**
   * Return the set of installed package names (lowercased). Should never throw;
   * return an empty set on error. May be slow — callers cache the result.
   */
  listInstalled(): Promise<Set<string>>;
}
