import { test, expect } from "bun:test";
import { fuzzyScore, fuzzyScoreMany } from "../src/search/fuzzy.ts";
import { search } from "../src/search/rank.ts";
import type { InstalledApp } from "../src/discovery/scan.ts";
import type { AppEntry } from "../src/catalog/types.ts";

test("exact match scores highest", () => {
  const exact = fuzzyScore("git", "git")!.score;
  const prefix = fuzzyScore("git", "gitui")!.score;
  const sub = fuzzyScore("git", "lazygit")!.score;
  expect(exact).toBeGreaterThan(prefix);
  expect(prefix).toBeGreaterThan(sub);
});

test("non-match returns null", () => {
  expect(fuzzyScore("xyz", "git")).toBeNull();
});

test("subsequence matches", () => {
  expect(fuzzyScore("lg", "lazygit")).not.toBeNull();
});

test("fuzzyScoreMany picks best field", () => {
  const m = fuzzyScoreMany("calc", ["tuicalc", "a calculator tool"]);
  expect(m).not.toBeNull();
});

function installed(entry: AppEntry): InstalledApp {
  return { entry, detectedVia: ["path"] };
}

const tuicalc: AppEntry = {
  id: "tuicalc",
  name: "tuicalc",
  description: "terminal calculator",
  categories: ["productivity"],
  binaries: ["tuicalc"],
  tags: ["calculator"],
};

const registryCalc: AppEntry = {
  id: "marthypad",
  name: "marthypad",
  description: "a fancy calculator",
  categories: ["productivity"],
  binaries: ["marthypad"],
  tags: ["calculator"],
  popularity: 1000,
};

test("installed ranked above registry", () => {
  const res = search("calc", [installed(tuicalc)], [registryCalc]);
  expect(res.installed.length).toBe(1);
  expect(res.installed[0]!.entry.id).toBe("tuicalc");
  expect(res.registry[0]!.entry.id).toBe("marthypad");
});
