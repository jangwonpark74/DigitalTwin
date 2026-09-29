# Atlas RAN Twin — interactive 5G RAN mockup

A local 5G RAN planning workspace with WGS84 scene import, a CesiumJS 3D globe, and an optional Sionna-RT path runner. It is not a connected RAN or a calibrated RF simulator.

## Run

```bash
cd /Users/parkjangwon/Project/UI_UX_Mockup
make setup               # install pinned CesiumJS assets once
make run                 # http://127.0.0.1:8765/
# In another terminal: make check
```

If this project is already serving on the requested port, `make run` prints its URL and exits successfully instead of starting a duplicate server. Stop an older server process with Ctrl+C and run `make run` again to enable new database routes. If a **different** service owns the port, use `make run PORT=8766` (or another free port). `make test` runs the deterministic model, use-case, task, management, SQLite and server-boundary suites; `make check` additionally checks JavaScript syntax. ES modules need an HTTP server, so opening `index.html` with `file://` is not supported. `make setup` runs `npm ci` from the checked-in lockfile; the server then serves CesiumJS from local `node_modules`. The UI uses a **white/light theme**.

See [the desktop UI/UX design specification](docs/uiux-design.md) and [the use-case contracts](docs/use-cases.md) for journeys, screen states, backend requirements and acceptance criteria.

## What you can do

- Inspect a **schematic** starter canvas, select a site, and toggle buildings, sector wedges, and sampled UE markers.
- Set the WGS84 center and radius; load a local GeoJSON FeatureCollection of building polygons, then switch between 2D footprints and a CesiumJS 3D globe with building extrusions at actual meter heights. Located radios use their latitude/longitude; unlocated radios appear only in the schematic 2D map until coordinates are set.
- Open **City map & sites → Explore 3D city** for a generated city preview with Seoul, New York, San Francisco, and London camera presets. To stream real Cesium OSM Buildings with imagery and terrain, enter a Cesium ion access token in that view and select **Load live OSM Buildings**. The token is kept only in the tab’s memory and sent to Cesium ion by CesiumJS; it is not stored in SQLite. The city explorer never modifies project GeoJSON, radio coordinates, or Sionna-RT inputs.
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
- Navigate five expandable top-level desktop sections, use the four-step mission-control launchpad, and export/import all planning settings locally.
- Manage multiple Twin Workspace projects: create, open, rename, duplicate, archive, restore, or permanently delete archived projects. Each project keeps independent plans in SQLite; importing a manifest creates a separate project instead of replacing the current one. Existing browser projects are imported when the database is empty.
- Browse each active project's artifact tree (`configuration/`, `test-results/`, `logs/`, and `reports/`), edit JSON configuration or ray paths, save validated changes into the database, and download a copy. Project edits refresh the other workspaces and generated planning manifest. Editing ray paths marks them unverified; saving `project.json` resets readiness and execution claims. The planning manifest and activity log remain generated from saved state. A local path job or ray-path import adds a provenance-labeled result under `test-results/`; RAN and hardware test evidence remains absent.

## Local database and list API

`make run` creates `state/atlas-ran-twin.sqlite3` on first use. The directory is ignored by Git and blocked from HTTP file serving. Set `ATLAS_DB_PATH=/absolute/path/to/twin.sqlite3` to choose another location. SQLite stores project records, activity, planned tasks, artifact files, and server-recorded Sionna-RT runs. Browser storage is only a migration source and a backup of confirmed saves. A stale or unavailable database shows a retry message; concurrent browser tabs use revision checks to prevent silent overwrites.

The loopback-only JSON API exposes `GET /api/workspace`, `GET /api/projects`, `GET /api/projects/{id}/tasks`, `GET /api/projects/{id}/artifacts`, `GET /api/projects/{id}/artifacts/{artifactId}`, `GET /api/projects/{id}/runs`, and `GET /api/runs/{runId}`. Add `?content=1` to an artifact list to include file contents; otherwise it returns metadata. Run lists return `runs`, `total`, and `nextOffset`, with optional `limit` (1–200) and `offset`. `PUT /api/workspace` saves a validated workspace and artifact index in one transaction. `POST /api/rt/jobs` links a real RT job to `projectId`; its result remains retrievable after the server restarts. Interrupted jobs are marked as such on restart. Planned delivery tasks have no executor, so their run list remains empty until a real integration records one.

## Deployment boundary

Target platform: **GH200 host, H200 GPU for channel/radio workloads, Grace CPU for software UE models**. The optional local path runner uses the resources of the machine that runs `serve.py`; it does not discover or reserve a GH200. When a token is supplied, CesiumJS streams OSM-derived 3D Tiles, imagery, and terrain from Cesium ion for visual exploration only. The app does not contact vCore/vDU, run a virtual RU, execute UEs, or assert that target hardware is available. Imported GeoJSON uses assumed concrete material in a local job; it is not RF-calibrated. The readiness checklist intentionally leaves external verification gates pending. Imported manifests cannot mark a deployment as verified.

## Run Sionna-RT paths

The macOS system Python may be older than the Sionna-RT runtime requires. Set up the project's isolated Python 3.13 environment and run the real worker smoke test:

```bash
make rt-setup
make test-rt
make run
```

`make rt-setup` installs the tested `sionna-rt==2.1.0` package into `.venv-sionna-rt/` (ignored by Git); `make test-rt` and `make run` select it automatically. If the server was already running before setup, stop it and run `make run` again so it picks up the RT interpreter. To use another compatible environment, override `SIONNA_RT_PYTHON=/absolute/path/to/python` for either command. See the [official installation guide](https://nvlabs.github.io/sionna/installation.html).

The ray page reports whether the server detects the package; a job verifies that its backend runs. Load building GeoJSON, set latitude/longitude for a radio in **Radio planner**, select the transmitter site there or on the map, then enter a receiver within the map scope. The local server runs one path job at a time with at most 100 footprints, depth 0–4, 1,000–200,000 samples per source, and a 180-second limit. It generates temporary meshes and uses concrete buildings/ground, isotropic single-element antennas, no refraction, and a deterministic solver seed. The returned path loss and interaction points are Sionna-RT outputs; the illustrative coverage/SINR proxy remains separate. Results include the scene fingerprint, job settings, and assumptions and can be downloaded as JSON. A successful local run is labeled **uncalibrated**, while an imported path file is labeled **unverified**. Exported manifests demote result provenance to unverified. Loading a different scene clears previous paths.

The local worker and HTTP API were exercised on macOS with Sionna-RT 2.1.0 and a CPU backend using a small line-of-sight scene. The target GH200/H200 runtime has not been verified. To use a GH200, run this app on that host with a compatible Sionna environment and reach its localhost server through an SSH port forward. The job API accepts only loopback clients.

## Local scene and ray import

Use **City map & sites → Load building GeoJSON** with [demo-buildings.geojson](examples/demo-buildings.geojson), then **Ray-tracing lab → Load ray paths JSON** with [demo-rays.json](examples/demo-rays.json) to try the viewer. These fixtures are synthetic examples. Imports and metadata stay in the active project's SQLite record and planning manifest.

GeoJSON must be a `FeatureCollection` with `Polygon` or `MultiPolygon` exterior rings in WGS84 `[longitude, latitude]` order (`EPSG:4326` / CRS84). Inner holes, terrain, materials, and other CRS values are outside this viewer's import contract. Heights come from `height` or `height_m` in meters, then `building:levels`/`levels` at an assumed 3 m per level, or a 12 m default. The viewer accepts up to 500 footprints with 64 vertices each in a file under 2 MB; the scene must fit a 20 km radius.

Ray JSON uses `schemaVersion: 1`, `kind: "ray-paths"`, `coordinateSystem: "EPSG:4326"`, `runId`, `solver`, and 1–200 `paths`. Each path has an `id`, `pathLossDb`, and 2–16 `points` with `latitude`, `longitude`, and `heightM`. The file limit is 1 MB. The UI tags all such results **imported/unverified** and keeps the illustrative planning proxy separate. The project and ray views place local paths and buildings on a WGS84 ellipsoid without terrain or imagery. The separate city explorer can stream Cesium terrain and imagery, but does not import that content into the project or propagation simulation.

For a production implementation, add an OSM-to-Sionna scene pipeline with coordinate/material validation; RU/antenna/MMU and UE adapters; durable Sionna-RT job artifacts and radio maps; authenticated, read-only-first vCore/vDU test integration; and measured-vs-simulated calibration. The visual Cesium OSM Buildings layer does not supply calibrated RF geometry. Do not feed the illustrative metrics into operational decisions.

## Source context

- [Sionna RT introduction](https://nvlabs.github.io/sionna/rt/tutorials/Introduction.html): scene construction and OSM/Blender workflow.
- [NVIDIA Aerial](https://developer.nvidia.com/topics/telecommunications/ai-aerial): broader telecom accelerated-computing stack.
- [NVIDIA Aerial DT RAN modes](https://docs.nvidia.com/aerial/aerial-dt/archive/1.2.0/text/ran_digital_twin.html): distinguishes EM-only and RAN-integrated simulation. This mockup implements neither mode.
