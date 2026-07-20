import { test, expect } from "bun:test";
import { loadLocalRegistry, mergeCatalogs } from "../src/catalog/registry.ts";
import { getSeedCatalog } from "../src/catalog/seed.ts";
import { getActiveCatalog } from "../src/catalog/index.ts";
import type { Catalog } from "../src/catalog/types.ts";

test("local registry loads with entries + categories", () => {
  const reg = loadLocalRegistry();
  expect(reg).not.toBeNull();
  expect(reg!.entries.length).toBeGreaterThan(100);
  expect(reg!.categories.length).toBeGreaterThan(0);
  expect(reg!.source).toBe("registry");
});

test("active catalog merges seed + registry, seed fields win", () => {
  const active = getActiveCatalog();
  // Registry breadth present.
  expect(active.entries.length).toBeGreaterThan(getSeedCatalog().entries.length);
  // Seed-curated entry retains its install metadata after merge.
  const lazygit = active.entries.find((e) => e.id === "lazygit");
  expect(lazygit?.install?.brew).toBeDefined();
});

test("merge unions categories from both catalogs", () => {
  const a: Catalog = {
    source: "seed",
    categories: [{ id: "x", name: "X" }],
    entries: [
      { id: "app", name: "App", description: "", categories: ["x"], binaries: ["app"], install: { brew: "b" } },
    ],
  };
  const b: Catalog = {
    source: "registry",
    categories: [{ id: "y", name: "Y" }],
    entries: [
      { id: "app", name: "App", description: "", categories: ["y"], binaries: ["app"] },
      { id: "other", name: "Other", description: "", categories: ["y"], binaries: ["other"] },
    ],
  };
  const merged = mergeCatalogs(a, b);
  const app = merged.entries.find((e) => e.id === "app")!;
  expect(app.categories.sort()).toEqual(["x", "y"]);
  expect(app.install?.brew).toBe("b"); // seed field preserved
  expect(merged.entries.find((e) => e.id === "other")).toBeDefined();
  expect(merged.categories.map((c) => c.id).sort()).toEqual(["x", "y"]);
});
