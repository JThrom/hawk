/**
 * UI view-model.
 *
 * Assembles the sidebar category list (Favorites, Recent, then the registry
 * taxonomy) and resolves the apps shown for a selected category. Pure data;
 * the OpenTUI layer renders it.
 */

import type { AppEntry, Catalog } from "../catalog/types.ts";
import type { InstalledApp } from "../discovery/scan.ts";
import type { FavoritesStore } from "../state/favorites.ts";
import type { UsageStore } from "../state/usage.ts";

export interface CategoryView {
  id: string;
  name: string;
  /** Apps in this category (already ordered). */
  apps: AppEntry[];
}

export interface ModelInput {
  catalog: Catalog;
  installed: InstalledApp[];
  favorites: FavoritesStore;
  usage: UsageStore;
}

const FAVORITES_ID = "__favorites";
const RECENT_ID = "__recent";
const ALL_ID = "__all";

/** Build the ordered list of categories for the sidebar. */
export function buildCategories(input: ModelInput): CategoryView[] {
  const { catalog, installed, favorites, usage } = input;

  const installedById = new Map(installed.map((a) => [a.entry.id, a.entry]));
  const installedEntries = installed.map((a) => a.entry);

  const views: CategoryView[] = [];

  // Favorites (pinned, top). Only installed favorites are launchable.
  const favApps = favorites
    .list()
    .map((id) => installedById.get(id))
    .filter((e): e is AppEntry => e !== undefined);
  views.push({ id: FAVORITES_ID, name: "★ Favorites", apps: favApps });

  // Recent.
  const recentApps = usage
    .recentIds()
    .map((id) => installedById.get(id))
    .filter((e): e is AppEntry => e !== undefined);
  views.push({ id: RECENT_ID, name: "◷ Recent", apps: recentApps });

  // Taxonomy categories (only those with installed apps), ordered.
  const sortedCategories = [...catalog.categories].sort(
    (a, b) => (a.order ?? 999) - (b.order ?? 999),
  );
  for (const cat of sortedCategories) {
    const apps = installedEntries
      .filter((e) => e.categories.includes(cat.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (apps.length > 0) {
      views.push({ id: cat.id, name: cat.name, apps });
    }
  }

  // All Installed (flat).
  views.push({
    id: ALL_ID,
    name: "All Installed",
    apps: [...installedEntries].sort((a, b) => a.name.localeCompare(b.name)),
  });

  return views;
}
