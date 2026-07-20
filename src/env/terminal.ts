/**
 * Terminal capability detection.
 *
 * OpenTUI handles the heavy lifting of rendering; this exposes a few
 * environment signals Hawk may use for theming / fallbacks.
 */

export type ColorSupport = "truecolor" | "256" | "basic" | "none";

export interface TerminalInfo {
  term: string;
  colorterm: string;
  color: ColorSupport;
  /** True when stdout is an interactive TTY. */
  isTTY: boolean;
}

function detectColor(): ColorSupport {
  const colorterm = (process.env.COLORTERM ?? "").toLowerCase();
  const term = (process.env.TERM ?? "").toLowerCase();

  if (!process.stdout.isTTY) return "none";
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
  if (term.includes("256color")) return "256";
  if (term === "dumb" || term === "") return "none";
  return "basic";
}

let cache: TerminalInfo | null = null;

export function detectTerminal(): TerminalInfo {
  if (cache) return cache;
  cache = {
    term: process.env.TERM ?? "",
    colorterm: process.env.COLORTERM ?? "",
    color: detectColor(),
    isTTY: Boolean(process.stdout.isTTY),
  };
  return cache;
}
