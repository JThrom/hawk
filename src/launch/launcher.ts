/**
 * App launching (spec §6).
 *
 * Two strategies:
 *   - Inside a multiplexer: open the app in a new window (or pane) via the
 *     multiplexer's CLI. Hawk keeps running.
 *   - Otherwise: hand the terminal to the app by spawning it with inherited
 *     stdio. The caller must tear down the OpenTUI renderer first, then await
 *     the returned promise; Hawk resumes when the app exits.
 */

import type { AppEntry } from "../catalog/types.ts";
import type { HawkConfig, LaunchTarget } from "../config/schema.ts";
import { detectMultiplexer, type MultiplexerId } from "../env/multiplexer.ts";

export type LaunchMode = "tmux-window" | "tmux-pane" | "zellij-window" | "exec";

export interface LaunchPlan {
  mode: LaunchMode;
  /** The command that will run the app. */
  command: string[];
  /**
   * True if the plan replaces/suspends the Hawk UI (exec mode). The caller
   * must destroy the renderer before executing.
   */
  takesOverTerminal: boolean;
}

/** The command used to run the app itself (primary binary). */
function appCommand(entry: AppEntry): string[] {
  const bin = entry.binaries[0];
  if (!bin) throw new Error(`App ${entry.id} has no binary`);
  return [bin];
}

/** Choose which multiplexer to target given availability + config. */
function chooseMultiplexer(config: HawkConfig): MultiplexerId {
  const mux = detectMultiplexer();
  if (mux.active !== "none") return mux.active;

  const pref = config.launch.preferMultiplexer;
  if (pref === "tmux" && mux.tmuxAvailable) return "tmux";
  if (pref === "zellij" && mux.zellijAvailable) return "zellij";
  return "none";
}

/** Build a launch plan for the given app without executing it. */
export function planLaunch(entry: AppEntry, config: HawkConfig): LaunchPlan {
  const app = appCommand(entry);
  const mux = detectMultiplexer();
  const target: LaunchTarget = config.launch.target;

  if (mux.active === "tmux") {
    if (target === "pane") {
      return {
        mode: "tmux-pane",
        command: ["tmux", "split-window", "-h", ...app],
        takesOverTerminal: false,
      };
    }
    return {
      mode: "tmux-window",
      command: ["tmux", "new-window", "-n", entry.id, ...app],
      takesOverTerminal: false,
    };
  }

  if (mux.active === "zellij") {
    // zellij: run action opens a new pane/tab running the command.
    // `--floating` / `--in-place` avoided; a new pane is closest to a window.
    return {
      mode: "zellij-window",
      command: ["zellij", "run", "--name", entry.id, "--", ...app],
      takesOverTerminal: false,
    };
  }

  // No multiplexer active: exec-replace fallback.
  void chooseMultiplexer;
  return {
    mode: "exec",
    command: app,
    takesOverTerminal: true,
  };
}

export interface LaunchResult {
  ok: boolean;
  error?: string;
  /** Exit code for exec mode. */
  code?: number | null;
}

/**
 * Execute a launch plan.
 *
 * For multiplexer modes this spawns the CLI command and returns immediately.
 * For exec mode it inherits stdio and awaits the child; the caller MUST have
 * torn down the renderer beforehand.
 */
export async function executeLaunch(plan: LaunchPlan): Promise<LaunchResult> {
  try {
    if (plan.takesOverTerminal) {
      const proc = Bun.spawn(plan.command, {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const code = await proc.exited;
      return { ok: code === 0, code };
    }

    // Multiplexer command: fire and forget, but capture immediate failures.
    const proc = Bun.spawn(plan.command, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return { ok: false, code, error: stderr.trim() };
    }
    return { ok: true, code };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
