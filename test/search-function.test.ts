import { test, expect } from "bun:test";
import { search } from "../src/search/rank.ts";
import { fuzzyScore } from "../src/search/fuzzy.ts";
import type { AppEntry } from "../src/catalog/types.ts";
import type { InstalledApp } from "../src/discovery/scan.ts";

function entry(id: string, name: string, description: string, tags: string[] = []): AppEntry {
  return { id, name, description, categories: ["misc"], binaries: [id], tags };
}
function inst(e: AppEntry): InstalledApp {
  return { entry: e, detectedVia: ["path"] };
}

// Core principle: find by function, not name (spec §8).

test("finds an app by its description when the name is non-descriptive (aws -> claws)", () => {
  const claws = inst(entry("claws", "claws", "A terminal UI for AWS resource management"));
  const other = inst(entry("btop", "btop", "resource monitor"));
  const r = search("aws", [claws, other], []);
  expect(r.installed[0]?.entry.id).toBe("claws");
});

test("registry function match via description (aws -> tool without aws in name)", () => {
  const e1s = entry("e1s", "e1s", "Terminal UI to manage AWS ECS resources");
  const noise = entry("foo", "foo", "a note taking tool");
  const r = search("aws", [], [e1s, noise]);
  const ids = r.registry.map((x) => x.entry.id);
  expect(ids).toContain("e1s");
  expect(ids).not.toContain("foo");
});

test("finds calculators by function, not just name", () => {
  const calc = entry("numbers-app", "Numbers", "a scientific calculator for the terminal");
  const named = entry("calcthing", "calcthing", "a todo list");
  const r = search("calculator", [], [calc, named]);
  expect(r.registry[0]?.entry.id).toBe("numbers-app");
});

test("multi-word queries match all tokens (file manager)", () => {
  const yazi = entry("yazi", "yazi", "blazing fast terminal file manager");
  const editor = entry("edix", "edix", "a text editor");
  const r = search("file manager", [], [yazi, editor]);
  const ids = r.registry.map((x) => x.entry.id);
  expect(ids).toContain("yazi");
  expect(ids).not.toContain("edix");
});

test("tags are weighted as strong function signals", () => {
  const app = entry("weird", "weird", "does stuff", ["aws", "cloud"]);
  const r = search("aws", [], [app]);
  expect(r.registry[0]?.entry.id).toBe("weird");
  expect(r.registry[0]?.matchedField).toBe("tag");
});

test("scattered description subsequence is NOT a match (noise control)", () => {
  // 'chess' as scattered subsequence inside an unrelated description.
  const noise = entry("chart-tool", "chart-tool", "charts and graphs everywhere shown simply");
  const r = search("chess", [], [noise]);
  expect(r.registry.length).toBe(0);
});

test("fuzzy reports match kind", () => {
  expect(fuzzyScore("aws", "aws")?.kind).toBe("exact");
  expect(fuzzyScore("aws", "awsui")?.kind).toBe("prefix");
  expect(fuzzyScore("aws", "cl aws")?.kind).toBe("word");
  expect(fuzzyScore("aws", "claws")?.kind).toBe("substring");
  expect(fuzzyScore("abc", "a-b-c-x")?.kind).toBe("subsequence");
});
