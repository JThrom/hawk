# Hawk — Specification

Hawk is a terminal user interface (TUI) application launcher and management
layer. It discovers, organizes, and launches other installed TUIs, and connects
to a community registry to suggest new ones. The long-term vision is an
all-terminal operating environment where tmux (or zellij) acts as the tiling
window manager and Hawk provides the main menu / application launcher.

---

## 1. Vision

- Terminal-native "operating system" experience.
- The terminal multiplexer (tmux, zellij) provides tiling window management.
- Hawk provides the launcher / main menu and application catalog.
- Users browse categorized TUIs, launch them, search installed apps, and
  (in later phases) discover and install new TUIs from a shared registry.

Example: searching `calculator` shows the installed TUI (e.g. `tuicalc`) first,
then registry suggestions (e.g. `marthypad`) and other popular variants below.

---

## 2. Technology Stack

| Concern        | Decision                                              |
|----------------|-------------------------------------------------------|
| Runtime        | Bun                                                   |
| Language       | TypeScript                                            |
| TUI framework  | OpenTUI (`@opentui/core`, ≥ 0.4.5)                    |
| Distribution   | npm / bun global package (`bunx hawk` / `npx hawk`)   |
| Config format  | YAML (`~/.config/hawk/config.yaml`)                   |
| Registry files | YAML source, compiled to `index.json` artifact        |
| Registry fetch | jsDelivr CDN (fallback: raw.githubusercontent.com)    |

Rationale:
- **Bun**: OpenTUI's first-class runtime. Fast startup, native FFI for the Zig
  core, easy global install.
- **TypeScript**: type safety for registry schemas, OS/multiplexer detection,
  and package-manager adapters.
- **OpenTUI**: same maintainers as OpenCode; native Zig core with TS bindings,
  component/renderable model, high performance.

---

## 3. Environment Awareness

Hawk detects and adapts to its runtime environment.

### 3.1 Operating system / distro
- Detect OS: Linux, macOS.
- Detect Linux distro family to pick the right system package manager
  (Debian/Ubuntu → apt, Arch → pacman, Fedora/RHEL → dnf).

### 3.2 Terminal
- Detect terminal capabilities (color depth, size) via OpenTUI + env
  (`$TERM`, `$COLORTERM`).

### 3.3 Terminal multiplexer
- Detect if running inside **tmux** (`$TMUX`) or **zellij** (`$ZELLIJ`).
- Deep integration with tmux and zellij for launching apps in new windows.

### 3.4 Package managers & compilers
- Detect installed package managers and query them for installed packages:
  `brew`, `apt`/`dpkg`, `pacman`, `cargo`, `npm`/`bun` global, `pipx`/`pip`,
  `dnf`/`rpm`.
- Awareness of installed compilers/runtimes informs which install commands are
  viable (e.g. `cargo install` needs the Rust toolchain).

---

## 4. App Discovery

Hawk determines which TUIs are installed by **matching a known catalog against
the system** (never noisy heuristic guessing).

Two complementary match strategies, run together so newly-installed apps are
always caught:

1. **PATH match** — for each catalog entry's known binary name(s), check `$PATH`.
2. **Package-manager match** — query each detected package manager's installed
   package list and cross-reference catalog entries.

The "catalog" is:
- **MVP**: a static seed catalog bundled inside the Hawk binary/package.
- **Phase 2+**: the remote registry `index.json` (bundled seed remains the
  offline fallback). The same match logic is reused — swapping the data source
  requires no rework.

### 4.1 Scan caching
- Scan results are cached to disk (`~/.cache/hawk/`).
- On launch, cached results are shown instantly.
- A background re-scan refreshes results; a manual refresh key forces re-scan.
- This surfaces newly-installed apps without slow startup (pkg-manager queries
  are expensive).

---

## 5. Registry (Phase 2+)

### 5.1 Ownership
- A dedicated repo owned by the project (e.g. `hawk-registry`).
- Community contributes apps via pull request.

### 5.2 Structure
- **Source**: a directory of per-app YAML files (one file per app).
  YAML chosen for human-friendliness in PRs and inline comments.
- **Artifact**: CI in the registry repo compiles all app files into a single
  `index.json` manifest (and a fixed category taxonomy). Hawk fetches the one
  index — no directory listing needed on the CDN.

### 5.3 Fetch & caching
- Fetch `index.json` via jsDelivr CDN; fall back to raw.githubusercontent.com.
- Cache to disk with a **configurable TTL** (default 24h) in
  `~/.cache/hawk/`.
- Use cache offline; refresh in the background when stale.
- Registry URL(s) and TTL are configurable in `config.yaml`.

### 5.4 Per-app entry schema
Each app entry contains:
- `id` — stable unique identifier
- `name` — display name
- `description` — search + display text
- `categories` / `tags` — canonical categories (see §7) + free tags
- `binaries` — one or more binary names for PATH/pkg detection
- `install` — install commands keyed by package manager
  (e.g. `{ brew: "...", cargo: "...", apt: "..." }`)
- `homepage` / `repo` — outbound links
- `popularity` — stars / rank signal for search ordering
- `language` — implementation language/runtime (Rust, Go, Python, …)

(Screenshots/asciinema intentionally excluded — impractical in a TUI.)

---

## 6. Launching Apps

### 6.1 Inside a multiplexer (tmux / zellij)
- Default: launch the selected app in a **new window**.
- (Future/config: option to launch in a new pane / split.)
- tmux: `tmux new-window <cmd>`; zellij: equivalent action.

### 6.2 Without a multiplexer
- **exec / replace** the Hawk process: Hawk hands the terminal to the app.
  On app exit, control returns to Hawk (re-launch or shell wrapper).
- Simple, works everywhere, no lingering Hawk process needed.

---

## 7. Categories

### 7.1 Taxonomy source
- **Registry-defined, fixed taxonomy** — the registry owns the canonical
  category list for consistency. (MVP: same taxonomy baked into the seed.)

### 7.2 Auto-generated special categories (pinned at top)
- **Favorites** — user-pinned apps (persisted locally).
- **Recent** — recently launched apps (from local usage tracking).

---

## 8. Search

- **Always-on, type-to-filter, fuzzy.** Typing filters live; no modal search
  mode required.
- Results are **two grouped sections**:
  1. **Installed** matches (always above), fuzzy-scored.
  2. **Registry** suggestions (below), sorted by match score + popularity.
     (Registry section is empty in MVP; appears in Phase 2+.)
- Example: `calculator` → installed `tuicalc` at top, then `marthypad` and
  other popular registry variants beneath.

---

## 9. Install Flow (Phase 3)  (IMPLEMENTED)

- User selects a registry (not-installed) app and presses `i` (or `Enter`).
- Hawk **auto-picks** the best package manager: the intersection of the app's
  declared install commands and the managers detected on the system, ordered by
  `managerPreference`. The `m` key cycles through the other viable managers
  before installing. [done]
- Inside a multiplexer, the install runs in a **new window** (`sh -c` wrapping
  the command), streaming output; the window stays open at the end (`read`) so
  results/prompts are visible. Hawk keeps running. [done]
- Without a multiplexer, Hawk **suspends** the renderer, runs the install inline
  with inherited stdio (so sudo/interactive prompts work), then **resumes**. [done]
- Privilege escalation is handled entirely by the underlying command — Hawk
  never touches credentials. [done]
- On completion, Hawk **re-scans** and the app moves into the installed set. In
  window mode the install is async, so the detail line prompts pressing `r` when
  it finishes. [done]
- When no available manager can install an app, Hawk shows the manual command
  instead of attempting an install.
- Package-manager preference order is configurable in `config.yaml`
  (`managerPreference`). Install/cycle keys are rebindable (`install`,
  `cycleManager`).

---

## 10. UI / Interaction

### 10.1 Layout
- **Two-pane, Miller-column style**: categories on the left, apps of the
  selected category on the right, with a detail area for the selected app.

### 10.2 Keybindings
- **Vim keys and arrows both** supported.
  - `h/j/k/l` + arrow keys — navigate
  - `Enter` — launch selected app
  - typing — live fuzzy search
  - `q` — quit
  - refresh key — force re-scan / registry refresh
- **Fully rebindable** via `config.yaml`.

---

## 11. Configuration

- Location: `~/.config/hawk/config.yaml` (XDG).
- Philosophy: **maximize configurability** — devs value config + extensibility.
- Covers at minimum:
  - keybindings (full rebind map)
  - cache TTLs (registry, scan)
  - registry URL(s) / mirrors
  - launch defaults (window vs pane; multiplexer preference)
  - package-manager preference order
  - favorites list / pinned apps
  - enabled/disabled package-manager scanners
  - theme / colors (future)

---

## 12. Local State & Privacy

- Stored under `~/.cache/hawk/` (caches) and `~/.local/share/hawk/` or
  config dir (persistent state such as favorites & usage counts).
- **Usage tracking is local-only** and never leaves the machine. It records
  launch counts + timestamps to power **Recent** and (future) **Frequent**.

---

## 13. Phased Roadmap

### Phase 1 — MVP (local launcher)
- Environment detection (OS, terminal, multiplexer, package managers).
- App discovery via **bundled static seed catalog** (PATH + pkg-manager match).
- Scan caching with background/manual refresh.
- Two-pane browse UI with categories.
- Always-on fuzzy search over installed apps.
- Launch: new window in tmux/zellij; exec-replace fallback.
- Favorites (pinned) + Recent special categories.
- Local usage tracking.
- YAML config with rebindable keys, TTLs, launch defaults.
- No network / registry.

### Phase 2 — Registry discovery  (IMPLEMENTED)
- Local generated registry (`data/registry.yaml`, built from awesome-tuis by
  `scripts/gen-registry.ts`) merged with the seed. [done]
- Search shows registry suggestions in an "Available to install" section below
  installed results, with install-command hints in the detail line. [done]
- Registry-driven catalog augments the seed for detection (breadth). [done]
- Remote `dist/index.yaml` fetch via jsDelivr → raw.githubusercontent fallback,
  disk cache with configurable TTL, offline degradation (fresh cache → network →
  stale cache → local), background refresh. Enabled by default. [done]
- Precedence when merging: seed > remote > local. Seed keeps curated
  install/package metadata; registry contributes the long tail.
- Registry repo `JThrom/hawk-registry` is live: per-app `apps/<id>.yaml` sources
  + `categories.yaml`, compiled by CI (GitHub Actions) into
  `dist/index.yaml`, served via
  `https://cdn.jsdelivr.net/gh/JThrom/hawk-registry@master/dist/index.yaml`. [done]

Phase 2 complete. Note: the index is YAML (not JSON); the fetcher parses YAML,
which is a JSON superset, so the local disk cache remains JSON for fast reads.

### Phase 3 — Install flow  (IMPLEMENTED)
- Auto-pick package manager with in-app cycling override (`m`), install via `i`.
- New-window streaming install in a multiplexer; suspend/resume inline install
  otherwise. Re-scan on completion. Configurable pkg-manager preference order.
- See §9 for details.

### Phase 4 — Updates & extras
- "Updates Available" category (compare installed vs registry versions).
- Frequent category, richer theming, additional multiplexers, pane launching.

---

## 14. Open Questions / Deferred

- Version comparison strategy for "Updates Available" (Phase 4).
- Additional multiplexers beyond tmux/zellij (screen, wezterm) — deferred.
- Theming system specifics.
- Windows support — out of scope for now.
