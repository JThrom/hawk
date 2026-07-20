/**
 * Config schema + defaults.
 *
 * Hawk maximizes configurability (spec §11). Every value here is overridable in
 * ~/.config/hawk/config.yaml. Strong defaults mean zero-config works.
 */

import type { PackageManagerId } from "../catalog/types.ts";

/** Where an app is launched when inside a multiplexer. */
export type LaunchTarget = "window" | "pane";

/** Action names bindable to keys. */
export type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "launch"
  | "focusSearch"
  | "clearSearch"
  | "toggleFavorite"
  | "refresh"
  | "quit";

export interface KeymapConfig {
  /** Map of action -> list of key names that trigger it. */
  [action: string]: string[];
}

export interface CacheConfig {
  /** Scan-result TTL in ms before a background refresh triggers. */
  scanTtlMs: number;
  /** Registry index TTL in ms (Phase 2). */
  registryTtlMs: number;
}

export interface LaunchConfig {
  /** Default target inside a multiplexer. */
  target: LaunchTarget;
  /** Preferred multiplexer when both tmux and zellij are available. */
  preferMultiplexer: "tmux" | "zellij" | "auto";
}

export interface RegistryConfig {
  /** Enable remote registry (Phase 2). Off in Phase 1. */
  enabled: boolean;
  /** Ordered list of index.json URLs; first reachable wins. */
  urls: string[];
}

export interface HawkConfig {
  keymap: KeymapConfig;
  cache: CacheConfig;
  launch: LaunchConfig;
  registry: RegistryConfig;
  /** Package-manager preference order for installs (Phase 3). */
  managerPreference: PackageManagerId[];
  /** Package managers to skip during discovery scans. */
  disabledScanners: PackageManagerId[];
  /** App ids pinned as favorites (also editable in-app). */
  favorites: string[];
}

export const DEFAULT_CONFIG: HawkConfig = {
  keymap: {
    up: ["k", "up"],
    down: ["j", "down"],
    left: ["h", "left"],
    right: ["l", "right"],
    launch: ["return", "enter"],
    focusSearch: ["/"],
    clearSearch: ["escape"],
    toggleFavorite: ["f"],
    refresh: ["r"],
    quit: ["q"],
  },
  cache: {
    scanTtlMs: 24 * 60 * 60 * 1000, // 24h
    registryTtlMs: 24 * 60 * 60 * 1000, // 24h
  },
  launch: {
    target: "window",
    preferMultiplexer: "auto",
  },
  registry: {
    enabled: false,
    urls: [
      "https://cdn.jsdelivr.net/gh/OWNER/hawk-registry@main/dist/index.json",
      "https://raw.githubusercontent.com/OWNER/hawk-registry/main/dist/index.json",
    ],
  },
  managerPreference: ["cargo", "brew", "bun", "npm", "pipx", "pacman", "dnf", "apt", "pip"],
  disabledScanners: [],
  favorites: [],
};
