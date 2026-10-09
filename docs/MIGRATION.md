# Godot migration — state and remaining work

Where the port stands, what is left, and the traps that cost time getting here.
Written 2026-10-10, at `main` = `26f0d27`.

## Status in one paragraph

The Phaser 4 + TypeScript build is retired and the Godot 4.7.2 project owns the
repo root. It is **live** at <https://yakov.khalinsky.com/polar-adventures/> —
GitHub Pages serves a Godot web export built by CI on every push to `main`. What
is live is a **movement prototype**: one hand-authored level, placeholder
terrain, no ice, no enemies, no goal. The movement model, the isometric
projection and the level format are ported and measured; the *game* around them
is not.

## Working on it

The project is at the repo root, so `--path .` everywhere.

```bash
godot --path . --windowed --resolution 1280x720          # play it
godot --headless --path . --import                       # after adding/moving assets
godot --headless --path . --script res://tests/run_tests.gd   # 108 checks, exit 1 on failure
godot --headless --path . --quit-after 5                 # smoke: boots the level, loads the art
```

`--quit-after` counts process iterations, **not** physics ticks. Anything that
samples frames needs `--fixed-fps 60` alongside it, or it silently measures a
fraction of the steps it appears to. `commands.test` deliberately carries no
`--fixed-fps`: the suite asserts the numbers it just printed, so changing the
command string changes what it asserts.

Screenshots come from the scene's own scripted capture, which needs a real
window (it cannot run under `--headless`):

```bash
godot --path . --windowed --resolution 960x540 -- --capture=docs/screenshot.png --frames=12
```

Export and publish:

```bash
mkdir -p export/web && godot --headless --path . --export-release Web export/web/index.html
```

`export/` is gitignored. Godot does not create the output directory and fails if
it is absent.

## The restructure, for reference

| Was | Now |
|---|---|
| `godot/project.godot` | `project.godot` |
| `godot/scripts/**` | `src/**` |
| `godot/test/checks/**` | `tests/unit/**` |
| `godot/test/integration/**` | `tests/integration/**` |
| `godot/art/**` | `assets/art/**` |
| `godot/tools/**` | `tools/**` |
| `godot/{scenes,levels}/**` | unchanged, at the root |
| Phaser `src/`, `public/`, `scripts/`, `package.json`, … | deleted (in git history) |

`res://` is anchored to the directory holding `project.godot`, so the move and
the renames shipped together with every reference rewritten.

## What remains

### 1. The ice mechanic — the biggest gap

The Phaser build's whole design was *a hero that is good to control, plus one
mechanic — ice — that changes how it moves*. Ice is **not ported at all**. There
is no surface concept anywhere in the tree: `HeightField` holds heights
(`_heights`) and nothing else, the level legend has only `empty solid spawn`, and
`movement.gd` has a single set of ground constants where the Phaser build had a
rock set and an ice set moving together.

Porting it touches three places, and the third is the reason the Phaser build
needed three numbers rather than one:

- `src/level/height_field.gd` — carry a per-cell surface alongside the height.
- `src/level/level_source.gd` — a surface field in `[legend]` (it is the only
  file that knows the text format), plus a level that uses it.
- `src/objects/height_mover.gd` / `src/config/movement.gd` — surface-dependent
  acceleration, turn acceleration and drag. The Phaser notes are worth reading
  before starting: **drag only applies on a step where acceleration is exactly
  zero**, so lowering drag alone does not make ice slippery *while steering*.

Acceptance has a precedent to copy: the Phaser build asserted release-at-speed
slide distance as a *relationship* (well over on ice, well under on rock) rather
than an exact number, so the constants could be tuned by feel without the suite
fighting back.

### 2. Terrain art

Terrain is drawn as flat placeholder faces with the grid over them. There is no
tilemap: `TileMapLayer` is mentioned only in `src/config/iso.gd`'s comments,
including the rule that elevation must be expressed as **sibling TileMapLayers,
never `z_index`** — a note written for work that has not been done yet. The
Phaser build had sliced tiles and an autotile pass deriving snow caps.

### 3. Animation: `land` is built and never played

`assets/art/bear/layout.json` registers 20 strips — idle, run, jump, fall and
land, in four directions each — and `src/objects/hero.gd`'s `_clip_name()`
returns only `jump`, `fall`, `run` and `idle`. So `land` is generated,
registered, shipped, and unreachable. Either wire it or drop it.

### 4. `debug_toggle` is bound to nothing

`F1` is in `project.godot`'s input map as `debug_toggle`, and no game code reads
it — the Phaser build's F1 physics/debug overlay was not ported. Implement it or
remove the binding; a bound key that does nothing is a small lie in the input map.

### 5. One level, and it is a test rig

`levels/feel-test-01.txt` is a 16×16 height field with a plateau and a pit,
laid out so the tests can measure against it. There is no second level and no
goal.

### 6. One-way platforms have an API now, and are unused

The Phaser build had one-way ledges. The Godot side has none — `one_way` appears
only in `tools/probe_capabilities.gd`. Godot 4.7 added
`CollisionShape2D.one_way_collision_direction`, settable to any direction
relative to the shape, which ends the old workaround; use it rather than the
pre-4.7 approach when these are ported.

### 7. Nothing tests the export

Two real bugs shipped to the live site — the level and the sprite strips missing
from the pck — and no test could have caught either, because the suite and the
smoke run both read from the source tree and never from a packed build. A
post-export check (boot the exported build, or assert the required non-resource
files are present in the pck) would be the highest-value test in the repo right
now.

### 8. The CCGS template is not on `main`

`.claude/`, `project.yaml` and `CLAUDE.md` live on the branch `ccgs-trial`, so
`/setup-engine` cannot run on `main`. Branches: `main`, `isometric-godot`,
`ccgs-trial`.

Worth knowing before re-running it: the earlier engine config was deliberately
discarded, so `/setup-engine` will redo the Godot 4.6→4.7 reference research. And
the code root should now resolve to `src/` on its own — the layout matches what
`resolve_code_root` expects, so the `--path godot` workaround that config carried
is obsolete. Commands should use `--path .`.

## Traps already paid for

Each of these cost real time. None are obvious from the code.

**Exporting**

- `export_filter="all_resources"` does **not** pack non-resources. Anything read
  with `FileAccess` that is not a resource — a `.txt`, a `.json` — silently
  vanishes from the pck. `include_filter="*.txt,*.json"` is load-bearing.
- A packed build ships the **imported** texture, not the source PNG, and
  redirects `<name>.png` through the import system. A raw
  `FileAccess.get_file_as_bytes("res://x.png")` finds nothing in an export,
  no matter how the file is packed — the "keep file" importer does not help
  (measured: the PNGs went into the pck and the runtime still reported every
  strip missing). Load the texture and use `get_image()`.
- **`#` comments in `export_presets.cfg` are dropped**, silently. Godot's
  ConfigFile printed `Couldn't find the given section "preset.0" and key
  "include_filter"` and then exported anyway, so the build looked fine and was
  not. Keep that file comment-free.
- Godot does not create the export output directory; it errors if it is missing.
- A web export on Pages must be the **non-threaded** variant
  (`variant/thread_support=false`), because Pages cannot send COOP/COEP. Verify
  with `GODOT_THREADS_ENABLED = false` in the built `index.html`.

**Building and running**

- `godot --headless --path . --import` **aborts (exit 134, "singleton is null"
  in `is_cmdline_mode`)** when the official release binary meets a `.godot/`
  cache written by the distro build. Delete `.godot/` when switching binaries.
- The export needs `--import` to have run: a fresh clone has no `.godot/` class
  cache and the export fails without it.
- `--write-movie` crashes in 4.7.2 (signal 11, exit 134, zero-byte output) — do
  not use it to capture headless evidence.
- `--script` is **editor-build only**, so CI needs the full editor *and* the
  export templates; the suite cannot run from a template.

**CI**

- A workflow `run:` value that is a plain scalar starting with `"` is invalid
  YAML. GitHub rejects the whole file and the run fails in 0s having executed
  nothing. Use `run: |`. Running the commands is not parsing the file — check it
  with `yaml.safe_load`.

## Verifying a web build in a browser

**The only check that would have caught the export bugs.** A Godot splash on
screen proves nothing — the loading screen is HTML, not WebGL; the engine may
have failed after drawing it. Drive a real browser and read its console.

```bash
# 1. headless Chromium with a debugging port
chromium --headless=new --no-sandbox --disable-gpu --enable-unsafe-swiftshader \
         --remote-debugging-port=9222 about:blank &

# 2. serve the export (or point at the live URL)
python3 -m http.server 8101 --directory export/web --bind 127.0.0.1 &
```

Then connect to `http://127.0.0.1:9222/json/list` with a WebSocket, enable
`Runtime`/`Log`/`Page`/`Network`, navigate, wait (the 39 MB wasm takes a while to
compile under SwiftShader — allow ~60–80 s, and note `--virtual-time-budget` does
**not** grant real compile time), then read `Runtime.evaluate` and
`Page.captureScreenshot`. Node's global `WebSocket` means no dependencies.

What to look for in the console:

```
level_scene: feel-test-01 — 252 cells, spawn (9, 11) at 32   <- the level loaded
WARNING: bear frames: missing or unreadable strip …          <- a strip did not
```

A clean load prints both lines and no errors.

## Related documents

- `README.md` — the game, its design targets and how to run it
- `assets/concepts/ANIMATION-LOG.md` — the animation round, and the current strip
  status (its body describes the retired Node pipeline; the status note at the
  top is current)
- `assets/concepts/ASSET-LOG.md` — the art prototype rounds
- `docs/engine-reference/godot/` — **not present on `main`**; it was part of the
  discarded CCGS config and lives on `ccgs-trial`
