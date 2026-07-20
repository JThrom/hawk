import { test, expect } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config/schema.ts";

test("defaults are complete and sane", () => {
  expect(DEFAULT_CONFIG.launch.target).toBe("window");
  expect(DEFAULT_CONFIG.cache.scanTtlMs).toBeGreaterThan(0);
  expect(DEFAULT_CONFIG.keymap.quit).toContain("q");
  expect(DEFAULT_CONFIG.keymap.launch).toContain("return");
  expect(DEFAULT_CONFIG.registry.enabled).toBe(true);
  expect(DEFAULT_CONFIG.registry.urls[0]).toContain("dist/index.yaml");
});
