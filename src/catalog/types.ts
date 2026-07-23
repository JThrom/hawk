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
  | "dnf"
  | "go";

/** Canonical category identifiers (Phase 1 taxonomy; extended by registry). */
export type CategoryId = string;

/**
 * A launch argument an app accepts (e.g. a required `path`). Hawk prompts the
 * user for these via a modal before launching, and appends them to the command.
 */
export interface LaunchArg {
  /** Argument name (for display). */
  name: string;
  /** What the argument is, shown in the prompt + details. */
  description?: string;
  /** Whether the app cannot launch without it. */
  required?: boolean;
  /** Example / hint shown in the input field. */
  placeholder?: string;
  /**
   * Optional flag prefix, e.g. "--path". When set the value is passed as
   * `<flag> <value>`; otherwise it's passed positionally.
   */
  flag?: string;
  /** Default value pre-filled in the input. */
  default?: string;
}

/** Launch configuration for an app. */
export interface LaunchSpec {
  /** Ordered arguments to prompt for before launching. */
  args?: LaunchArg[];
}

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
  /**
   * Extracted installation instructions (markdown) from the app's README.
   * Shown by Hawk when no package-manager install command is available. The
   * full README is stored as a sidecar in the registry, not inlined here.
   */
  installNotes?: string;
  /** URL to the full README (raw) for on-demand viewing. */
  readmeUrl?: string;
  /** Launch arguments/options the app accepts (prompted before launch). */
  launch?: LaunchSpec;
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
