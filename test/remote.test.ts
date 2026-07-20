import { test, expect, afterEach, beforeEach } from "bun:test";
import { resolveRemoteRegistry, forceFetchRemote } from "../src/catalog/remote.ts";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "../src/paths.ts";
import type { RegistryConfig } from "../src/config/schema.ts";

const CACHE = join(cacheDir(), "registry-index.json");

const SAMPLE = {
  categories: [{ id: "dev", name: "Development" }],
  entries: [
    { id: "foo", name: "Foo", description: "a foo", categories: ["dev"], binaries: ["foo"] },
  ],
};

const originalFetch = globalThis.fetch;

function mockFetch(ok: boolean) {
  globalThis.fetch = (async () => {
    if (!ok) throw new Error("network down");
    return new Response(JSON.stringify(SAMPLE), { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  if (existsSync(CACHE)) rmSync(CACHE);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (existsSync(CACHE)) rmSync(CACHE);
});

const config: RegistryConfig = {
  enabled: true,
  urls: ["https://example.test/index.json"],
};

test("disabled registry returns none without network", async () => {
  const disabled: RegistryConfig = { ...config, enabled: false };
  const r = await resolveRemoteRegistry(disabled, 1000);
  expect(r.origin).toBe("none");
  expect(r.catalog).toBeNull();
});

test("fetches over network and caches", async () => {
  mockFetch(true);
  const r = await resolveRemoteRegistry(config, 60_000);
  expect(r.origin).toBe("network");
  expect(r.catalog?.entries[0]?.id).toBe("foo");
  expect(existsSync(CACHE)).toBe(true);
});

test("uses fresh cache without refetching", async () => {
  mockFetch(true);
  await forceFetchRemote(config.urls); // populate cache
  mockFetch(false); // network now broken
  const r = await resolveRemoteRegistry(config, 60_000);
  expect(r.origin).toBe("cache");
  expect(r.catalog?.entries[0]?.id).toBe("foo");
});

test("network failure with no cache returns none", async () => {
  mockFetch(false);
  const r = await resolveRemoteRegistry(config, 60_000);
  expect(r.origin).toBe("none");
  expect(r.catalog).toBeNull();
});
