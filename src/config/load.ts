/**
 * Config loading: read ~/.config/hawk/config.yaml and deep-merge over defaults.
 *
 * Unknown / partial config is tolerated: user values override defaults key by
 * key, and missing keys fall back. Parse errors fall back to defaults entirely.
 */

import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { configFile } from "../paths.ts";
import { DEFAULT_CONFIG, type HawkConfig } from "./schema.ts";

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursively merge `override` onto `base`. Arrays are replaced, not merged. */
function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : (override as T));
  }
  const out: Plain = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseVal = (base as Plain)[key];
    if (isPlainObject(baseVal) && isPlainObject(value)) {
      out[key] = deepMerge(baseVal, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

export interface LoadedConfig {
  config: HawkConfig;
  /** Path read from, if it existed. */
  path: string | null;
  /** Any error encountered while parsing (config falls back to defaults). */
  error: string | null;
}

export function loadConfig(): LoadedConfig {
  const path = configFile();
  if (!existsSync(path)) {
    return { config: DEFAULT_CONFIG, path: null, error: null };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = parse(raw) as unknown;
    const merged = deepMerge(DEFAULT_CONFIG, parsed ?? {});
    return { config: merged, path, error: null };
  } catch (err) {
    return {
      config: DEFAULT_CONFIG,
      path,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
