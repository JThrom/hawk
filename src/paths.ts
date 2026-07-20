/**
 * XDG base directory resolution for Hawk's config, cache, and data.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const APP = "hawk";

function base(envVar: string, fallback: string): string {
  const v = process.env[envVar];
  if (v && v.length > 0) return v;
  return join(homedir(), fallback);
}

export function configDir(): string {
  return join(base("XDG_CONFIG_HOME", ".config"), APP);
}

export function cacheDir(): string {
  return join(base("XDG_CACHE_HOME", ".cache"), APP);
}

export function dataDir(): string {
  return join(base("XDG_DATA_HOME", ".local/share"), APP);
}

export function configFile(): string {
  return join(configDir(), "config.yaml");
}

/** Ensure a directory exists (recursive, ignores if already present). */
export function ensureDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // Best effort; callers handle downstream I/O errors.
  }
}
