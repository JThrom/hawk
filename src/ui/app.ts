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

import type { AppEntry, Catalog, LaunchArg } from "../catalog/types.ts";
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
import { planLaunch, executeLaunch, buildLaunchArgs } from "../launch/launcher.ts";
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
  /** First visible row index in each list pane (scroll offset). */
  private catScroll = 0;
  private appScroll = 0;
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
  /** Whether the install-notes overlay is visible. */
  private notesVisible = false;
  /** Scroll offset (top line) within the notes overlay. */
  private notesScroll = 0;

  // Renderables.
  private catBox!: BoxRenderable;
  private appBox!: BoxRenderable;
  private detailBox!: BoxRenderable;
  private searchBox!: BoxRenderable;
  private searchText!: TextRenderable;
  private detailText!: TextRenderable;
  private notesBox!: BoxRenderable;
  private notesText!: TextRenderable;
  private helpBox!: BoxRenderable;
  private helpModalText!: TextRenderable;
  private promptBox!: BoxRenderable;
  private promptText!: TextRenderable;
  private catRows: TextRenderable[] = [];
  private appRows: TextRenderable[] = [];
  /** Whether the keybindings help modal is visible. */
  private helpVisible = false;

  /** Active launch-argument prompt, if any. */
  private prompt: {
    app: AppEntry;
    args: LaunchArg[];
    /** Index of the arg currently being entered. */
    index: number;
    /** Collected values by arg name. */
    values: Record<string, string>;
    /** Current input buffer for the active arg. */
    buffer: string;
    /** Transient validation message. */
    error: string;
  } | null = null;

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

    // Middle row: three columns — categories | apps | details.
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
      width: "20%",
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
      width: "20%",
      height: "100%",
      border: true,
      borderColor: COLORS.border,
      title: " Apps ",
      titleColor: COLORS.accent,
      backgroundColor: COLORS.panelBg,
    });
    middle.add(this.appBox);

    // Details column (widest, multi-line).
    this.detailBox = new BoxRenderable(this.renderer, {
      id: "detail",
      width: "60%",
      height: "100%",
      border: true,
      borderColor: COLORS.border,
      title: " Details ",
      titleColor: COLORS.accent,
      backgroundColor: COLORS.panelBg,
    });
    this.detailText = new TextRenderable(this.renderer, {
      id: "detailText",
      content: "",
      fg: COLORS.text,
    });
    this.detailBox.add(this.detailText);
    middle.add(this.detailBox);

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

    // Install-notes overlay (hidden by default). Covers most of the screen so
    // README install instructions are readable on small terminals.
    this.notesBox = new BoxRenderable(this.renderer, {
      id: "notes",
      position: "absolute",
      left: 2,
      top: 1,
      width: "auto",
      right: 2,
      bottom: 2,
      border: true,
      borderColor: COLORS.accent,
      title: " Install notes ",
      titleColor: COLORS.accent,
      backgroundColor: COLORS.panelBg,
      zIndex: 100,
      visible: false,
    });
    this.notesText = new TextRenderable(this.renderer, {
      id: "notesText",
      content: "",
      fg: COLORS.text,
    });
    this.notesBox.add(this.notesText);
    root.add(this.notesBox);

    // Keybindings help modal (hidden by default; toggled with ?).
    this.helpBox = new BoxRenderable(this.renderer, {
      id: "help",
      position: "absolute",
      left: 4,
      top: 2,
      right: 4,
      bottom: 3,
      border: true,
      borderColor: COLORS.accent,
      title: " Keybindings  (? or Esc to close) ",
      titleColor: COLORS.accent,
      backgroundColor: COLORS.panelBg,
      zIndex: 100,
      visible: false,
      padding: 1,
    });
    this.helpModalText = new TextRenderable(this.renderer, {
      id: "helpModalText",
      content: "",
      fg: COLORS.text,
    });
    this.helpBox.add(this.helpModalText);
    root.add(this.helpBox);

    // Launch-argument prompt modal (hidden by default).
    this.promptBox = new BoxRenderable(this.renderer, {
      id: "prompt",
      position: "absolute",
      left: "15%",
      right: "15%",
      top: 4,
      height: 9,
      border: true,
      borderColor: COLORS.accent,
      title: " Launch parameters ",
      titleColor: COLORS.accent,
      backgroundColor: COLORS.panelBg,
      zIndex: 200,
      visible: false,
      padding: 1,
    });
    this.promptText = new TextRenderable(this.renderer, {
      id: "promptText",
      content: "",
      fg: COLORS.text,
    });
    this.promptBox.add(this.promptText);
    root.add(this.promptBox);
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
    this.renderNotes();
    this.renderHelpModal();
    this.renderPrompt();
    this.renderer.root.requestRender();
  }

  /** Approx visible line count inside the notes overlay. */
  private notesViewportLines(): number {
    // Overlay spans top:1..bottom:2 with a 1-line border top/bottom.
    return Math.max(4, (this.renderer.terminalHeight ?? 24) - 1 - 2 - 2);
  }

  private renderNotes(): void {
    if (!this.notesVisible) {
      this.notesBox.visible = false;
      return;
    }
    const app = this.selectedApp();
    const notes = app?.installNotes;
    if (!app || !notes) {
      this.notesBox.visible = false;
      this.notesVisible = false;
      return;
    }
    this.notesBox.visible = true;
    this.notesBox.title = ` Install notes — ${app.name}  (j/k scroll · v/Esc close) `;

    const allLines = notes.split("\n");
    const viewport = this.notesViewportLines();
    const maxScroll = Math.max(0, allLines.length - viewport);
    if (this.notesScroll > maxScroll) this.notesScroll = maxScroll;
    const shown = allLines.slice(this.notesScroll, this.notesScroll + viewport);
    this.notesText.content = shown.join("\n");
  }

  private renderSearch(): void {
    const searching = this.query.length > 0;
    this.searchText.content = searching ? this.query : "type to filter apps…";
    this.searchText.fg = searching ? COLORS.text : COLORS.dim;
  }

  /**
   * Number of list rows visible in a pane: the terminal height minus the
   * search bar (3) and the pane's own top/bottom border (2), capped at the
   * row pool size.
   */
  private listViewport(): number {
    const h = this.renderer.terminalHeight ?? 24;
    return Math.max(1, Math.min(MAX_ROWS, h - 3 - 2));
  }

  /**
   * Adjust `scroll` so `index` stays within the visible window of `viewport`
   * rows over `total` items. Returns the new scroll offset.
   */
  private clampScroll(scroll: number, index: number, total: number, viewport: number): number {
    let s = scroll;
    if (index < s) s = index;
    else if (index >= s + viewport) s = index - viewport + 1;
    const maxScroll = Math.max(0, total - viewport);
    return Math.max(0, Math.min(s, maxScroll));
  }

  /** Build a "▲ n more" / "▼ n more" scroll suffix for a pane title. */
  private scrollTitle(base: string, scroll: number, shown: number, total: number): string {
    if (total <= shown) return ` ${base} `;
    const above = scroll;
    const below = total - (scroll + shown);
    const up = above > 0 ? `↑${above}` : "";
    const down = below > 0 ? `↓${below}` : "";
    const sep = up && down ? " " : "";
    return ` ${base}  ${up}${sep}${down} `;
  }

  private renderCategories(): void {
    const inSearch = this.query.trim().length > 0;
    this.catBox.borderColor =
      this.focus === "categories" && !inSearch
        ? COLORS.borderFocus
        : COLORS.border;

    const total = this.categories.length;
    const viewport = this.listViewport();
    this.catScroll = this.clampScroll(this.catScroll, this.catIndex, total, viewport);
    this.catBox.title = this.scrollTitle("Categories", this.catScroll, viewport, total);

    for (let i = 0; i < MAX_ROWS; i++) {
      const row = this.catRows[i]!;
      const dataIndex = this.catScroll + i;
      const cat = i < viewport ? this.categories[dataIndex] : undefined;
      if (!cat) {
        row.content = " ";
        row.bg = undefined;
        continue;
      }
      const selected = dataIndex === this.catIndex && !inSearch;
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

    const total = rows.length;
    const viewport = this.listViewport();
    this.appScroll = this.clampScroll(this.appScroll, this.appIndex, total, viewport);
    const base = inSearch ? `Results (${appCount})` : "Apps";
    this.appBox.title = this.scrollTitle(base, this.appScroll, viewport, total);

    for (let i = 0; i < MAX_ROWS; i++) {
      const rowText = this.appRows[i]!;
      const dataIndex = this.appScroll + i;
      const row = i < viewport ? rows[dataIndex] : undefined;
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
      const selected = dataIndex === this.appIndex;
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

  /** Inner text width of the details column (60% of terminal, minus borders). */
  private detailInnerWidth(): number {
    const term = this.renderer.terminalWidth ?? 80;
    return Math.max(20, Math.floor(term * 0.6) - 4);
  }

  /** Wrap `text` to `width` columns, returning lines. */
  private wrap(text: string, width: number): string[] {
    const out: string[] = [];
    for (const paragraph of text.split("\n")) {
      if (paragraph.length === 0) {
        out.push("");
        continue;
      }
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (word.length > width) {
          // Hard-break very long tokens (e.g. URLs).
          if (line) {
            out.push(line);
            line = "";
          }
          for (let i = 0; i < word.length; i += width) {
            out.push(word.slice(i, i + width));
          }
          continue;
        }
        if ((line + (line ? " " : "") + word).length > width) {
          out.push(line);
          line = word;
        } else {
          line += (line ? " " : "") + word;
        }
      }
      if (line) out.push(line);
    }
    return out;
  }

  private renderDetail(): void {
    const w = this.detailInnerWidth();
    const row = this.selectedRow();

    if (!row || row.kind !== "app") {
      this.detailBox.title = " Details ";
      this.detailText.content = this.status
        ? this.wrap(this.status, w).join("\n")
        : "No app selected.";
      this.detailText.fg = COLORS.dim;
      return;
    }

    const app = row.entry;
    const lines: string[] = [];

    // Name + status badge.
    const badge = row.installed ? "● installed" : "○ available to install";
    lines.push(app.name);
    lines.push(row.installed ? `${badge}` : badge);
    lines.push("");

    // Description.
    lines.push(...this.wrap(app.description, w));
    lines.push("");

    // Facts (aligned label column).
    const fact = (label: string, value: string) =>
      this.wrap(`${(label + ":").padEnd(10)}${value}`, w);
    if (app.language) lines.push(...fact("Language", app.language));
    if (app.categories.length) lines.push(...fact("Category", app.categories.join(", ")));
    if (app.tags && app.tags.length) {
      lines.push(...fact("Tags", app.tags.slice(0, 10).join(", ")));
    }
    if (app.popularity) lines.push(...fact("Stars", formatStars(app.popularity)));
    if (row.installed && app.binaries[0]) lines.push(...fact("Command", app.binaries[0]));
    if (app.homepage) lines.push(...fact("Home", app.homepage));
    lines.push("");

    // Launch parameters (if any).
    const launchArgs = app.launch?.args ?? [];
    if (launchArgs.length > 0) {
      lines.push("Parameters:");
      for (const a of launchArgs) {
        const req = a.required ? "*" : " ";
        const desc = a.description ? ` — ${a.description}` : "";
        lines.push(...this.wrap(`  ${req}${a.name}${desc}`, w));
      }
      lines.push("");
    }

    // Install / action guidance.
    if (row.installed) {
      lines.push(launchArgs.length > 0 ? "Enter to launch (prompts for parameters)." : "Enter to launch.");
    } else {
      const candidates = this.candidatesFor(app);
      if (candidates.length > 0) {
        const chosen = candidates[this.managerIndex] ?? candidates[0]!;
        lines.push(`Install (${chosen.manager}):`);
        lines.push(...this.wrap(chosen.command, w));
        lines.push(
          candidates.length > 1
            ? `i: install · m: manager (${this.managerIndex + 1}/${candidates.length})`
            : "i or Enter: install",
        );
      } else {
        const declared = allDeclaredInstalls(app);
        if (declared.length > 0) {
          lines.push("No available manager. Manual:");
          lines.push(...this.wrap(declared[0]!.command, w));
        } else {
          lines.push("No install command known.");
        }
      }
      if (app.installNotes) lines.push("v: view install notes");
    }

    // Status message (transient) at the bottom.
    if (this.status) {
      lines.push("");
      lines.push(...this.wrap(`» ${this.status}`, w));
    }

    this.detailBox.title = row.installed ? " Details " : " Details · installable ";
    this.detailText.content = lines.join("\n");
    this.detailText.fg = COLORS.text;
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

  /** Human-readable keybinding help, grouped, built from the active keymap. */
  private helpModalContent(): string {
    const km = this.config.keymap;
    const keys = (action: string): string => (km[action] ?? []).join(", ") || "—";
    const rows: Array<[string, string]> = [
      ["Move up / down", `${keys("up")}  /  ${keys("down")}`],
      ["Switch pane", `${keys("left")}  /  ${keys("right")}`],
      ["Launch app", keys("launch")],
      ["Install app", keys("install")],
      ["Cycle package manager", keys("cycleManager")],
      ["View install notes", keys("viewNotes")],
      ["Toggle favorite", keys("toggleFavorite")],
      ["Search (type any time)", `${keys("focusSearch")} or just type`],
      ["Clear search / close", keys("clearSearch")],
      ["Refresh (rescan + registry)", keys("refresh")],
      ["Quit", `${keys("quit")}, Ctrl+C`],
      ["This help", keys("help")],
    ];

    const labelWidth = Math.max(...rows.map(([l]) => l.length));
    const lines = rows.map(([label, k]) => `  ${label.padEnd(labelWidth)}   ${k}`);
    return ["Keybindings", "", ...lines, "", "All keys are rebindable in ~/.config/hawk/config.yaml"].join("\n");
  }

  private renderHelpModal(): void {
    this.helpBox.visible = this.helpVisible;
    if (this.helpVisible) {
      this.helpModalText.content = this.helpModalContent();
    }
  }

  private renderPrompt(): void {
    if (!this.prompt) {
      this.promptBox.visible = false;
      return;
    }
    this.promptBox.visible = true;
    const p = this.prompt;
    const arg = p.args[p.index]!;
    const req = arg.required ? " (required)" : " (optional)";
    const step = p.args.length > 1 ? ` [${p.index + 1}/${p.args.length}]` : "";
    this.promptBox.title = ` Launch ${p.app.name}${step} `;

    const lines: string[] = [];
    lines.push(`${arg.name}${req}`);
    if (arg.description) lines.push(arg.description);
    lines.push("");
    const shown = p.buffer.length > 0 ? p.buffer : (arg.placeholder ? `${arg.placeholder}` : "");
    const isPlaceholder = p.buffer.length === 0 && Boolean(arg.placeholder);
    lines.push(`> ${shown}${isPlaceholder ? "" : "▏"}`);
    if (p.error) lines.push(`! ${p.error}`);
    lines.push("");
    lines.push("Enter: confirm · Esc: cancel");

    this.promptText.content = lines.join("\n");
  }

  /* ---- input -------------------------------------------------------- */

  private async onKey(key: ParsedKey): Promise<void> {
    // Ctrl-C always quits.
    if (key.ctrl && key.name === "c") return this.quit();

    const action = this.keymap.resolve(key);

    // Launch-parameter prompt captures all input while open.
    if (this.prompt) {
      return this.onPromptKey(key);
    }

    // Help modal captures input while open.
    if (this.helpVisible) {
      if (action === "help" || action === "clearSearch" || key.name === "escape" || action === "quit") {
        this.helpVisible = false;
        return this.render();
      }
      return; // swallow other keys
    }

    // Notes overlay captures input while open.
    if (this.notesVisible) {
      if (action === "viewNotes" || action === "clearSearch" || key.name === "escape") {
        this.notesVisible = false;
        return this.render();
      }
      if (action === "down") {
        this.notesScroll += 1;
        return this.render();
      }
      if (action === "up") {
        this.notesScroll = Math.max(0, this.notesScroll - 1);
        return this.render();
      }
      if (key.name === "pagedown" || key.name === "space") {
        this.notesScroll += this.notesViewportLines();
        return this.render();
      }
      if (key.name === "pageup") {
        this.notesScroll = Math.max(0, this.notesScroll - this.notesViewportLines());
        return this.render();
      }
      return; // swallow everything else while notes are open
    }

    const inSearch = this.query.length > 0;

    // Open the help modal with the help key (?), but only when not actively
    // typing a search — otherwise ? is a normal search character.
    if (action === "help" && !inSearch) {
      this.helpVisible = true;
      return this.render();
    }

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
      case "viewNotes":
        return this.toggleNotes();
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

    // If the app declares launch arguments, prompt for them first.
    const args = app.launch?.args ?? [];
    if (args.length > 0) {
      this.prompt = {
        app,
        args,
        index: 0,
        values: {},
        buffer: args[0]!.default ?? "",
        error: "",
      };
      return this.render();
    }

    await this.launchWithArgs(app, []);
  }

  /** Execute a launch for `app` with resolved extra `args`. */
  private async launchWithArgs(app: AppEntry, extraArgs: string[]): Promise<void> {
    const plan = planLaunch(app, this.config, extraArgs);
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

  /** Handle a keystroke while the launch-parameter prompt is open. */
  private async onPromptKey(key: ParsedKey): Promise<void> {
    const p = this.prompt;
    if (!p) return;

    if (key.name === "escape") {
      this.prompt = null;
      this.status = "Launch cancelled";
      return this.render();
    }

    if (key.name === "return" || key.name === "enter") {
      const arg = p.args[p.index]!;
      const value = (p.buffer.trim() || arg.default || "").trim();
      if (arg.required && value.length === 0) {
        p.error = `${arg.name} is required`;
        return this.render();
      }
      p.values[arg.name] = value;
      if (p.index < p.args.length - 1) {
        // Advance to the next argument.
        p.index += 1;
        p.buffer = p.args[p.index]!.default ?? "";
        p.error = "";
        return this.render();
      }
      // All args collected: build + launch.
      const app = p.app;
      const built = buildLaunchArgs(app, p.values);
      this.prompt = null;
      this.render();
      return this.launchWithArgs(app, built);
    }

    if (key.name === "backspace" || key.name === "delete") {
      p.buffer = p.buffer.slice(0, -1);
      p.error = "";
      return this.render();
    }

    // Printable characters extend the buffer.
    if (this.isPrintable(key)) {
      p.buffer += key.sequence;
      p.error = "";
      return this.render();
    }
  }

  /** Toggle the install-notes overlay for the selected app. */
  private toggleNotes(): void {
    const app = this.selectedApp();
    if (!app || !app.installNotes) {
      this.status = app ? `${app.name} has no install notes` : "";
      return this.render();
    }
    this.notesVisible = !this.notesVisible;
    this.notesScroll = 0;
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

/** Compact star count, e.g. 55000 -> "55.0k". */
function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
