# Flap Happy

A compact window for MSFS 2024 gliders, and the same display inside the sim, including VR. It shows the current indicated airspeed (IAS) on a segmented bar, where each segment is one flap setting's speed range, plus the current flap position, so you can see at a glance which flap you should be in. A ballast slider shifts the speeds for water ballast. Press **PIN** to keep the desktop window above other programs.

The desktop app is Electron with `node-simconnect`. It owns the sim connection and serves the cockpit panel. The display is plain HTML/JS/CSS in a conservative subset so the sim's browser can run it.

Spec: `docs/flap-display-proposal.md` (rev 12). Mockup: `media/ui-mockup.png`. Screenshots of this build: `media/flaphappy-*.png`.

## Run it (no programming needed)

You need either the portable exe or a folder with these files plus Node.js.

**Option A: portable exe.** Someone builds `FlapHappy-1.0.0-portable.exe` once (see "Build the exe" below). Put it anywhere and double-click it. Nothing is installed. Windows SmartScreen may warn "Windows protected your PC" because the exe is not code-signed: click **More info** then **Run anyway**.

**Option B: from this folder.**
1. Install Node.js LTS from https://nodejs.org (accept the defaults).
2. Double-click **`Start Flap Happy.bat`**. The first run downloads the components (a few minutes), then the window opens.
3. No simulator handy? Double-click **`Start Flap Happy (demo, no sim).bat`**. It runs on fake data with a control panel so you can try everything.

With MSFS 2024: start the sim first or after, either works. Flap Happy reconnects by itself. The desktop window is compact, so the "Waiting for MSFS..." status line is hidden; the bar fills in once the sim is sending data. SimConnect needs no configuration or extra files; it connects over the sim's local connection.

### First use
1. Click the cog (top right) to open the settings.
2. A new install, or an empty profile folder, gets **AS33-18m**, **AS33-15m**, and **JS3**. AS33-18m opens first. Profiles already in the folder are not copied again.
3. Close the settings. Drag the ballast slider to match your load.

Your data lives in `%APPDATA%\FlapHappy\`:
- `profiles\<name>.json`: one file per profile (readable, shareable; drag a `.json` onto the window to import).
- `settings.json`: window position, zoom, selected profile, ballast, etc.

Saving writes a `.bak` next to the file first; deleted profiles are kept as `.deleted.bak`.

## Developer setup

```
npm install
npm run start:demo     # Electron window on simulated data + dev panel
npm start              # Electron window talking to MSFS via SimConnect
npm run harness        # build + static server; open http://127.0.0.1:5173/?seed=demo in Chrome/Edge
npm run check          # typecheck + unit tests + build + Coherent-safe lint
npm run test:ui        # browser + Electron tests (Playwright with a system Chrome; Linux needs xvfb-run for Electron)
```

Browser harness query options: `?seed=demo|none`, `&dev=0` (hide dev panel), `&compact=1`. Only `demo` loads the three built-in profiles.

Command line flags (after `npm start --` or on the exe):

| Flag | Meaning |
| --- | --- |
| `--source=simconnect\|simulated\|replay` | data source (default `simconnect`) |
| `--dev` | show the dev panel (always on for `simulated`) |
| `--record=file.jsonl` | write every sample to a trace file |
| `--trace=file.jsonl` `--speed=2` `--loop` | replay a trace (with `--source=replay`) |
| `--protocol=SunRise\|KittyHawk\|FSX_SP2\|FSX_SP1` | SimConnect protocol (default `SunRise`, MSFS 2024) |
| `--user-data=<dir>` | use another folder instead of `%APPDATA%\FlapHappy` |
| `--compact` | accepted; the window is always the compact frameless layout |

A sample trace is in `tests/fixtures/sample-trace.jsonl`. `--record` is how you capture a real flight to replay later (useful for bug reports).

### Build the exe (on Windows)

Double-click **`Build portable exe.bat`**, or:

```
npm install
npm run dist:portable      # release\FlapHappy-1.0.0-portable.exe
npm run dist:win           # portable + installer
```

The exe is unsigned. Its icon is the same glider as the VR toolbar. The config was also cross-built once on Linux as a sanity check, but that exe has not been run on Windows.

## How it is organised

```
core/       pure TypeScript, no DOM/Node: profile model, validation, ballast math, scale/marker math,
            current-flap resolver (index -> percent -> L: var -> "FLAP ?"), display-model builder
ui/         plain DOM view code (strip, ballast slider, settings editor, app orchestrator)
adapters/   DataSource / ProfileStore / Host implementations:
              simulated/  SimulatedSource, ScenarioPlayer, ReplaySource, MemoryProfileStore, dev panel
              electron/   SimConnectSource (main process), FileProfileStore, bridge adapters (IPC)
app-electron/  main process, preload (whitelisted bridge), CLI parsing
profiles/   built-in profiles shipped with the app (AS33-18m, AS33-15m, JS3)
build/      esbuild build, harness server, Coherent-safe lint
tests/      unit (core + adapters) and ui (Playwright)
```

The desktop UI talks to three adapter interfaces (data, profiles, and host). The cockpit panel is a second view of that same display: the desktop app keeps SimConnect and serves the panel on localhost.

Coherent-safe rules, enforced by `npm run lint:coherent` and by compiling the renderer to ES2015 and checking it with es-check: flexbox and absolute positioning only (no grid, `gap`, CSS variables), no `ResizeObserver`, `localStorage`, `fetch`, clipboard, pointer events, `Object.entries`, `padStart`; mouse and touch events only.

### Profiles in brief
A profile has N flap rows (any N from 0 up; each row: label and a sim index you type in) and exactly N-1 transitions, plus Vs and Vne. Saved speeds are metres per second to two decimal places; the display converts them to whole kt or km/h. The ballast slider interpolates stall and transition speeds between the two ends. VNE is one speed, saved as `vne_ms`. Validation (inline, with a summary box) requires strictly ascending speeds at both ballast ends; buckets narrower than 4 kt warn, narrower than 2 kt are errors. The display shows an error/incomplete message instead of misleading data when a profile is not valid.

**Simple flap indicator (optional).** In Settings, enable Simple flap indicator to replace the IAS, flap ribbon and transition numbers with a large centered current flap and a directional recommendation: a filled triangle points left to a slower profile row or right to a faster one, with a centered amber label. No recommendation is shown if the current row is already correct, the IAS is off-scale or unavailable, or telemetry/profile/mapping is not valid. This uses the profile's ordered speed buckets and current ballast setting; it does not introduce a new speed table. It is off by default, persists locally, and is shared by the desktop and cockpit panel. The Flap transitions switch is disabled while Simple mode is selected but keeps its prior value; the Ballast and AGL bars remain independently configurable.

## Choices and deviations worth knowing
- Schema ids are `flaphappy.profile/3` and `flaphappy.settings/1`. Files with another schema id are rejected.
- Minimum window content width is 560 px, growing with the flap count (`N*64+256`), so very large N scales instead of getting unreadable.
- Extra warnings were added when the profile has more rows than the sim reports handle positions for ("live count" check).
- The renderer is compiled with esbuild target `es2015` (not newer) to match the Coherent engine.
- There is no `--serve` mode; the browser harness is `npm run harness`.
- `profiles/as33-18m.json`, `profiles/as33-15m.json`, and `profiles/js3.json` are copied into an empty profile folder on first launch. AS33-18m opens first. An id that is already present is not written again.
- The dev panel, scenarios and fault injection (index missing/out of range, percent only, L: var only, unreadable, stale) exist so the whole fallback chain can be exercised without the sim.

## Tests
- `npm test`: 97 unit tests (profile model, validation, ballast and scale math, flap resolver, display model, file store, simulated source, scenarios incl. a 20-minute soak, replay, CLI parsing).
- `npm run test:ui`: 30 tests in a real browser (display for N = 0/1/2/6/10, states, fallbacks, ballast slider, editor, import errors, dev panel, compact) and in a real Electron window under simulated and replay sources (real files, restart persistence, compact window with no MINI/FULL button, recording).

## Only verifiable on Windows with MSFS 2024
Everything above runs and is tested without the sim. These need a real Windows machine and MSFS:
1. `node-simconnect` connects to MSFS 2024 with the `SunRise` protocol and no extra DLL/config; reconnects after the sim is closed and restarted.
2. The data definition really returns what the code expects for the AS 33 Me: flap handle index and count, flap percent, aircraft `TITLE` (used for auto-selecting a profile), and the optional `L:` variable (set in Advanced).
3. Which handle indices the AS 33 Me actually reports. The editor shows the live handle index so each profile row can be matched to the lever.
4. Sample rate and behaviour on pause, menus, loading and slew (the "Paused" / "No data" states).
5. Always-on-top over MSFS in windowed, borderless and true fullscreen modes (the app uses the highest topmost level; exclusive fullscreen may still hide it).
6. Packaging: the portable exe starts, SmartScreen behaviour, `%APPDATA%\FlapHappy` creation, file open/save dialogs, "Open profiles folder".
7. Cockpit panel: Settings → Window and app → **Install cockpit panel**, then restart MSFS. In the cockpit (including VR) press Tab and open **Flap Happy**. The desktop app must be running; the panel shows that same display.
8. The `--record` trace from a real flight replays correctly with `--source=replay`.
