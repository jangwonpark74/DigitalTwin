# Atlas RAN Twin — interactive 5G RAN mockup

A local, browser-based **planning mockup** for a 5G RAN network digital twin. This is not a connected RAN, a ray tracer, or a validated RF simulator.

## Run

```bash
cd /Users/parkjangwon/Project/UI_UX_Mockup
make run                 # http://127.0.0.1:8765/
# In another terminal: make check
```

If this project is already serving on the requested port, `make run` prints its URL and exits successfully instead of starting a duplicate server. Stop the original process with Ctrl+C in its terminal when you no longer need it. If a **different** service owns the port, use `make run PORT=8766` (or another free port). `make test` runs the deterministic model, use-case, task, management and server-boundary suites; `make check` additionally checks JavaScript syntax. ES modules need an HTTP server, so opening `index.html` with `file://` is not supported. No npm install is required. The UI uses a **white/light theme**.

See [the desktop UI/UX design specification](docs/uiux-design.md) and [the use-case contracts](docs/use-cases.md) for journeys, screen states, backend requirements and acceptance criteria.

## What you can do

- Inspect a **schematic** city/cluster canvas, select a site, and toggle buildings, sector wedges, and sampled UE markers.
- Set city/cluster, center coordinates and radius; select a local scene **filename reference**. It is not parsed, georeferenced, or imported.
- Add sites and edit three virtual cells per site: azimuth, downtilt, Tx power, bandwidth; choose virtual antenna or MMU.
- View the intended interface chain: **real vCore → real vDU → virtual O-RAN RU → virtual antenna/MMU → planned Sionna-RT channel → virtual software UE on Grace CPU**.
- Explore baseline, blockage, UE surge, and clear-line presets. The numeric coverage/capacity/SINR proxies are simple deterministic UI illustrations, **not** ray-traced or measured KPIs.
- Edit proposed Sionna-RT depth/propagation flags, UE count/mobility, endpoint labels (not credentials), and export/import a versioned planning manifest. Local edits persist in browser storage.
- Plan a **virtual drive test** with a route, sample count and playback scrubber. The marker moves; RF measurements remain blank until actual EM/RAN execution.
- Design a **package A/B test** with paired seeds, identical scene/traffic inputs, guardrails, and a run matrix. No package is executed and no winner is claimed.
- Specify **AI-RAN dataset generation** for channel prediction (EM) or handover/scheduler tasks (EM+RAN), with feature/label schemas, scene variants, group-safe splits, provenance and planned Parquet output. Generated rows remain zero.
- Download a JSON job plan for each use case or include all three in the project manifest.
- Use the **Tasks & Schedule** workspace to add planned tasks, select dependencies and change dates; invalid prerequisite order is rejected. No scheduler dispatches jobs.
- Use **Twin Management** to edit GH200/H200/Grace/fronthaul aliases, proposed software versions, and monitoring thresholds. Discovery, installation and telemetry states remain unverified/no-data.
- Navigate five expandable top-level desktop sections, use the four-step mission-control launchpad, and export/import all planning settings locally.
- Manage multiple Twin Workspace projects: create, open, rename, duplicate, archive, restore, or permanently delete archived projects. Each project keeps independent plans in browser storage; importing a manifest creates a separate project instead of replacing the current one.
- Browse each active project's artifact tree (`configuration/`, `test-results/`, `logs/`, and `reports/`), preview generated files, and download a copy. Configuration/manifests come from saved planning state, activity logs are project-scoped, and test results are explicitly empty until actual evidence exists; this browser-only prototype does not create OS directories.

## Deployment boundary

Target platform: **GH200 host, H200 GPU for future channel/radio workloads, Grace CPU for software UE models**. The mockup does not access the GPU, launch Sionna-RT, load OpenStreetMap, contact vCore/vDU, run a virtual RU, execute UEs, or assert that target hardware is available. The readiness checklist intentionally leaves external verification gates pending. Imported manifests cannot mark a deployment as verified.

For a real implementation, add an OSM-to-3D scene pipeline with coordinate/material validation; RU/antenna/MMU and UE adapters; versioned Sionna-RT jobs and output artifacts; authenticated, read-only-first vCore/vDU test integration; and measured-vs-simulated calibration. Do not feed the illustrative metrics into operational decisions.

## Source context

- [Sionna RT introduction](https://nvlabs.github.io/sionna/rt/tutorials/Introduction.html): scene construction and OSM/Blender workflow.
- [NVIDIA Aerial](https://developer.nvidia.com/topics/telecommunications/ai-aerial): broader telecom accelerated-computing stack.
- [NVIDIA Aerial DT RAN modes](https://docs.nvidia.com/aerial/aerial-dt/archive/1.2.0/text/ran_digital_twin.html): distinguishes EM-only and RAN-integrated simulation. This mockup implements neither mode.
