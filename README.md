# Atlas RAN Twin — interactive 5G RAN mockup

A local 5G RAN planning workspace with WGS84 scene import, a MapLibre open 3D map, and an optional Sionna-RT path runner. It is not a connected RAN or a calibrated RF simulator.

**Open Silicon Valley example:** choose **City map → Explore 3D city** to view real OpenStreetMap building footprints in Palo Alto, Mountain View, and San Jose through MapLibre / OpenFreeMap. No map token is needed. Switch between 3D and 2D, inspect buildings, and toggle labels and geometry. Heights may be estimated; the example stays separate from project coordinates and RF inputs. See the [product design review and rendering proposal](docs/ui-ux-product-review.md).

**Engineering workflow:** the sidebar now follows Overview → Data and Twin Setup → Network Design → Simulation and Experiments → Validation and Optimization → Operations and Reports. Projects are global; runtime/software settings are separate utilities. Role presets shorten the menu, and the active section opens automatically. Existing route IDs remain usable in `?workspace=drive`, with aliases such as `?workspace=drive-analysis` and `?workspace=propagation`.

**GPS evidence:** import from Drive or Ray tracing lab, map vendor columns and units, declare origin/date, review KPI availability and geographic extent, then save. All map workspaces reuse the saved dataset and selection. Synthetic files remain synthetic, imported data remain unverified, and the trace is displayed 1.5 m above flat ground. The original UTF-8 CSV, source digest and normalization recipe appear in Reports / Project artifacts. See the [enhancement plan](docs/ran-digital-twin-enhancement-plan.md) and [implementation status](docs/ran-enhancement-implementation.md).

**Measurement library:** Data and Twin Setup → Measurement datasets retains imported snapshots and their original sources. Review a version's KPI availability and provenance before choosing it for the working network; all map and analysis views use that selection. Clear the working selection without deleting history. Existing datasets can be explicitly retained, and the next import also preserves a preceding unregistered dataset. Frozen baselines and run inputs keep their captured evidence. The library is bounded to 20 versions / 2 MB, within the existing 3 MB project snapshot limit; exceeded limits reject the save without pruning evidence.

**Sites and Cells:** Network Design has one site/sector editor with Summary, Position, RF, Antenna and Topology tabs. Set WGS84 coordinates and height in Position, RU/RAT and carrier targets in RF, and sector alignment/MMU inputs in Antenna. Map placement returns to Position with the saved coordinate source. Site/sector selection and project map mode stay consistent across views. Existing Radio bookmarks open this inspector on RF. Topology boundaries and vendor declarations remain planning inputs until their relationships and compatibility are verified.

**Cell identity review:** Review the working dataset's serving-cell identifiers and associate each source ID / LTE or NR pair with a compatible project cell. Saving retains a new interpretation without rewriting observations or frozen studies. Drive, City, Overview and Propagation show both source and associated identities and can select the associated site. Missing, ambiguous or incompatible targets remain unresolved; manual associations and exact internal-ID matches remain unverified. Search and paginated review support larger identifier lists. Analysis exports retain the interpretation metadata.

**Declared cell inventory:** In **Sites and Cells → RF → Cell identity and carrier**, choose a cell RAT and optionally enter MCC/MNC, NCI/ECI, PCI, NR-ARFCN/EARFCN, carrier label and source reference. Use **Save cell declaration** to save the group; leaving a field keeps a local draft. PLMN zeros and unavailable values are preserved, duplicate global identities and incompatible RATs reject the save, and API validation applies to working and frozen inventory. Measurement review uses each declared cell's RAT and shows its CGI/carrier alongside the original source ID. Declarations remain manual and unverified; registered SKT facility positions do not supply these values. See the [inventory identity contract](docs/cell-inventory-identity.md).

**Engineering studies:** open **Data and Twin Setup → Study definition**, record the decision/operator/RAT/carrier/window, then continue to **Network Design → Baselines & candidates**. Capture saved engineering inputs, create a candidate and review the exact site/sector changes. Each edit or revert adds a revision; previous definitions, baselines and revisions cannot be rewritten through the controller, JSON editor or SQLite API. **Review propagation inputs** opens the selected revision in the lab. Its **Propagation input version** selects the working network, a baseline or a retained candidate revision; captured geometry, transmitter settings and evidence are read-only. Other map/editing workspaces continue to use the working network. SHA-256 identifies captured content; it does not verify physical measurements or antenna assumptions. Bookmarks `?workspace=study-setup` and `?workspace=baseline-candidates` open these steps.

## Run

Install [Node.js 24 LTS](https://nodejs.org/en/download) (Node 22.12+ is also supported) and [Python 3.10+](https://www.python.org/downloads/); Python 3.13 is used in CI. The base application uses Python's standard library and SQLite, so no Python packages are needed. Run the following from the project folder on Windows 11, macOS or Linux:

```text
npm run setup
npm start
```

Open the URL printed by the server, normally `http://127.0.0.1:8765/`, in Edge or Chrome. Stop with Ctrl+C. This builds the React frontend and starts the Python/SQLite API together. `npm run help` lists the portable commands; `npm run check` runs the full local validation gate. Make, WSL, Bash and administrator access are not required on Windows.

For automatic Windows 11 setup, open PowerShell in your checkout and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
npm.cmd start
```

[The setup script](scripts/setup-windows.ps1) works with Windows PowerShell 5.1 and PowerShell 7. It reuses compatible installed tools, installs missing Git, Node.js LTS and Python 3.13 through [WinGet](https://learn.microsoft.com/en-us/windows/package-manager/winget/install), installs the pinned npm dependencies and Playwright Chromium, and runs `npm run check`. Internet access is required; individual installers may request UAC approval. If WinGet is unavailable, install/update **App Installer** from the Microsoft Store and reopen PowerShell. `-ExecutionPolicy Bypass` applies only to that PowerShell process; the script does not change your saved execution policy.

Add `-InstallVSCode` to install VS Code or `-InstallRayTracing` to install uv and LLVM, create the optional Sionna-RT environment, and verify a real worker job. `-SkipToolInstall` requires existing prerequisites, `-SkipBrowserInstall` skips Chromium, and `-SkipChecks` skips the base checks. For example:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -InstallVSCode -InstallRayTracing
# Existing toolchain; install project dependencies only:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -SkipToolInstall -SkipBrowserInstall -SkipChecks
```

The script locates its checkout from its own directory, or accepts `-ProjectRoot 'C:\Projects\Atlas Twin'`. It stops on failed commands, so rerunning after resolving a failure resumes using already installed tools. The optional CPU solver needs a working [LLVM backend](https://drjit.readthedocs.io/en/latest/what.html#backends); the script adds its DLL directory to your user PATH for future launches. Browser tests can then be run separately with `npm.cmd run test:e2e`.

For manual setup, open PowerShell or Command Prompt in your checkout. If PowerShell blocks `npm.ps1`, use the bundled `npm.cmd` entry point without changing execution policy:

```powershell
cd 'C:\Projects\UI_UX_Mockup_Typescript'
npm.cmd run setup
npm.cmd start
# In another terminal:
npm.cmd run check
```

The launcher detects Windows `py -3`, `python` and `python3`, or Unix `python3` and `python`. To select a particular interpreter, set `ATLAS_PYTHON` to its executable path, without extra command arguments. Paths with spaces and Unicode are supported. For example, in PowerShell:

```powershell
$env:ATLAS_PYTHON = 'C:\Users\Your Name\AppData\Local\Programs\Python\Python313\python.exe'
npm.cmd start -- --port 8766
```

An explicit `--port` or `PORT` requires that exact port. Otherwise startup checks up to 10 following ports and prints the actual URL. `--port-fallback` enables fallback for an explicit port; `--no-port-fallback` disables it. `AUTO_PORT=1`/`0` also controls fallback. `HOST` defaults to loopback. Set `$env:ATLAS_DB_PATH = 'C:\Atlas Data\twin.sqlite3'` in PowerShell to choose the SQLite location. Install dependencies separately on each computer with `npm run setup`; copied `node_modules` and virtual environments contain platform-specific binaries.

For frontend development, run `npm run api` in one terminal and `npm run dev` in another. The Vite proxy expects the API at port 8765; if the API prints a different port, set `$env:ATLAS_API_ORIGIN = 'http://127.0.0.1:8766'` before starting Vite (or the equivalent environment variable in your shell). For browser tests, install Chromium with `npm exec --no -- playwright install chromium`, then run `npm run test:e2e`. The [cross-platform CI workflow](.github/workflows/cross-platform.yml) runs the full checks and browser suite on Windows and Ubuntu, including checkout paths with spaces. Native Windows execution remains to be confirmed by that workflow or a Windows 11 run; local validation in this change was performed on macOS.

The existing macOS/Linux Make shortcuts remain available:

```bash
make setup               # install pinned runtime and frontend dependencies
make run                 # first available port from http://127.0.0.1:8765/
# In another terminal: make check
```

If this project is already serving on the requested port, `make run` prints its URL and exits successfully instead of starting a duplicate server. By default, an older server or another service on port 8765 makes the launcher check up to 10 following ports and print the actual URL; existing processes keep running. An explicit `PORT` (including an environment variable) requires that exact port, for example `make run PORT=8766`. Set `AUTO_PORT=0` to disable fallback or `AUTO_PORT=1` to allow fallback with an explicit port. `make test` runs the deterministic model, use-case, task, management, SQLite and server-boundary suites; `make check` additionally checks JavaScript syntax, strict frontend types, component/integration contracts, and the production Vite build. ES modules need an HTTP server, so opening `index.html` with `file://` is not supported. `make setup` installs the checked-in lockfile with both runtime and frontend development dependencies. The UI uses a **white/light theme**.

The React/TypeScript application is served at `/`; `make run` builds it with Vite and serves the static bundle and the existing Python/SQLite API. `npm run dev` starts Vite for frontend development, and `/frontend-preview.html` remains a development/test fixture for the Activity route. The React shell provides Mission Control, Projects, Activity, artifacts, the city map and site/radio planners, the Ray-tracing lab, RAN topology, Virtual UE fleet, Virtual drive test, Package A/B test, AI-RAN data generation, Hardware inventory, Software management, Monitoring, Schedule and Task board. These routes share one SQLite workspace controller for project selection, validated planning edits, planned-task creation, project-scoped RT run reads, and planning-manifest and use-case exports. Drive, Hardware and Radio currently use scoped HTML presenters within their React routes; route selection and the application shell are React-owned.

Planning and evidence boundaries remain explicit: Drive traces, filters and playback are transient; synthetic data is labelled unmeasured and imported data unverified. Hardware selection is transient and capacity or alias values are plans, with zero discovered hosts or verified links. Virtual UEs, A/B pairs and dataset rows are planning-only, Software versions remain unverified, Monitoring remains offline/no-data, and planned Schedule/Task board work never dispatches. A stale-revision save keeps the local draft and offers read-only comparison, retry without automatic overwrite, or confirmation-gated database reload. Vite proxies `/api` to `http://127.0.0.1:8765` by default; set `ATLAS_API_ORIGIN` to target another local API. `make check` builds the production bundle and verifies API save/conflict behavior through the proxy plus production serving through Python. For real-browser checks, install Chromium once with `npm exec --no -- playwright install chromium`, then run `npm run test:e2e`.

See [the desktop UI/UX design specification](docs/uiux-design.md) and [the use-case contracts](docs/use-cases.md) for journeys, screen states, backend requirements and acceptance criteria. For a comparison of TypeScript, React, Vue, Svelte, and other frontend directions, see [the frontend architecture proposals](docs/frontend-architecture-proposals.md); for the recommended Proposal 2 migration sequence, see [the frontend refactoring design](docs/frontend-refactoring-design.md).

## What you can do

- Inspect a **schematic** starter canvas, select a site, and toggle buildings, sector wedges, and sampled UE markers.
- Set the WGS84 center and radius; load a local GeoJSON FeatureCollection of building polygons, then switch between 2D footprints and a MapLibre open 3D map with building extrusions at actual meter heights. Located radios use their latitude/longitude; unlocated radios appear only in the schematic 2D map until coordinates are set.
- Open **City map & sites → Explore 3D city** for real OpenFreeMap / OpenStreetMap building footprints in Palo Alto, Mountain View, and San Jose. MapLibre renders the open vector tiles without an API key. The explorer never modifies project geometry, radio coordinates, or solver inputs.
- Load a local JSON file of ray paths for an overlaid 3D results view, path selection, path loss labels, and source metadata. Imported paths are unverified display data.
- Run a bounded local Sionna-RT path job from the loaded footprint scene when the server uses a Sionna-enabled Python interpreter. Choose a geographically located transmitter site, receiver coordinates, frequency, sample count, and depth. The browser shows job status and overlays returned paths; this is a single-link, assumed-material model.
- Add sites and edit three virtual cells per site: azimuth, downtilt, Tx power, bandwidth; choose virtual antenna or MMU.
- View the intended interface chain: **real vCore → real vDU → virtual O-RAN RU → virtual antenna/MMU → planned Sionna-RT channel → virtual software UE on Grace CPU**.
- Explore baseline, blockage, UE surge, and clear-line presets. The numeric coverage/capacity/SINR proxies are simple deterministic UI illustrations, **not** ray-traced or measured KPIs.
- Edit proposed Sionna-RT depth/propagation flags, UE count/mobility, endpoint labels (not credentials), and export/import a versioned planning manifest. Local edits persist in SQLite.
- Plan a **virtual drive test** with a route, sample count and playback scrubber. The marker moves; RF measurements remain blank until actual EM/RAN execution.
- Design a **package A/B test** with paired seeds, identical scene/traffic inputs, guardrails, and a run matrix. No package is executed and no winner is claimed.
- Specify **AI-RAN dataset generation** for channel prediction (EM) or handover/scheduler tasks (EM+RAN), with feature/label schemas, scene variants, group-safe splits, provenance and planned Parquet output. Generated rows remain zero.
- Download a JSON job plan for each use case or include all three in the project manifest.
- Use the **Tasks & Schedule** workspace to add planned tasks, select dependencies and change dates; invalid prerequisite order is rejected. The task board lists persisted Sionna-RT run results separately from planned delivery tasks. No scheduler dispatches those delivery tasks.
- Use **Twin Management** to edit GH200/H200/Grace/fronthaul aliases, proposed software versions, and monitoring thresholds. Discovery, installation and telemetry states remain unverified/no-data.
- Navigate six engineering sections, global Projects and platform settings; use the mission-control launchpad and export/import planning settings locally.
- Manage multiple Twin Workspace projects: create, open, rename, duplicate, archive, restore, or permanently delete archived projects. Each project keeps independent plans in SQLite; importing a manifest creates a separate project instead of replacing the current one. Existing browser projects are imported when the database is empty.
- Browse each active project's artifact tree (`configuration/`, `test-results/`, `logs/`, and `reports/`), edit JSON configuration or ray paths, save validated changes into the database, and download a copy. Project edits refresh the other workspaces and generated planning manifest. Editing ray paths marks them unverified; saving `project.json` resets readiness and execution claims. The planning manifest and activity log remain generated from saved state. A local path job or ray-path import adds a provenance-labeled result under `test-results/`; RAN and hardware test evidence remains absent.

## Local database and list API

`make run` creates `state/atlas-ran-twin.sqlite3` on first use. The directory is ignored by Git and blocked from HTTP file serving. Set `ATLAS_DB_PATH=/absolute/path/to/twin.sqlite3` to choose another location. SQLite stores project records, activity, planned tasks, artifact files, and server-recorded Sionna-RT runs. Browser storage is only a migration source and a backup of confirmed saves. A stale or unavailable database shows a retry message; concurrent browser tabs use revision checks to prevent silent overwrites.

The loopback-only JSON API exposes `GET /api/workspace`, `GET /api/projects`, `GET /api/projects/{id}/tasks`, `GET /api/projects/{id}/artifacts`, `GET /api/projects/{id}/artifacts/{artifactId}`, `GET /api/projects/{id}/runs`, and `GET /api/runs/{runId}`. Add `?content=1` to an artifact list to include file contents; otherwise it returns metadata. Run lists return `runs`, `total`, and `nextOffset`, with optional `limit` (1–200) and `offset`. `PUT /api/workspace` saves a validated workspace and artifact index in one transaction. `POST /api/rt/jobs` links a real RT job to `projectId`; its result remains retrievable after the server restarts. `POST /api/rt/jobs/{id}/cancel` and `/retry` accept only `{projectId}`. Cancellation retains the slot until worker exit; exact retry creates a linked run from retained captured inputs. Queued/running/cancelling jobs become interrupted on restart. Planned delivery tasks have no executor.

## Deployment boundary

Target platform: **GH200 host, H200 GPU for channel/radio workloads, Grace CPU for software UE models**. The optional local path runner uses the resources of the machine that runs `serve.py`; it does not discover or reserve a GH200. OpenFreeMap streams OSM-derived vector tiles for visual context. The app does not contact vCore/vDU, run a virtual RU, execute UEs, or assert that target hardware is available. Imported GeoJSON uses assumed concrete material in a local job; it is not RF-calibrated. The readiness checklist intentionally leaves external verification gates pending.

## Run Sionna-RT paths

Sionna-RT is optional. For Windows, macOS or Linux, install [uv](https://docs.astral.sh/uv/getting-started/installation/), then set up the isolated Python 3.13 environment and run the real worker smoke test:

```text
npm run rt:setup
npm run test:rt
npm start
```

The launcher uses `.venv-sionna-rt/Scripts/python.exe` on Windows and `.venv-sionna-rt/bin/python` on macOS/Linux. CPU ray tracing also requires a working LLVM backend; see [Sionna's installation requirements](https://nvlabs.github.io/sionna/installation.html) and [Dr.Jit's LLVM instructions, including Windows installers](https://drjit.readthedocs.io/en/latest/what.html#backends). Native Windows Sionna-RT jobs have not been verified here; run `npm run test:rt` to verify your installed backend. The base UI, imports and SQLite API run without this optional setup.

On macOS/Linux, the equivalent shortcuts are:

```bash
make rt-setup
make test-rt
make run
```

`make rt-setup` installs the tested `sionna-rt==2.1.0` package into `.venv-sionna-rt/` (ignored by Git); `make test-rt` and `make run` select it automatically. If the server was already running before setup, stop it and run `make run` again so it picks up the RT interpreter. To use another compatible environment, override `SIONNA_RT_PYTHON=/absolute/path/to/python` for either command. See the [official installation guide](https://nvlabs.github.io/sionna/installation.html).

The ray page reports whether the server detects the package; a job verifies that its backend runs. Load building GeoJSON, set latitude/longitude for a radio in **Sites and Cells → Position**, select the transmitter site there or on the map, then enter a receiver within the map scope. The local server runs one path job at a time with at most 100 footprints, depth 0–4, 1,000–200,000 samples per source, and a 180-second limit. It generates temporary meshes and uses concrete buildings/ground, isotropic single-element antennas, no refraction, and a deterministic solver seed. The returned path loss and interaction points are Sionna-RT outputs; the illustrative coverage/SINR proxy remains separate. Results include the scene fingerprint, job settings, and assumptions and can be downloaded as JSON. A successful local run is labeled **uncalibrated**, while an imported path file is labeled **unverified**. Exported manifests demote result provenance to unverified. Loading a different scene clears previous paths.

The local worker and HTTP API were exercised on macOS with Sionna-RT 2.1.0 and a CPU backend using a small line-of-sight scene. The target GH200/H200 runtime has not been verified. To use a GH200, run this app on that host with a compatible Sionna environment and reach its localhost server through an SSH port forward. The job API accepts only loopback clients.

## Local scene and ray import

Use **City map & sites → Load building GeoJSON** with [demo-buildings.geojson](examples/demo-buildings.geojson), then **Ray-tracing lab → Import ray path JSON** with [demo-rays.json](examples/demo-rays.json) to try the viewer. These fixtures are synthetic examples. Imports and metadata stay in the active project's SQLite record and planning manifest.

GeoJSON must be a `FeatureCollection` with `Polygon` or `MultiPolygon` exterior rings in WGS84 `[longitude, latitude]` order (`EPSG:4326` / CRS84). Inner holes, terrain, materials, and other CRS values are outside this viewer's import contract. Heights come from `height` or `height_m` in meters, then `building:levels`/`levels` at an assumed 3 m per level, or a 12 m default. The viewer accepts up to 500 footprints with 64 vertices each in a file under 2 MB; the scene must fit a 20 km radius.

Ray JSON uses `schemaVersion: 1`, `kind: "ray-paths"`, `coordinateSystem: "EPSG:4326"`, `runId`, `solver`, and 1–200 `paths`. Each path has an `id`, `pathLossDb`, and 2–16 `points` with `latitude`, `longitude`, and `heightM`. The ray file limit is 3 MB. The UI tags all such results **imported/unverified** and keeps the illustrative planning proxy separate. The project and ray views use MapLibre with altitude-aware 3D path overlays. Streamed map geometry is visual context only; imported GeoJSON supplies solver geometry.

For a production implementation, add an OSM-to-Sionna scene pipeline with coordinate/material validation; RU/antenna/MMU and UE adapters; durable Sionna-RT job artifacts and radio maps; authenticated, read-only-first vCore/vDU test integration; and measured-vs-simulated calibration. The open map context layer does not supply calibrated RF geometry. Do not feed the illustrative metrics into operational decisions.

## Source context

- [Sionna RT introduction](https://nvlabs.github.io/sionna/rt/tutorials/Introduction.html): scene construction and OSM/Blender workflow.
- [NVIDIA Aerial](https://developer.nvidia.com/topics/telecommunications/ai-aerial): broader telecom accelerated-computing stack.
- [NVIDIA Aerial DT RAN modes](https://docs.nvidia.com/aerial/aerial-dt/archive/1.2.0/text/ran_digital_twin.html): distinguishes EM-only and RAN-integrated simulation. This mockup implements neither mode.

### Open 3D 5G propagation lab

The Ray-tracing lab uses a full-width MapLibre 3D map with a taller desktop and mobile viewport. **Import drive test CSV** displays GPS samples and route segments colored by RSRP, SINR, RSRQ, or DL/UL throughput. Filter LTE/5G NR, use **Fit drive route**, and click a point or scrub the sample inspector to see its coordinates, serving cell, events and KPIs. GPS imports from **Virtual drive test** are also saved in the active project and shared with the lab. Imported values remain unverified and are separate from ray-tracing predictions; schematic demo rows are never mapped onto geographic streets.

Mission Control’s **City / cluster radio environment** uses the same street-map renderer, WGS84 site positions, viewport, and site selection as **City map**, **Site & cell planner**, and **Ray tracing lab**. Mission Control and City map also share 2D / Project 3D mode, tilt, drive KPI filters, selected sample, and layer visibility. These view preferences stay in the project’s workspace session without changing stored RF inputs. Changing project or map scope isolates the view state; radios without coordinates remain in the site list until positioned.

GPS CSV imports require elapsed time, technology, serving-cell identifier, latitude and longitude; all five KPI columns and `event` are optional. Canonical columns are `time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps,event`; vendor names can be mapped in the review. Time supports seconds or milliseconds; throughput supports Mbps, kbps or bps. Missing columns and blank / NA / N/A / NULL KPI values remain unavailable. Invalid provided values reject the import. Statistics use each KPI's available sample count; unavailable route points are gray and trend lines stop at missing observations. Zero throughput remains a valid observation. New saved imports use schema version 2; existing strict version 1 or unversioned captures remain unchanged. The limit is 1 MB / 5,000 rows / 512 source columns. GPS positions are not snapped to roads. Route segments do not bridge filtered-out samples, gaps over 30 seconds, or jumps over 300 meters. The color legend uses the Drive workspace's example thresholds.

The [Gangnam example](examples/gangnam-drive-test/gangnam-nonhyeon-teheran-synthetic-drive.csv) contains 676 synthetic NR GPS samples along an 8.6 km Nonhyeon / Gangnam / Teheran-ro / Hakdong-ro street loop. Import the [companion planning manifest](examples/gangnam-drive-test/gangnam-skt-drive-planning-manifest.json) through **Project artifacts → Import planning manifest** to create a separate project with the samples and nine SKT 5G stations at their KCA registered coordinates. Antenna heights, sector settings, serving-cell assignments and KPIs are demonstration assumptions. The [base station fetch method](docs/skt-base-station-data-fetch.md) documents the public requests, filters, selected records, coordinate handling and reproduction steps.

Load building GeoJSON in **Scene inputs**, or use **Use visible map buildings** to explicitly replace the RF scene and saved paths with up to 200 captured open-map footprints, then place the transmitter and receiver directly on the map. **Trace geometric paths** previews direct visibility, blockage, and up to twelve single specular reflections on imported vertical walls. Select a path to inspect its geometric length and travel time, and toggle path and open-map context layers. This bounded preview considers the nearest 120 wall candidates, assumes flat ground, and excludes indoor terminals, roof reflections, diffraction, materials and RF power prediction. The lab has no beam configuration panel.

Use **Run Sionna-RT paths** for the optional local solver, or import saved WGS84 ray JSON. Saved results render in a separate map mode and retain uncalibrated / unverified provenance. The existing Sionna-RT runner assumes isotropic antennas. Streamed OSM buildings become project inputs only through the explicit capture action. Captured polygons may be tile-clipped; holes, elevated structures and invalid rings are skipped, all source heights remain assumed, and geometry/material validation gates reset. Imported project geometry, drive KPIs and ray overlays remain available when open map context fails.

Each new path job freezes the selected engineering inputs, definition/dataset identity, receiver/options and solver profile (including seed 42). The API verifies those digests and the submitted job against saved inputs before recording the run. Candidate execution supports a height change on the selected transmitter; sector power, tilt, azimuth, bandwidth and changes on other sites block execution. The updated API must confirm run contract v1 before a captured version can run. **Simulation and Experiments → Jobs & runs** retains successful, failed, interrupted and cancelled runs, frozen requests, results, parent retry links and lifecycle events. Cancel waits for confirmed worker exit and discards subsequent output. **Retry frozen inputs** creates a new linked run using the exact original request even after working-network edits; legacy uncaptured jobs require a new Propagation run. Working-network outputs become stale after input edits and cannot overlay changed geometry; historical candidate results remain associated with their captured revision. Clone with new options, multi-site KPI prediction, physical calibration and comparable baseline/candidate result analysis remain pending. Browser control-plane tests use an explicit test worker; the separate real Sionna smoke test exercises the production process wrapper.
