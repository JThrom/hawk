#!/usr/bin/env bun
/**
 * Registry generator.
 *
 * Parses the awesome-tuis README into `data/registry.yaml` — the local registry
 * consumed by Hawk. This mirrors the Phase 2 registry design (a data source
 * that Hawk merges with the bundled seed).
 *
 * Usage:
 *   bun run scripts/gen-registry.ts [path-to-awesome-tuis-README]
 *
 * Binary names are inferred from the repo slug / app name, with an overrides
 * map for known mismatches. Detection accuracy depends on these; extend the
 * BINARY_OVERRIDES map as needed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stringify } from "yaml";
import type { AppEntry, CategoryDef } from "../src/catalog/types.ts";

/* ---- category mapping ------------------------------------------------- */

/** awesome-tuis section title -> Hawk category id + display name. */
const CATEGORY_MAP: Record<string, { id: string; name: string; order: number }> = {
  Dashboards: { id: "dashboards", name: "Dashboards & Monitoring", order: 25 },
  Development: { id: "dev", name: "Development", order: 10 },
  "Docker/LXC/K8s": { id: "containers", name: "Docker / K8s", order: 15 },
  Editors: { id: "editors", name: "Editors", order: 50 },
  "File Managers": { id: "files", name: "File Management", order: 40 },
  Games: { id: "games", name: "Games", order: 85 },
  Messaging: { id: "messaging", name: "Messaging", order: 55 },
  Miscellaneous: { id: "misc", name: "Miscellaneous", order: 100 },
  Multimedia: { id: "media", name: "Media", order: 70 },
  Productivity: { id: "productivity", name: "Productivity", order: 80 },
  Screensavers: { id: "screensavers", name: "Screensavers", order: 95 },
  Web: { id: "web", name: "Web", order: 60 },
  // "Libraries" is intentionally excluded — not launchable end-user TUIs.
};

const SKIP_SECTIONS = new Set(["Libraries", "Table of Contents"]);

/* ---- binary inference ------------------------------------------------- */

/**
 * Known binary names that differ from the inferred slug. Keyed by lowercased
 * app id (derived from the repo slug). Extend as real installs are found.
 */
const BINARY_OVERRIDES: Record<string, string[]> = {
  "btop": ["btop"],
  "bottom": ["btm"],
  "chess-tui": ["chess-tui"],
  "atac": ["atac"],
  "slumber": ["slumber"],
  "spotify-tui": ["spt"],
  "taskwarrior-tui": ["taskwarrior-tui"],
  "gitui": ["gitui"],
  "helix": ["hx"],
  "neovim": ["nvim"],
  "s-tui": ["s-tui"],
  "gping": ["gping"],
};

/** Extract the GitHub repo slug (owner/REPO) if the URL is a github repo. */
function repoSlug(url: string): string {
  try {
    const u = new URL(url);
    if (!/github\.com$/.test(u.hostname)) return "";
    const parts = u.pathname.split("/").filter(Boolean);
    // Only accept plain owner/repo URLs (not deep paths / files).
    if (parts.length !== 2) return "";
    const repo = parts[1]!;
    if (repo.includes(".")) return ""; // e.g. something.html
    return repo.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Derive a stable id from the app name (authoritative), falling back to the
 * repo slug. Name-based ids avoid mismatches from deep/non-repo URLs.
 */
function deriveId(name: string, url: string): string {
  const fromName = name.toLowerCase();
  const slug = repoSlug(url);
  const base = fromName || slug;
  return base
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Infer candidate binary names for detection. */
function inferBinaries(id: string, name: string): string[] {
  if (BINARY_OVERRIDES[id]) return BINARY_OVERRIDES[id]!;
  const candidates = new Set<string>();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "");
  candidates.add(norm(id));
  candidates.add(norm(name));
  // Common: strip a trailing "-tui"/"-term" suffix for the plain binary.
  const stripped = id.replace(/-(tui|term|cli|rs)$/i, "");
  if (stripped !== id) candidates.add(norm(stripped));
  return [...candidates].filter((c) => c.length > 0);
}

/* ---- parsing ---------------------------------------------------------- */

interface ParsedEntry {
  name: string;
  url: string;
  description: string;
  section: string;
}

const SUMMARY_RE = /<summary><h2>(.*?)<\/h2><\/summary>/;
const BULLET_RE = /^-\s+\[([^\]]+)\]\(([^)]+)\)\s*(.*)$/;

function parse(readme: string): ParsedEntry[] {
  const lines = readme.split("\n");
  const entries: ParsedEntry[] = [];
  let section = "";
  let inToc = false;

  for (const line of lines) {
    const summary = line.match(SUMMARY_RE);
    if (summary) {
      section = summary[1]!.trim();
      inToc = false;
      continue;
    }
    if (line.startsWith("## Table of Contents")) {
      inToc = true;
      continue;
    }
    if (inToc) continue;
    if (!section || SKIP_SECTIONS.has(section)) continue;

    const m = line.match(BULLET_RE);
    if (!m) continue;
    entries.push({
      name: m[1]!.trim(),
      url: m[2]!.trim(),
      description: (m[3] ?? "").trim().replace(/\s+/g, " "),
      section,
    });
  }
  return entries;
}

/* ---- build ------------------------------------------------------------ */

function build(parsed: ParsedEntry[]): {
  entries: AppEntry[];
  categories: CategoryDef[];
} {
  const seenIds = new Set<string>();
  const entries: AppEntry[] = [];
  const usedCategories = new Set<string>();

  for (const p of parsed) {
    const cat = CATEGORY_MAP[p.section];
    if (!cat) continue;

    let id = deriveId(p.name, p.url);
    if (!id) continue;
    // Deduplicate ids (some apps appear in multiple sections).
    if (seenIds.has(id)) {
      const existing = entries.find((e) => e.id === id);
      if (existing && !existing.categories.includes(cat.id)) {
        existing.categories.push(cat.id);
        usedCategories.add(cat.id);
      }
      continue;
    }
    seenIds.add(id);
    usedCategories.add(cat.id);

    const isGithub = /github\.com/.test(p.url);
    entries.push({
      id,
      name: p.name,
      description: p.description || p.name,
      categories: [cat.id],
      binaries: inferBinaries(id, p.name),
      homepage: p.url,
      repo: isGithub ? p.url : undefined,
    });
  }

  const categories: CategoryDef[] = Object.values(CATEGORY_MAP)
    .filter((c) => usedCategories.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, order: c.order }));

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, categories };
}

/* ---- main ------------------------------------------------------------- */

function defaultReadme(): string {
  return join(homedir(), "projects", "awesome-tuis", "README.md");
}

function main(): void {
  const src = process.argv[2] ?? defaultReadme();
  const readme = readFileSync(src, "utf8");
  const parsed = parse(readme);
  const { entries, categories } = build(parsed);

  const out = {
    // Header note for humans editing the file.
    source: "awesome-tuis",
    generatedAt: new Date().toISOString(),
    categories,
    entries,
  };

  const outPath = join(import.meta.dir, "..", "data", "registry.yaml");
  writeFileSync(outPath, stringify(out, { lineWidth: 0 }));
  console.log(
    `Wrote ${entries.length} entries across ${categories.length} categories to data/registry.yaml`,
  );
}

main();
