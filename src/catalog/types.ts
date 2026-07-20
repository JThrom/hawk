/**
 * Shared catalog schema.
 *
 * An `AppEntry` describes a known TUI. This is the contract shared between the
 * bundled seed catalog (Phase 1) and the remote registry index (Phase 2+).
 * Detection logic consumes a `Catalog` regardless of source.
 */

/** Package managers Hawk knows how to detect / (later) install through. */
export type PackageManagerId =
  | "brew"
  | "apt"
  | "pacman"
  | "cargo"
  | "npm"
  | "bun"
  | "pipx"
  | "pip"
  | "dnf";

/** Canonical category identifiers (Phase 1 taxonomy; extended by registry). */
export type CategoryId = string;

export interface AppEntry {
  /** Stable unique identifier, e.g. "lazygit". */
  id: string;
  /** Display name. */
  name: string;
  /** Short description; used for display + search. */
  description: string;
  /** Canonical categories this app belongs to. */
  categories: CategoryId[];
  /** Free-form tags for search. */
  tags?: string[];
  /**
   * Binary name(s) used to detect the app on PATH and to launch it.
   * The first entry is the primary launch command.
   */
  binaries: string[];
  /** Install commands keyed by package manager (Phase 3 uses these). */
  install?: Partial<Record<PackageManagerId, string>>;
  /** Package name per manager, used for package-manager match detection. */
  packages?: Partial<Record<PackageManagerId, string>>;
  /** Project homepage. */
  homepage?: string;
  /** Source repository. */
  repo?: string;
  /** Popularity signal (e.g. GitHub stars) for search ranking. */
  popularity?: number;
  /** Implementation language / runtime. */
  language?: string;
}

/** A category definition in the taxonomy. */
export interface CategoryDef {
  id: CategoryId;
  name: string;
  /** Lower sorts first in the sidebar. */
  order?: number;
}

/** A resolved catalog: entries plus the category taxonomy. */
export interface Catalog {
  entries: AppEntry[];
  categories: CategoryDef[];
  /** Where this catalog came from, for diagnostics. */
  source: "seed" | "registry" | "merged";
}
