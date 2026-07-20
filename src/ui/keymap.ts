/**
 * Keymap resolution.
 *
 * Translates an OpenTUI ParsedKey into a Hawk Action using the config keymap.
 * Config maps action -> list of key names; we invert it for O(1) lookup.
 */

import type { ParsedKey } from "@opentui/core";
import type { Action, KeymapConfig } from "../config/schema.ts";

export class Keymap {
  private lookup = new Map<string, Action>();

  constructor(keymap: KeymapConfig) {
    for (const [action, keys] of Object.entries(keymap)) {
      for (const key of keys) {
        this.lookup.set(key.toLowerCase(), action as Action);
      }
    }
  }

  /** Resolve a key event to an action, or null if unbound. */
  resolve(key: ParsedKey): Action | null {
    const name = (key.name ?? "").toLowerCase();
    if (name && this.lookup.has(name)) return this.lookup.get(name)!;
    // Fall back to raw sequence for keys like "/".
    const seq = key.sequence ?? "";
    if (seq && this.lookup.has(seq)) return this.lookup.get(seq)!;
    return null;
  }
}
