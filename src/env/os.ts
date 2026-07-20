/**
 * Operating system and Linux distro detection.
 *
 * Used to pick the appropriate system package manager and default paths.
 */

import { existsSync, readFileSync } from "node:fs";

export type OSKind = "linux" | "macos" | "other";

export type DistroFamily =
  | "debian" // apt / dpkg
  | "arch" // pacman
  | "fedora" // dnf / rpm
  | "unknown";

export interface OSInfo {
  kind: OSKind;
  /** Linux distro family (only meaningful when kind === "linux"). */
  distro: DistroFamily;
  /** Raw platform string from process.platform. */
  platform: NodeJS.Platform;
  arch: string;
}

function detectOSKind(): OSKind {
  switch (process.platform) {
    case "linux":
      return "linux";
    case "darwin":
      return "macos";
    default:
      return "other";
  }
}

/** Parse /etc/os-release to determine the distro family. */
function detectDistro(): DistroFamily {
  const path = "/etc/os-release";
  if (!existsSync(path)) return "unknown";
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return "unknown";
  }
  const idLine = content
    .split("\n")
    .find((l) => l.startsWith("ID=") || l.startsWith("ID_LIKE="));
  const haystack = content.toLowerCase();

  if (/(debian|ubuntu|mint|pop|elementary|kali)/.test(haystack)) return "debian";
  if (/(arch|manjaro|endeavour|garuda)/.test(haystack)) return "arch";
  if (/(fedora|rhel|centos|rocky|alma)/.test(haystack)) return "fedora";
  // Fall back to explicit ID line if present.
  void idLine;
  return "unknown";
}

let cache: OSInfo | null = null;

export function detectOS(): OSInfo {
  if (cache) return cache;
  const kind = detectOSKind();
  cache = {
    kind,
    distro: kind === "linux" ? detectDistro() : "unknown",
    platform: process.platform,
    arch: process.arch,
  };
  return cache;
}
