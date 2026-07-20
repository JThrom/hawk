import { test, expect } from "bun:test";
import { search } from "../src/search/rank.ts";
import type { AppEntry } from "../src/catalog/types.ts";
import type { InstalledApp } from "../src/discovery/scan.ts";

function entry(id: string, name: string, description: string, tags: string[] = []): AppEntry {
  return { id, name, description, categories: ["misc"], binaries: [id], tags };
}

function inst(e: AppEntry): InstalledApp {
  return { entry: e, detectedVia: ["path"] };
}

test("registry suggestions match identity fields, not scattered description subsequences", () => {
  const chessInstalled = inst(entry("chess-tui", "chess-tui", "play chess"));
  const noise = entry("devzat", "Devzat", "chat over ssh"); // 'chess' not in name/tags
  const real = entry("nchess", "nchess", "ncurses chess", ["chess"]);

  const r = search("chess", [chessInstalled], [noise, real]);
  const regIds = r.registry.map((x) => x.entry.id);
  expect(regIds).toContain("nchess");
  expect(regIds).not.toContain("devzat");
  // Installed always ranked in its own group.
  expect(r.installed[0]?.entry.id).toBe("chess-tui");
});

test("empty query yields no matches filtered by floor", () => {
  const r = search("", [inst(entry("a", "A", "x"))], [entry("b", "B", "y")]);
  // Empty query: floor is 0, everything matches with score 0.
  expect(r.installed.length).toBe(1);
});
