/**
 * Package-manager adapters.
 *
 * Each adapter knows how to query its manager for the set of installed
 * package names. Output is lowercased for case-insensitive matching against
 * catalog `packages` entries.
 */

import type { PackageManagerId } from "../catalog/types.ts";
import { which } from "../env/path.ts";
import { managerBinary } from "../env/package-managers.ts";
import { run, lines } from "./exec.ts";
import type { PackageManagerAdapter } from "./types.ts";

function toSet(names: string[]): Set<string> {
  return new Set(names.map((n) => n.toLowerCase()));
}

/** Factory building an adapter from a query command + output parser. */
function makeAdapter(
  id: PackageManagerId,
  buildCommand: () => string[],
  parse: (stdout: string) => string[],
): PackageManagerAdapter {
  return {
    id,
    isAvailable() {
      return which(managerBinary(id)) !== null;
    },
    async listInstalled() {
      if (!this.isAvailable()) return new Set();
      const result = await run(buildCommand());
      if (!result.ok) return new Set();
      try {
        return toSet(parse(result.stdout));
      } catch {
        return new Set();
      }
    },
  };
}

/* ---- parsers ---------------------------------------------------------- */

// brew list --formula  -> one name per line
const brew = makeAdapter("brew", () => ["brew", "list", "--formula", "-1"], lines);

// dpkg-query -f '${Package}\n' -W -> one name per line
const apt = makeAdapter(
  "apt",
  () => ["dpkg-query", "-W", "-f=${Package}\n"],
  lines,
);

// pacman -Qq -> one name per line
const pacman = makeAdapter("pacman", () => ["pacman", "-Qq"], lines);

// dnf repoquery --installed --qf '%{name}\n'  (fallback: rpm -qa --qf)
const dnf = makeAdapter(
  "dnf",
  () => ["rpm", "-qa", "--qf", "%{NAME}\n"],
  lines,
);

// cargo install --list -> lines like "gitui v0.24.3:" then indented bins
const cargo = makeAdapter(
  "cargo",
  () => ["cargo", "install", "--list"],
  (out) =>
    lines(out)
      .filter((l) => !l.startsWith(" ") && l.includes("v"))
      .map((l) => l.split(/\s+/)[0] ?? "")
      .filter((n) => n.length > 0),
);

// npm ls -g --depth=0 --parseable -> paths ending in /node_modules/<pkg>
const npm = makeAdapter(
  "npm",
  () => ["npm", "ls", "-g", "--depth=0", "--parseable"],
  (out) =>
    lines(out)
      .map((p) => p.split("/node_modules/").pop() ?? "")
      .filter((n) => n.length > 0 && !n.includes("/")),
);

// bun pm ls -g -> lines like "<pkg>@<version>"
const bun = makeAdapter(
  "bun",
  () => ["bun", "pm", "ls", "-g"],
  (out) =>
    lines(out)
      .map((l) => {
        const at = l.lastIndexOf("@");
        return at > 0 ? l.slice(0, at) : l;
      })
      .filter((n) => n.length > 0 && !n.includes(" ")),
);

// pipx list --short -> lines like "<pkg> <version>"
const pipx = makeAdapter(
  "pipx",
  () => ["pipx", "list", "--short"],
  (out) => lines(out).map((l) => l.split(/\s+/)[0] ?? "").filter(Boolean),
);

// pip list --format=freeze -> "<pkg>==<version>"
const pip = makeAdapter(
  "pip",
  () => ["pip", "list", "--format=freeze"],
  (out) =>
    lines(out)
      .map((l) => l.split("==")[0] ?? "")
      .filter((n) => n.length > 0),
);

// go: `go install` places binaries in $GOBIN / $GOPATH/bin (normally on PATH),
// so installed go apps are found by PATH match. There is no cheap installed-
// package list, so this adapter only reports availability.
const go: PackageManagerAdapter = {
  id: "go",
  isAvailable() {
    return which("go") !== null;
  },
  async listInstalled() {
    return new Set();
  },
};

export const ADAPTERS: Record<PackageManagerId, PackageManagerAdapter> = {
  brew,
  apt,
  pacman,
  dnf,
  cargo,
  npm,
  bun,
  pipx,
  pip,
  go,
};

export function getAdapter(id: PackageManagerId): PackageManagerAdapter {
  return ADAPTERS[id];
}
