# AGENTS.md — Hawk

Guidance for AI agents and contributors working on Hawk. Read `spec.md` for the
product specification. This file covers conventions, architecture, and workflow.

---

## Project summary

Hawk is a Bun + TypeScript **terminal user interface** built on OpenTUI
(`@opentui/core`). It discovers installed terminal applications (TUIs),
organizes them by category, launches them into tmux/zellij windows, and
suggests + installs new ones from a GitHub-hosted registry.

Phases 1–3 are implemented (local launcher, registry discovery, install flow).
See the roadmap in `spec.md` §13.

Note on terminology: refer to **Hawk** as a "terminal user interface", never as
"a TUI". The apps Hawk manages may be called TUIs.

---

## Guiding principles (read before touching search, discovery, or UI)

These come directly from the project's primary use case (`spec.md` §1a). Treat
them as hard requirements, not preferences.

1. **Find by function, not name.** TUIs have non-descriptive names. Search MUST
   weight **tags + description** as heavily as name/id/binary. `calculator`
   finds calculators; `aws` finds `claws`. Utility matches are first-class, not
   fallbacks. When adding registry entries, curate function/synonym tags — they
   are load-bearing. (`spec.md` §8)

2. **Discover apps outside `/bin`.** Many TUIs are npm/cargo/pip/pipx globals in
   per-tool bin dirs or with mismatched binary names. Detection scans the whole
   `$PATH` AND cross-references package-manager install lists by package name.
   Never assume `/bin` or that the binary name equals the app name.
   (`spec.md` §4)

3. **Hawk is the terminal-OS "start menu."** Primary use: an engineer on a
   thin client over SSH + tmux, running agentic AI workflows on a persistent
   server. Hawk launches other TUIs into new tmux windows. Therefore:
   - **Small-screen first** — usable on narrow terminals; never assume width.
   - **tmux new-window launching is the primary path.**
   - **Keyboard-only, low-latency, low-overhead** — must feel good over SSH.
   - **Robust to detach/reattach** — no assumptions about a persistent client.
   (`spec.md` §1a)

---

## Tech stack (non-negotiable defaults)

- **Runtime**: Bun. Do not add Node-only assumptions; prefer Bun APIs
  (`Bun.file`, `Bun.spawn`, `Bun.$`) where sensible.
- **Language**: TypeScript, strict mode.
- **UI**: `@opentui/core` (renderable/component model, `createCliRenderer`).
- **Config**: YAML at `~/.config/hawk/config.yaml`.
- **Package**: publishable to npm/bun as a global (`bin` entry `hawk`).
- **License**: GPL-2.0-only.

Do not introduce alternative UI frameworks, runtimes, or config formats without
an explicit decision recorded in `spec.md`.

---

## Suggested architecture

Keep modules small and single-purpose. Proposed layout:

```
src/
  index.ts              # entrypoint: CLI flags (--doctor/--version/--help), bootstrap
  paths.ts              # XDG config/cache/data dir resolution
  config/
    schema.ts           # config types + DEFAULT_CONFIG
    load.ts             # read + deep-merge ~/.config/hawk/config.yaml
  env/
    os.ts               # OS + Linux distro detection
    terminal.ts         # terminal capability detection
    multiplexer.ts      # tmux/zellij detection
    package-managers.ts # detect available managers (incl. go)
    path.ts             # $PATH probing (which/hasAny)
    index.ts            # detectEnvironment aggregate
  catalog/
    seed.ts             # bundled curated seed catalog (precedence source)
    types.ts            # AppEntry / LaunchSpec schema (shared with registry)
    registry.ts         # local data/registry.yaml load + mergeCatalogs
    remote.ts           # remote dist/index.yaml fetch (jsDelivr) + disk cache + TTL
    index.ts            # getActiveCatalog (sync) / getActiveCatalogAsync (remote)
  data/registry.yaml    # generated seed of the local registry (awesome-tuis)
  discovery/
    scan.ts             # PATH + pkg-manager match -> installed apps
    cache.ts            # scan result disk cache + background refresh
  managers/
    types.ts            # PackageManagerAdapter interface
    exec.ts             # Bun.spawn helper (timeout, capture)
    adapters.ts         # one adapter per manager (brew/apt/pacman/dnf/cargo/npm/bun/pipx/pip/go)
  launch/
    launcher.ts         # plan/execute launch; buildLaunchArgs; window/pane/exec
  install/
    select.ts           # install candidates + manager cycling
    installer.ts        # install plan + execute (mux window / suspend-resume inline)
  state/
    usage.ts            # local launch tracking (recent/frequent)
    favorites.ts        # pinned apps
  search/
    fuzzy.ts            # fuzzy matcher with match-quality kinds + phrase matching
    rank.ts             # field-weighted, function-first ranking (installed above registry)
  ui/
    app.ts              # top-level composition, render, input handling, overlays
    model.ts            # build sidebar categories from catalog + state
    keymap.ts           # ParsedKey -> Action resolution from config
```

Design principles:
- **Data source abstraction**: discovery consumes a `Catalog`. Seed, local
  registry, and remote index all produce the same shape; `mergeCatalogs`
  combines them (precedence: seed > remote > local). Same match logic either way.
- **Package-manager adapters** share a common interface (`isAvailable()`,
  `listInstalled()`); install commands come from the catalog `install` field.
- **Pure core, thin UI**: keep detection/scan/search/ranking logic
  framework-agnostic and unit-tested; the OpenTUI layer (`ui/app.ts`) only
  renders + dispatches events.

---

## Coding conventions

- TypeScript strict; no `any` without justification.
- Prefer pure functions for detection, scanning, ranking (easy to test).
- Async I/O for all filesystem, spawn, and network calls.
- No blocking the render loop — expensive scans run async and update state.
- Handle absence gracefully: missing package managers, no multiplexer, no
  network, empty/corrupt cache must never crash the UI.
- Cross-platform paths via XDG (`$XDG_CONFIG_HOME`, `$XDG_CACHE_HOME`,
  `$XDG_DATA_HOME`) with sane fallbacks.

---

## Environment detection rules

- Multiplexer: tmux via `$TMUX`, zellij via `$ZELLIJ`. If both/neither, prefer
  explicit config, else exec-replace fallback.
- Package managers: detect by probing the binary on PATH before querying.
  Never assume a manager exists.
- OS/distro: use to pick the system package manager and default paths.

---

## Launch rules

- In a multiplexer: default new window (`tmux new-window` / `zellij run`).
  Respect `launch.target` for pane vs window.
- No multiplexer: `exec`-replace the Hawk process so the app owns the terminal.
- Apps may declare `launch.args`; prompt for them (modal) and append to argv via
  `buildLaunchArgs`.
- Never leave zombie processes; always await/clean up spawned children.

---

## State & privacy

- Usage tracking is **local-only**. Never send telemetry off-machine.
- Caches live in `~/.cache/hawk/`; persistent state (favorites, usage) in the
  config/data dir. Treat all cache as disposable/regenerable.

---

## Registry contract

- Registry repo: `JThrom/hawk-registry` (separate repo). Per-app
  `apps/<id>.yaml` + `categories.yaml` are the source; CI compiles them into
  `dist/index.yaml`, served via jsDelivr.
- Enrichment (`scripts/enrich.ts` in the registry repo) infers install/
  packages/language/tags/installNotes from GitHub READMEs and stores full
  READMEs as `readmes/<id>.readme.md` sidecars.
- Hawk fetches `dist/index.yaml` via jsDelivr → raw.githubusercontent fallback,
  parses YAML, caches to disk as JSON, and degrades: fresh cache → network →
  stale cache → bundled local registry/seed. Respect configurable TTL.
- `AppEntry` (in `catalog/types.ts`) is the shared contract; mirror any schema
  change in the registry repo's `scripts/types.ts` and `SCHEMA.md`.

---

## Configuration philosophy

Maximize configurability. Every hardcoded default (keybinding, TTL, registry
URL, launch target, pkg-manager order, enabled scanners) should be overridable
in `config.yaml`. Ship strong defaults so zero-config works out of the box.

---

## Build / run / test

- Install deps: `bun install`
- Run: `bun run dev` (alias for `bun run src/index.ts`)
- Diagnostics (no UI): `bun run src/index.ts --doctor`
- Type-check: `bun run typecheck` (`tsc --noEmit`)
- Test: `bun test`
- Regenerate the bundled local registry from awesome-tuis:
  `bun run gen-registry`

Agents: after code changes, run type-check and tests before considering a task
complete. Do not commit unless explicitly asked.

### Testing the UI

Interactive keystrokes are hard to drive through a piped pty in CI-like shells.
Prefer unit tests for pure logic (search, ranking, install selection, launch
args, catalog merge). For rendering, a `script -qfc "bun run src/index.ts"` with
piped input can confirm the layout renders but may not reliably deliver keys.

---

## Scope discipline for agents

- Phases 1–3 are done. Remaining work is Phase 4 (Updates Available, Frequent
  category, theming, more multiplexers) and polish — see `spec.md` §13–14.
- Keep the pure-core / thin-UI split; add unit tests for new core logic.
- Honor the guiding principles above (find-by-function, discover outside /bin,
  small-screen / SSH-first).
- Record any new architectural decision in `spec.md`, and keep this file's
  architecture map + the README's command list in sync with the code.
