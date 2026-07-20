#!/usr/bin/env bun
/**
 * Hawk entrypoint.
 *
 * Wires configuration, environment detection, catalog, discovery, and state,
 * then starts the TUI. Supports a couple of non-interactive CLI flags for
 * diagnostics.
 */

import { loadConfig } from "./config/load.ts";
import { detectEnvironment } from "./env/index.ts";
import { getActiveCatalogAsync } from "./catalog/index.ts";
import { getActiveCatalog } from "./catalog/index.ts";
import { loadInstalled } from "./discovery/cache.ts";
import { FavoritesStore } from "./state/favorites.ts";
import { UsageStore } from "./state/usage.ts";
import { HawkApp } from "./ui/app.ts";

async function printDoctor(): Promise<void> {
  const env = detectEnvironment();
  const catalog = getActiveCatalog();
  const { installed } = await loadInstalled(catalog, { ttlMs: 0 });

  const out = {
    os: env.os,
    terminal: env.terminal,
    multiplexer: env.multiplexer,
    packageManagers: env.packageManagers,
    catalogEntries: catalog.entries.length,
    installedDetected: installed.length,
    installed: installed.map((a) => ({
      id: a.entry.id,
      via: a.detectedVia,
    })),
  };
  console.log(JSON.stringify(out, null, 2));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    console.log("hawk 0.1.0");
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      [
        "hawk — TUI application launcher",
        "",
        "Usage: hawk [options]",
        "",
        "Options:",
        "  --doctor       Print detected environment + installed apps (no UI)",
        "  --version, -v  Print version",
        "  --help, -h     Show this help",
      ].join("\n"),
    );
    return;
  }
  if (args.includes("--doctor")) {
    await printDoctor();
    return;
  }

  const { config, error } = loadConfig();
  if (error) {
    process.stderr.write(`hawk: config error (using defaults): ${error}\n`);
  }

  const favorites = FavoritesStore.load(config.favorites);
  const usage = UsageStore.load();

  // Assemble catalog including the remote registry when enabled. A background
  // refresh (for stale cache) will push a newer catalog into the running app.
  let appRef: HawkApp | null = null;
  const { catalog } = await getActiveCatalogAsync(config, (updated) => {
    appRef?.updateCatalog(updated);
  });

  const { installed } = await loadInstalled(catalog, {
    ttlMs: config.cache.scanTtlMs,
  });

  const app = new HawkApp({ catalog, config, installed, favorites, usage });
  appRef = app;
  await app.start();
}

main().catch((err) => {
  process.stderr.write(`hawk: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
