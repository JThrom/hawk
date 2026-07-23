# Hawk

**Hawk is a terminal user interface for discovering, launching, and installing
other terminal applications.**

If a terminal multiplexer (tmux or zellij) is the tiling window manager of an
all-terminal workflow, Hawk is its **start menu**: the single place you open
first, browse or search everything you can run, and launch each tool into its
own window.

---

## Why Hawk exists

Terminal applications have great functionality but forgettable, non-descriptive
names — `claws` is an AWS client, `yazi` and `nnn` are file managers, `btop` is
a system monitor. You install dozens of them across `cargo`, `npm`, `pipx`,
`brew`, and the system package manager, and then can't remember what any of them
are called or where their binaries live.

Hawk solves this by letting you **find tools by what they do, not their name**,
and by launching them into new terminal windows without leaving your session.

### Primary use case

Hawk is built for engineers running agentic AI workflows over **SSH + tmux** on
small, power-efficient thin clients, keeping a persistent session on an
always-on machine. Start a tmux session, launch Hawk in the first window, and
use it as the menu from which every other tool opens into a new tmux window —
your work and state survive disconnects, low battery, or stepping away.

Design consequences: small-screen-first, keyboard-only, low-latency, and
new-window launching as the primary path.

---

## Features

- **Find by function** — fuzzy search weights descriptions and tags as heavily
  as names, so `aws` finds `claws` and `file manager` finds `yazi`/`nnn`.
- **Discovers apps anywhere** — matches a curated catalog against the whole
  `$PATH` *and* against every detected package manager's installed list, so
  `cargo`/`npm`/`pipx` globals that never touch `/bin` are still found.
- **Three-column layout** — categories, apps, and a rich details panel showing
  description, language, tags, popularity, command, homepage, and launch/install
  guidance.
- **Launch into new windows** — opens apps in a new tmux/zellij window (or pane)
  so Hawk stays running; falls back to replacing the process when there is no
  multiplexer.
- **Launch parameters** — apps that need arguments (e.g. a path) prompt for them
  in a modal before launching.
- **Community registry** — suggests thousands of installable terminal apps,
  fetched from [`hawk-registry`](https://github.com/JThrom/hawk-registry) with
  offline caching.
- **In-app install** — install a suggested app with one key; Hawk auto-picks the
  best package manager (with an override), streams the install in a new window,
  and rescans. When no packaged install exists, it shows the project's README
  install notes.
- **Favorites & Recent** — pin apps and revisit recently launched ones; usage
  tracking is local-only and never leaves your machine.

---

## Requirements

- [Bun](https://bun.com) ≥ 1.3
- Optional: `tmux` or `zellij` for new-window launching
- Optional: any of `brew`, `apt`, `pacman`, `dnf`, `cargo`, `npm`, `bun`,
  `pipx`, `pip`, `go` for detection and installs

## Install & run

From source (current):

```bash
git clone https://github.com/JThrom/hawk.git
cd hawk
bun install
bun run dev          # launch Hawk
```

As a global package (when published):

```bash
bunx hawk            # or: npx hawk
```

---

## Command-line usage

```
hawk [options]
```

| Option          | Description                                             |
|-----------------|---------------------------------------------------------|
| (none)          | Launch the interactive terminal interface.              |
| `--doctor`      | Print detected environment + installed apps, then exit. |
| `--version, -v` | Print the version.                                      |
| `--help, -h`    | Show usage help.                                        |

`--doctor` is useful for debugging discovery — it reports your OS/distro,
terminal, active multiplexer, detected package managers, and which catalog apps
were detected as installed (and how).

### Package scripts

| Command                | What it does                                          |
|------------------------|-------------------------------------------------------|
| `bun run dev`          | Launch Hawk (`src/index.ts`).                         |
| `bun run start`        | Same as `dev`.                                        |
| `bun run typecheck`    | Type-check with `tsc --noEmit`.                       |
| `bun test`             | Run the test suite.                                   |
| `bun run gen-registry` | Regenerate the bundled local registry from awesome-tuis. |

---

## Keybindings

Hawk is keyboard-driven; vim keys and arrows both work. Press `?` in-app for the
full, always-current list (it reflects your config). All keys are rebindable.

| Key(s)             | Action                                                       |
|--------------------|--------------------------------------------------------------|
| `k` / `↑`, `j` / `↓` | Move selection up / down                                   |
| `h` / `←`, `l` / `→` | Switch pane (categories ↔ apps)                            |
| `Enter`            | Launch the selected app (installed) or install it (available). Prompts for launch parameters if the app declares them. |
| `i`                | Install the selected (not-installed) app                     |
| `m`                | Cycle the package manager used for install                   |
| `v`                | View the app's README install notes (scrollable overlay)     |
| `f`                | Toggle favorite (pin/unpin)                                  |
| type any text      | Live fuzzy search across installed + registry apps           |
| `Esc`              | Clear the search / close an overlay                          |
| `r`                | Refresh: rescan installed apps + refetch the registry        |
| `?`                | Open the keybindings help modal                              |
| `q` / `Ctrl+C`     | Quit                                                         |

Scrolling: the category and app lists scroll automatically; pane titles show
`↑N`/`↓N` counts of hidden rows.

> Note: `Ctrl+H` is intentionally **not** used — terminals send it as ASCII
> backspace, indistinguishable from the Backspace key.

---

## Configuration

Hawk reads `~/.config/hawk/config.yaml` (honoring `$XDG_CONFIG_HOME`). Every
value is optional and merged over strong defaults; a malformed file safely falls
back to defaults. Example with the defaults:

```yaml
keymap:
  up:             [k, up]
  down:           [j, down]
  left:           [h, left]
  right:          [l, right]
  launch:         [return, enter]
  install:        [i]
  cycleManager:   [m]
  viewNotes:      [v]
  help:           ["?"]
  focusSearch:    ["/"]
  clearSearch:    [escape]
  toggleFavorite: [f]
  refresh:        [r]
  quit:           [q]

cache:
  scanTtlMs:     86400000    # installed-app scan cache TTL (ms)
  registryTtlMs: 86400000    # registry index cache TTL (ms)

launch:
  target:            window  # "window" or "pane" inside a multiplexer
  preferMultiplexer: auto    # "tmux" | "zellij" | "auto"

registry:
  enabled: true
  urls:
    - https://cdn.jsdelivr.net/gh/JThrom/hawk-registry@master/dist/index.yaml
    - https://raw.githubusercontent.com/JThrom/hawk-registry/master/dist/index.yaml

managerPreference: [cargo, brew, bun, npm, pipx, pacman, dnf, apt, pip]
disabledScanners: []         # package managers to skip during discovery
favorites: []                # app ids to pin as favorites
```

---

## How it works

1. **Detect** the OS/distro, terminal, active multiplexer, and available package
   managers.
2. **Discover** installed apps by matching a catalog (bundled seed + community
   registry) against `$PATH` and package-manager install lists. Results are
   cached to `~/.cache/hawk/` and refreshed in the background.
3. **Browse / search** — categories on the left, apps in the middle, details on
   the right. Search is function-first.
4. **Launch** the selected app into a new tmux/zellij window (or replace the
   process when there is no multiplexer), prompting for any launch parameters.
5. **Install** suggested apps from the registry via the best available package
   manager, or follow the README install notes when no packaged install exists.

State lives under `~/.config/hawk/` (config), `~/.cache/hawk/` (caches), and
`~/.local/share/hawk/` (favorites, usage). Usage tracking is local-only.

---

## Registry

The catalog of installable apps lives in a separate repository,
[`hawk-registry`](https://github.com/JThrom/hawk-registry): per-app YAML files
enriched from project READMEs and compiled into a single `dist/index.yaml`
served over jsDelivr. To add or fix an app, open a pull request there.

---

## Development

```bash
bun install
bun run typecheck
bun test
bun run dev
```

See [`spec.md`](./spec.md) for the full specification and [`agents.md`](./agents.md)
for architecture and contributor conventions.

---

## License

[GPL-2.0-only](./LICENSE)
