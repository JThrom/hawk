import { test, expect } from "bun:test";
import { scan } from "../src/discovery/scan.ts";
import type { Catalog } from "../src/catalog/types.ts";

// Uses a catalog whose binaries are guaranteed present ("sh") and absent.
const catalog: Catalog = {
  source: "seed",
  categories: [{ id: "misc", name: "Misc" }],
  entries: [
    {
      id: "present",
      name: "Present",
      description: "should be found via PATH",
      categories: ["misc"],
      binaries: ["sh"],
    },
    {
      id: "absent",
      name: "Absent",
      description: "should not be found",
      categories: ["misc"],
      binaries: ["definitely-not-a-real-binary-xyz-123"],
    },
  ],
};

test("PATH match detects present binary and skips absent", async () => {
  const result = await scan(catalog);
  const ids = result.installed.map((a) => a.entry.id);
  expect(ids).toContain("present");
  expect(ids).not.toContain("absent");
});
