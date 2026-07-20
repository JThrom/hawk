/**
 * Favorites (pinned apps).
 *
 * Seeded from config.favorites, editable in-app, and persisted to the data dir.
 * The persisted set is the source of truth once the user toggles anything;
 * config favorites act as the initial seed.
 */

import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dataDir, ensureDir } from "../paths.ts";

const FAV_FILE = "favorites.json";
const FAV_VERSION = 1;

interface FavShape {
  version: number;
  ids: string[];
}

function favPath(): string {
  return join(dataDir(), FAV_FILE);
}

export class FavoritesStore {
  private ids: Set<string>;

  private constructor(ids: Set<string>) {
    this.ids = ids;
  }

  /** Load persisted favorites; if none exist, seed from config. */
  static load(seed: string[] = []): FavoritesStore {
    const path = favPath();
    if (!existsSync(path)) {
      const store = new FavoritesStore(new Set(seed));
      store.persist();
      return store;
    }
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as FavShape;
      if (data.version !== FAV_VERSION) return new FavoritesStore(new Set(seed));
      return new FavoritesStore(new Set(data.ids ?? []));
    } catch {
      return new FavoritesStore(new Set(seed));
    }
  }

  private persist(): void {
    ensureDir(dataDir());
    const data: FavShape = { version: FAV_VERSION, ids: [...this.ids] };
    try {
      writeFileSync(favPath(), JSON.stringify(data));
    } catch {
      // Non-fatal.
    }
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  list(): string[] {
    return [...this.ids];
  }

  /** Toggle favorite status; returns the new state (true = now favorite). */
  toggle(id: string): boolean {
    if (this.ids.has(id)) {
      this.ids.delete(id);
    } else {
      this.ids.add(id);
    }
    this.persist();
    return this.ids.has(id);
  }
}
