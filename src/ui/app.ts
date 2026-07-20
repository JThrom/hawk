/**
 * Hawk TUI application (spec §10).
 *
 * Two-pane Miller-column layout: categories on the left, apps on the right,
 * plus a detail line, an always-on fuzzy search bar, and a status/help bar.
 *
 * Rendering strategy: a fixed pool of Text rows per pane whose content and
 * colors are updated each render pass. Keeps the render loop allocation-free
 * and avoids child add/remove churn.
 */

import {
  createCliRenderer,
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  type ParsedKey,
} from "@opentui/core";

import type { AppEntry, Catalog } from "../catalog/types.ts";
import type { HawkConfig } from "../config/schema.ts";
import type { InstalledApp } from "../discovery/scan.ts";
import { forceRescan } from "../discovery/cache.ts";
import { forceFetchRemote } from "../catalog/remote.ts";
import { mergeCatalogs } from "../catalog/registry.ts";
import { FavoritesStore } from "../state/favorites.ts";
import { UsageStore } from "../state/usage.ts";
import { buildCategories, type CategoryView } from "./model.ts";
import { Keymap } from "./keymap.ts";
import { search } from "../search/rank.ts";
import { planLaunch, executeLaunch } from "../launch/launcher.ts";
import {
  installCandidates,
  allDeclaredInstalls,
  cycleIndex,
  type InstallCandidate,
} from "../install/select.ts";
import { planInstall, executeInstall } from "../install/installer.ts";

const MAX_ROWS = 40;

/** Cap registry suggestions shown in search to keep the list scannable. */
const REGISTRY_SUGGESTION_LIMIT = 12;

const COLORS = {
  bg: "#0d1117",
  panelBg: "#0d1117",
  border: "#30363d",
  borderFocus: "#58a6ff",
  text: "#c9d1d9",
  dim: "#6e7681",
  selBg: "#1f6feb",
  selText: "#ffffff",
  accent: "#58a6ff",
  fav: "#f0c000",
  installed: "#3fb950",
} as const;

type Focus = "categories" | "apps";

/** A row in the right-hand pane: either a section header or a selectable app. */
type Row =
  | { kind: "header"; label: string }
  | { kind: "app"; entry: AppEntry; installed: boolean };

export interface AppDeps {
  catalog: Catalog;
  config: HawkConfig;
  installed: InstalledApp[];
  favorites: FavoritesStore;
  usage: UsageStore;
}

export class HawkApp {
  private renderer!: CliRenderer;
  private keymap: Keymap;

  private catalog: Catalog;
  private config: HawkConfig;
  private installed: InstalledApp[];
  private favorites: FavoritesStore;
  private usage: UsageStore;

  /** Catalog entries that are NOT installed — the registry suggestion pool. */
  private registryOnly: AppEntry[] = [];

  private categories: CategoryView[] = [];
  private catIndex = 0;
  private appIndex = 0;
  private focus: Focus = "categories";
  private query = "";
  private status = "";
  private initialSelectionDone = false;
  /** Selected package-manager candidate index for the current app (cycling). */
  private managerIndex = 0;
  /** App id the managerIndex applies to (reset when selection changes). */
  private managerForId: string | null = null;
  /** True while an install is running (guards against re-entry). */
  private installing = false;

  // Renderables.
  private catBox!: BoxRenderable;
  private appBox!: BoxRenderable;
  private searchBox!: BoxRenderable;
  private searchText!: TextRenderable;
  private detailText!: TextRenderable;
  private helpText!: TextRenderable;
  private catRows: TextRenderable[] = [];
  private appRows: TextRenderable[] = [];

  constructor(deps: AppDeps) {
    this.catalog = deps.catalog;
    this.config = deps.config;
    this.installed = deps.installed;
    this.favorites = deps.favorites;
    this.usage = deps.usage;
    this.keymap = new Keymap(deps.config.keymap);
    this.recomputeRegistryPool();
  }

  /**
   * Replace the active catalog at runtime (e.g. background remote refresh).
   * Recomputes derived data and re-renders without disturbing the user's
   * current query where possible.
   */
  updateCatalog(catalog: Catalog): void {
    this.catalog = catalog;
    this.recomputeRegistryPool();
    this.rebuildCategories();
    if (this.renderer) this.render();
  }

  /** Recompute the registry-only pool (catalog entries not installed). */
  private recomputeRegistryPool(): void {
    const installedIds = new Set(this.installed.map((a) => a.entry.id));
    this.registryOnly = this.catalog.entries.filter(
      (e) => !installedIds.has(e.id),
    );
  }

  async start(): Promise<void> {
    this.renderer = await createCliRenderer({ exitOnCtrlC: false });
    this.buildLayout();
    this.rebuildCategories();
    this.renderer.keyInput.on("keypress", (key: ParsedKey) => {
      void this.onKey(key);
    });
    this.render();
  }

  /* ---- layout ------------------------------------------------------- */

  private buildLayout(): void {
    const root = this.renderer.root;

    // Search bar (top).
    this.searchBox = new BoxRenderable(this.renderer, {
      id: "search",
      width: "100%",
      height: 3,
      border: true,
      borderColor: COLORS.border,
      title: " Search ",
      titleColor: COLORS.accent,
      backgroundColor: COLORS.panelBg,
    });
    this.searchText = new TextRenderable(this.renderer, {
      id: "searchText",
      content: "",
      fg: COLORS.text,
    });
    this.searchBox.add(this.searchText);
    root.add(this.searchBox);

    // Middle row: two panes side by side.
    const middle = new BoxRenderable(this.renderer, {
      id: "middle",
      width: "100%",
      flexGrow: 1,
      flexDirection: "row",
      backgroundColor: COLORS.bg,
    });
    root.add(middle);

    this.catBox = new BoxRenderable(this.renderer, {
      id: "categories",
      width: 28,
      height: "100%",
      border: true,
      borderColor: COLORS.borderFocus,
      title: " Categories ",
      titleColor: COLORS.accent,
      backgroundColor: COLORS.panelBg,
    });
    middle.add(this.catBox);

    this.appBox = new BoxRenderable(this.renderer, {
      id: "apps",
      flexGrow: 1,
      height: "100%",
      border: true,
      borderColor: COLORS.border,
      title: " Apps ",
      titleColor: COLORS.accent,
      backgroundColor: COLORS.panelBg,
    });
    middle.add(this.appBox);

    // Row pools.
    for (let i = 0; i < MAX_ROWS; i++) {
      const cr = new TextRenderable(this.renderer, {
        id: `cat-row-${i}`,
        content: " ",
        height: 1,
        fg: COLORS.text,
      });
      this.catRows.push(cr);
      this.catBox.add(cr);

      const ar = new TextRenderable(this.renderer, {
        id: `app-row-${i}`,
        content: " ",
        height: 1,
        fg: COLORS.text,
      });
      this.appRows.push(ar);
      this.appBox.add(ar);
    }

    // Detail line.
    const detailBox = new BoxRenderable(this.renderer, {
      id: "detail",
      width: "100%",
      height: 4,
      border: true,
      borderColor: COLORS.border,
      title: " Details ",
      titleColor: COLORS.accent,
      backgroundColor: COLORS.panelBg,
    });
    this.detailText = new TextRenderable(this.renderer, {
      id: "detailText",
      content: "",
      fg: COLORS.dim,
    });
    detailBox.add(this.detailText);
    root.add(detailBox);

    // Help bar.
    this.helpText = new TextRenderable(this.renderer, {
      id: "help",
      content: "",
      fg: COLORS.dim,
    });
    root.add(this.helpText);
  }

  /* ---- data --------------------------------------------------------- */

  private rebuildCategories(): void {
    this.categories = buildCategories({
      catalog: this.catalog,
      installed: this.installed,
      favorites: this.favorites,
      usage: this.usage,
    });
    if (this.catIndex >= this.categories.length) this.catIndex = 0;
    // On first build, land on the first category that has apps (skip empty
    // Favorites / Recent) for a useful initial view.
    if (!this.initialSelectionDone) {
      const firstNonEmpty = this.categories.findIndex((c) => c.apps.length > 0);
      if (firstNonEmpty >= 0) this.catIndex = firstNonEmpty;
      this.initialSelectionDone = true;
    }
    this.appIndex = 0;
  }

  /** Rows currently shown in the right pane (respecting search). */
  private currentRows(): Row[] {
    if (this.query.trim().length > 0) {
      const results = search(this.query, this.installed, this.registryOnly);
      const rows: Row[] = [];
      if (results.installed.length > 0) {
        rows.push({ kind: "header", label: "Installed" });
        for (const r of results.installed) {
          rows.push({ kind: "app", entry: r.entry, installed: true });
        }
      }
      if (results.registry.length > 0) {
        rows.push({ kind: "header", label: "Available to install" });
        for (const r of results.registry.slice(0, REGISTRY_SUGGESTION_LIMIT)) {
          rows.push({ kind: "app", entry: r.entry, installed: false });
        }
      }
      return rows;
    }
    const apps = this.categories[this.catIndex]?.apps ?? [];
    return apps.map((entry) => ({ kind: "app" as const, entry, installed: true }));
  }

  /** Indices of selectable (app) rows within currentRows(). */
  private selectableIndices(rows: Row[]): number[] {
    const out: number[] = [];
    rows.forEach((r, i) => {
      if (r.kind === "app") out.push(i);
    });
    return out;
  }

  private selectedRow(): Row | undefined {
    return this.currentRows()[this.appIndex];
  }

  private selectedApp(): AppEntry | undefined {
    const row = this.selectedRow();
    return row && row.kind === "app" ? row.entry : undefined;
  }

  /** Ensure appIndex points at a selectable row (skip headers). */
  private normalizeSelection(rows: Row[]): void {
    if (rows.length === 0) {
      this.appIndex = 0;
      return;
    }
    if (this.appIndex >= rows.length) this.appIndex = rows.length - 1;
    const row = rows[this.appIndex];
    if (row && row.kind === "app") return;
    // Snap to nearest selectable row (search forward then backward).
    const selectable = this.selectableIndices(rows);
    if (selectable.length === 0) return;
    const next = selectable.find((i) => i >= this.appIndex);
    this.appIndex = next ?? selectable[selectable.length - 1]!;
  }

  /* ---- rendering ---------------------------------------------------- */

  private render(): void {
    this.renderSearch();
    this.renderCategories();
    this.renderApps();
    this.renderDetail();
    this.renderHelp();
    this.renderer.root.requestRender();
  }

  private renderSearch(): void {
    const searching = this.query.length > 0;
    this.searchText.content = searching ? this.query : "type to filter apps…";
    this.searchText.fg = searching ? COLORS.text : COLORS.dim;
  }

  private renderCategories(): void {
    const inSearch = this.query.trim().length > 0;
    this.catBox.borderColor =
      this.focus === "categories" && !inSearch
        ? COLORS.borderFocus
        : COLORS.border;

    for (let i = 0; i < MAX_ROWS; i++) {
      const row = this.catRows[i]!;
      const cat = this.categories[i];
      if (!cat) {
        row.content = " ";
        row.bg = undefined;
        continue;
      }
      const selected = i === this.catIndex && !inSearch;
      const label = ` ${cat.name} (${cat.apps.length})`;
      row.content = selected ? `▸${label}` : ` ${label}`;
      row.fg = selected ? COLORS.selText : COLORS.text;
      row.bg = selected ? COLORS.selBg : undefined;
    }
  }

  private renderApps(): void {
    const rows = this.currentRows();
    const inSearch = this.query.trim().length > 0;
    this.normalizeSelection(rows);

    this.appBox.borderColor =
      this.focus === "apps" || inSearch ? COLORS.borderFocus : COLORS.border;
    const appCount = rows.filter((r) => r.kind === "app").length;
    this.appBox.title = inSearch ? ` Results (${appCount}) ` : " Apps ";

    for (let i = 0; i < MAX_ROWS; i++) {
      const rowText = this.appRows[i]!;
      const row = rows[i];
      if (!row) {
        rowText.content = " ";
        rowText.bg = undefined;
        continue;
      }

      if (row.kind === "header") {
        rowText.content = `  ${row.label}`;
        rowText.fg = COLORS.accent;
        rowText.bg = undefined;
        continue;
      }

      const app = row.entry;
      const selected = i === this.appIndex;
      const star = this.favorites.has(app.id) ? "★ " : "  ";
      const marker = row.installed ? "" : "↓ "; // ↓ = installable
      rowText.content = `${selected ? "▸" : " "}${star}${marker}${app.name}`;
      if (selected) {
        rowText.fg = COLORS.selText;
        rowText.bg = COLORS.selBg;
      } else {
        rowText.fg = row.installed ? COLORS.text : COLORS.dim;
        rowText.bg = undefined;
      }
    }
  }

  private renderDetail(): void {
    const row = this.selectedRow();
    if (!row || row.kind !== "app") {
      this.detailText.content = this.status || "No app selected.";
      this.detailText.fg = COLORS.dim;
      return;
    }
    const app = row.entry;
    const bits = [app.description];
    if (app.language) bits.push(`· ${app.language}`);

    if (!row.installed) {
      const candidates = this.candidatesFor(app);
      if (candidates.length > 0) {
        const chosen = candidates[this.managerIndex] ?? candidates[0]!;
        const alt = candidates.length > 1 ? ` (m: ${candidates.length} managers)` : "";
        bits.push(`· i to install via ${chosen.manager}${alt}: ${chosen.command}`);
      } else {
        const declared = allDeclaredInstalls(app);
        bits.push(
          declared.length > 0
            ? `· no available manager — manual: ${declared[0]!.command}`
            : "· not installed (no install command)",
        );
      }
    } else if (app.homepage) {
      bits.push(`· ${app.homepage}`);
    }

    const line = bits.join(" ");
    this.detailText.content = this.status ? `${this.status}  |  ${line}` : line;
    this.detailText.fg = row.installed ? COLORS.dim : COLORS.installed;
  }

  /** Viable install candidates for an app, keeping the cycle index valid. */
  private candidatesFor(app: AppEntry): InstallCandidate[] {
    const candidates = installCandidates(app, this.config);
    // Reset the cycle when the selected app changes.
    if (this.managerForId !== app.id) {
      this.managerForId = app.id;
      this.managerIndex = 0;
    }
    if (this.managerIndex >= candidates.length) this.managerIndex = 0;
    return candidates;
  }

  private renderHelp(): void {
    this.helpText.content =
      " ↑/↓ move · ←/→ pane · Enter launch · i install · m manager · f favorite · / search · Esc clear · r refresh · q quit";
  }

  /* ---- input -------------------------------------------------------- */

  private async onKey(key: ParsedKey): Promise<void> {
    // Ctrl-C always quits.
    if (key.ctrl && key.name === "c") return this.quit();

    const action = this.keymap.resolve(key);
    const inSearch = this.query.trim().length > 0;

    // When typing search text, printable chars extend the query unless they
    // resolve to a navigation action while search is active.
    if (this.isPrintable(key) && (this.searchTypingContext(action))) {
      this.query += key.sequence;
      this.appIndex = 0;
      this.status = "";
      return this.render();
    }

    switch (action) {
      case "quit":
        return this.quit();
      case "clearSearch":
        this.query = "";
        this.status = "";
        return this.render();
      case "focusSearch":
        // Slash focuses search (starts filtering). If already typing, it is
        // handled as printable above.
        return this.render();
      case "up":
        this.move(-1, inSearch);
        return this.render();
      case "down":
        this.move(1, inSearch);
        return this.render();
      case "left":
        if (!inSearch) this.focus = "categories";
        return this.render();
      case "right":
        if (!inSearch) this.focus = "apps";
        return this.render();
      case "launch":
        return this.launchSelected();
      case "install":
        return this.installSelected();
      case "cycleManager":
        return this.cycleManager();
      case "toggleFavorite":
        return this.toggleFavorite();
      case "refresh":
        return this.refresh();
      default:
        // Backspace edits the search query.
        if ((key.name === "backspace" || key.name === "delete") && this.query.length > 0) {
          this.query = this.query.slice(0, -1);
          this.appIndex = 0;
          return this.render();
        }
        return;
    }
  }

  /** True if the key is a single printable character. */
  private isPrintable(key: ParsedKey): boolean {
    return (
      !key.ctrl &&
      !key.meta &&
      !key.option &&
      typeof key.sequence === "string" &&
      key.sequence.length === 1 &&
      key.sequence >= " "
    );
  }

  /**
   * Whether a printable key should extend the query. We type into search
   * except when the char is a bound nav/control key in a non-typing context.
   * Since search is always-on, printable chars always type — but we still let
   * Enter/Esc/arrows act as actions (they are not printable length-1 >= space
   * except space itself, which we allow into the query).
   */
  private searchTypingContext(action: ReturnType<Keymap["resolve"]>): boolean {
    // If focusSearch ("/") pressed as first char, treat as typing only when a
    // query already exists; otherwise it just focuses (no-op) — but simplest
    // UX: always type. Vim users expecting hjkl navigation: they navigate via
    // arrows or by clearing search with Esc.
    void action;
    return true;
  }

  private move(delta: number, inSearch: boolean): void {
    if (inSearch || this.focus === "apps") {
      const rows = this.currentRows();
      const selectable = this.selectableIndices(rows);
      if (selectable.length === 0) return;
      // Find current position within selectable rows, then step by delta.
      let pos = selectable.indexOf(this.appIndex);
      if (pos === -1) pos = 0;
      const nextPos = clamp(pos + delta, 0, selectable.length - 1);
      this.appIndex = selectable[nextPos]!;
    } else {
      if (this.categories.length === 0) return;
      this.catIndex = clamp(this.catIndex + delta, 0, this.categories.length - 1);
      this.appIndex = 0;
    }
  }

  private toggleFavorite(): void {
    const app = this.selectedApp();
    if (!app) return;
    const nowFav = this.favorites.toggle(app.id);
    this.status = nowFav ? `Pinned ${app.name}` : `Unpinned ${app.name}`;
    this.rebuildCategories();
    this.render();
  }

  private async refresh(): Promise<void> {
    this.status = "Refreshing…";
    this.render();
    try {
      // Refresh the remote registry (if enabled) in parallel with the rescan.
      const [, result] = await Promise.all([
        this.refreshRemoteRegistry(),
        forceRescan(this.catalog),
      ]);
      this.installed = result.installed;
      this.recomputeRegistryPool();
      this.rebuildCategories();
      this.status = `Found ${this.installed.length} installed apps`;
    } catch (err) {
      this.status = `Refresh failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.render();
  }

  /** Force-fetch the remote registry and merge it, if enabled. */
  private async refreshRemoteRegistry(): Promise<void> {
    if (!this.config.registry.enabled) return;
    try {
      const remote = await forceFetchRemote(this.config.registry.urls);
      if (remote) {
        this.catalog = mergeCatalogs(this.catalog, remote);
      }
    } catch {
      // Keep existing catalog on failure.
    }
  }

  private async launchSelected(): Promise<void> {
    const row = this.selectedRow();
    if (!row || row.kind !== "app") return;
    const app = row.entry;

    // Registry (not-installed) app: Enter installs it.
    if (!row.installed) {
      return this.installSelected();
    }

    const plan = planLaunch(app, this.config);
    this.usage.recordLaunch(app.id);

    if (plan.takesOverTerminal) {
      // Exec mode: tear down the renderer, run the app, then exit Hawk.
      this.renderer.destroy();
      const result = await executeLaunch(plan);
      process.exit(result.ok ? 0 : (result.code ?? 1));
    }

    // Multiplexer mode: Hawk stays running.
    const result = await executeLaunch(plan);
    this.status = result.ok
      ? `Launched ${app.name} (${plan.mode})`
      : `Launch failed: ${result.error ?? "unknown error"}`;
    this.rebuildCategories();
    this.render();
  }

  /** Cycle the chosen package manager for the selected registry app. */
  private cycleManager(): void {
    const app = this.selectedApp();
    if (!app) return;
    const candidates = this.candidatesFor(app);
    if (candidates.length <= 1) return;
    this.managerIndex = cycleIndex(this.managerIndex, candidates.length);
    const chosen = candidates[this.managerIndex]!;
    this.status = `Manager: ${chosen.manager}`;
    this.render();
  }

  /** Install the selected registry app via the chosen package manager. */
  private async installSelected(): Promise<void> {
    if (this.installing) return;
    const row = this.selectedRow();
    if (!row || row.kind !== "app") return;
    const app = row.entry;

    if (row.installed) {
      this.status = `${app.name} is already installed`;
      return this.render();
    }

    const candidates = this.candidatesFor(app);
    if (candidates.length === 0) {
      const declared = allDeclaredInstalls(app);
      this.status =
        declared.length > 0
          ? `No available manager for ${app.name} — run manually: ${declared[0]!.command}`
          : `${app.name} has no known install command`;
      return this.render();
    }

    const candidate = candidates[this.managerIndex] ?? candidates[0]!;
    const plan = planInstall(candidate);
    this.installing = true;

    if (plan.needsSuspend) {
      // No multiplexer: suspend the UI, run inline (sudo/prompts work), resume.
      this.renderer.suspend();
      const result = await executeInstall(plan);
      this.renderer.resume();
      this.installing = false;
      await this.afterInstall(app, candidate, result.ok, result.error);
      return;
    }

    // Multiplexer: install runs in a new window; Hawk keeps rendering.
    this.status = `Installing ${app.name} via ${candidate.manager} (new window)…`;
    this.render();
    const result = await executeInstall(plan);
    this.installing = false;
    if (!result.ok) {
      this.status = `Install failed to start: ${result.error ?? "unknown error"}`;
      return this.render();
    }
    // The install runs asynchronously in its window. Rescan so the app is
    // picked up once it completes (user can also press 'r' to refresh).
    await this.afterInstall(app, candidate, true, undefined, /*rescanOnly*/ true);
  }

  /** Post-install: rescan and report. */
  private async afterInstall(
    app: AppEntry,
    candidate: InstallCandidate,
    ok: boolean,
    error: string | undefined,
    windowMode = false,
  ): Promise<void> {
    try {
      const result = await forceRescan(this.catalog);
      this.installed = result.installed;
      this.recomputeRegistryPool();
      this.rebuildCategories();
    } catch {
      // Ignore rescan errors; user can refresh manually.
    }
    const nowInstalled = this.installed.some((a) => a.entry.id === app.id);
    if (windowMode) {
      this.status = nowInstalled
        ? `${app.name} installed`
        : `Installing ${app.name} via ${candidate.manager} in its window — press r when done`;
    } else if (ok && nowInstalled) {
      this.status = `Installed ${app.name} via ${candidate.manager}`;
    } else if (ok) {
      this.status = `${candidate.manager} finished but ${app.name} not detected — try r`;
    } else {
      this.status = `Install failed: ${error ?? "see output"}`;
    }
    this.render();
  }

  private quit(): void {
    this.renderer.destroy();
    process.exit(0);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
