/**
 * Install execution (spec §9).
 *
 * Two strategies mirror app launching:
 *   - Inside a multiplexer: run the install in a NEW window so the user watches
 *     output stream while Hawk keeps running. The window stays open after
 *     completion (a `read` pause) so errors/prompts remain visible.
 *   - Otherwise: the caller suspends the renderer and runs the install inline
 *     with inherited stdio, so sudo/interactive prompts work; then resumes.
 *
 * Privilege escalation is left entirely to the underlying command — Hawk never
 * handles credentials.
 */

import type { InstallCandidate } from "./select.ts";
import { detectMultiplexer } from "../env/multiplexer.ts";

export type InstallMode = "tmux-window" | "zellij-window" | "inline";

export interface InstallPlan {
  mode: InstallMode;
  /** The raw install command (as declared by the registry entry). */
  installCommand: string;
  /** The argv actually spawned. */
  command: string[];
  /**
   * True when the plan runs inline and needs the renderer suspended first.
   */
  needsSuspend: boolean;
}

/**
 * Wrap the install command so the spawned window stays open afterwards,
 * showing success/failure before the user dismisses it.
 */
function keepOpenScript(installCommand: string): string {
  const done =
    'echo; if [ $? -eq 0 ]; then echo "[hawk] install finished."; ' +
    'else echo "[hawk] install exited with an error."; fi; ' +
    'printf "[hawk] press Enter to close…"; read _';
  // Run the install, then always show the closing prompt.
  return `${installCommand}; ${done}`;
}

/** Build an install plan for a chosen candidate without executing it. */
export function planInstall(candidate: InstallCandidate): InstallPlan {
  const mux = detectMultiplexer();
  const script = keepOpenScript(candidate.command);

  if (mux.active === "tmux") {
    return {
      mode: "tmux-window",
      installCommand: candidate.command,
      command: ["tmux", "new-window", "-n", `install:${candidate.manager}`, "sh", "-c", script],
      needsSuspend: false,
    };
  }

  if (mux.active === "zellij") {
    return {
      mode: "zellij-window",
      installCommand: candidate.command,
      command: ["zellij", "run", "--name", `install:${candidate.manager}`, "--", "sh", "-c", script],
      needsSuspend: false,
    };
  }

  // No multiplexer: run inline (renderer suspended by caller).
  return {
    mode: "inline",
    installCommand: candidate.command,
    command: ["sh", "-c", candidate.command],
    needsSuspend: true,
  };
}

export interface InstallResult {
  ok: boolean;
  code?: number | null;
  error?: string;
}

/**
 * Execute an install plan.
 *
 * - Multiplexer modes: spawn the CLI that opens the window; returns once the
 *   window is created (the install itself runs in that window).
 * - Inline mode: inherit stdio and await completion. The caller MUST suspend
 *   the renderer before calling and resume after.
 */
export async function executeInstall(plan: InstallPlan): Promise<InstallResult> {
  try {
    if (plan.mode === "inline") {
      const proc = Bun.spawn(plan.command, {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const code = await proc.exited;
      return { ok: code === 0, code };
    }

    // Multiplexer: creating the window should return quickly.
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
