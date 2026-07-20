/**
 * Terminal multiplexer detection.
 *
 * Detects whether Hawk is running inside tmux or zellij. The launcher uses
 * this to open apps in a new window; otherwise it exec-replaces the process.
 */

import { which } from "./path.ts";

export type MultiplexerId = "tmux" | "zellij" | "none";

export interface MultiplexerInfo {
  /** The multiplexer Hawk is currently running inside, or "none". */
  active: MultiplexerId;
  /** Whether the tmux binary is available on PATH. */
  tmuxAvailable: boolean;
  /** Whether the zellij binary is available on PATH. */
  zellijAvailable: boolean;
}

let cache: MultiplexerInfo | null = null;

export function detectMultiplexer(): MultiplexerInfo {
  if (cache) return cache;

  let active: MultiplexerId = "none";
  if (process.env.ZELLIJ) {
    active = "zellij";
  } else if (process.env.TMUX) {
    active = "tmux";
  }

  cache = {
    active,
    tmuxAvailable: which("tmux") !== null,
    zellijAvailable: which("zellij") !== null,
  };
  return cache;
}

export function resetMultiplexerCache(): void {
  cache = null;
}
