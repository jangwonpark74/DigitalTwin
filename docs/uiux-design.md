# Atlas RAN Twin — desktop UI/UX design specification

## Purpose and product boundary

A preparation studio for a 5G site/cell/radio-environment digital twin. A planner can describe a city/cluster, virtual RAN edge, GH200/H200/Grace placement, experiment inputs, tasks and monitoring contracts in one coherent workspace. This browser mockup is **not** a connected RAN or live operations console. It must never present synthetic coverage, planned dates, inventory targets or unverified software versions as measured/installed/executed facts.

## Primary desktop journey

1. **Mission control:** read offline readiness and the four-step workflow starter. Inspect schematic map, selected site, illustrative scenario, use-case cards, and local activity.
2. **Twin Workspace:** create or open a project; manage project names and lifecycle; set map scope, choose site, edit virtual RU front end and cell parameters; inspect physical/virtual architecture boundary.
3. **Twin Configuration:** set channel-job inputs and CPU UE fleet. Preview formulas remain synthetic and explicitly labeled.
4. **Use Cases:** configure virtual-drive route, paired package A/B plan and AI-RAN dataset schema/splits. Export planning JSON only.
5. **Tasks & Schedule:** add tasks, prioritize and order prerequisites; rescheduling rejects dates preceding dependencies. No background scheduler runs.
6. **Twin Management:** declare GH200/H200/Grace/fronthaul target aliases, software target versions and monitoring alert thresholds. Inventory says *not discovered*, software says *not verified*, and every signal says *no data*.
7. **Handoff:** export the project manifest; re-import it into the local prototype. The loader strips any externally claimed readiness, discovery or telemetry state.

## Information architecture

The left sidebar has five visible, keyboard-operated top-level sections: **Twin Workspace**, **Twin Configuration**, **Use Cases**, **Tasks & Schedule**, **Twin Management**. Expand a section to reveal its pages; opening another collapses the previous one. Activity is a standalone link. Current page is distinguished by active styling and the breadcrumb. At short desktop heights the sidebar navigation scrolls independently; top-level section titles remain visible in the initial collapsed layout.

| Section | Pages | User decision |
| --- | --- | --- |
| Twin Workspace | Mission control; Projects; Project artifacts; City map & sites; RAN architecture; Site & cell planner | Which independent twin project is active, what artifacts belong to it, and what design/site needs editing? |
| Twin Configuration | Ray-tracing lab; Virtual UE fleet | What inputs and resource roles must be prepared? |
| Use Cases | Virtual drive test; Package A/B test; AI-RAN data gen | Which experiment specification is ready to hand off? |
| Tasks & Schedule | Task board; Schedule | In what dependency order should preparation happen? |
| Twin Management | H/W inventory; Software management; Monitoring | Which target assets, versions and signals must be verified? |

## Twin Workspace project lifecycle

- The sidebar project switcher opens **Projects**, where each project is listed with its name, city/cluster, active/archive state, site count and task count.
- Users can create an independent planning project, open or duplicate an active project, rename any project, archive/restore projects, and permanently delete archived projects after confirmation.
- The last active project cannot be archived and active projects cannot be permanently deleted. Archiving the open project switches to another active project without losing either plan.
- SQLite stores a versioned project registry, planned tasks, artifacts and Sionna-RT run records. Existing browser-local data migrates when the database is empty; each project retains its own map, radio inputs, use-case settings, tasks and Twin Management plan.
- Importing a planning manifest creates a new project and does not replace the current project. Duplicate imported names receive a distinct local project name. Project switching never implies external readiness or execution.
- **Project artifacts** opens a hierarchical, project-scoped file tree: `configuration/` (project, use-case and Twin Management JSON), `test-results/` (a provenance-labeled ray-path result after a local Sionna job or import, otherwise an explicit empty state), `logs/` (persisted activity JSONL), and `reports/` (planning manifest). Select a file to preview or download it. Configuration JSON and ray paths can be edited and saved to the active project's database record after validation. The planning manifest and activity log are generated from saved state. The mockup does not invent RAN test results.

## Design language

- **Color:** pure white app/reading surface; soft ice cards; dark slate primary copy; emerald action/focus state; restrained amber for pending/unverified states. Never use green for offline telemetry or unexecuted jobs.
- **Hierarchy:** page title and purpose → boundary banner → actionable summary/next step → editable planning inputs → provenance and limitations. Raw tables follow summaries.
- **Components:** accessible nav accordion, page header, readiness banner, metric tile, context panel, compact status badge, labeled editable field, task milestone, management asset card, hierarchical artifact tree and read-only file preview, empty/no-data signal, action toast.
- **Data semantics:** `planned` describes configuration; `not-discovered` describes inventory; `not-verified` describes software; `no-data` describes signals; `not-executed` describes scheduled jobs. These labels are deliberately distinct from healthy/online/success.
- **Interaction feedback:** database edits persist; invalid dependencies, versions and thresholds show a toast and leave previously valid data intact. Failed database writes show a retry path. Forms use labels and native validation; sidebar headings use `aria-expanded`/`aria-controls`; page changes move focus to the main region.
- **Project lifecycle feedback:** the active project name and city/cluster are visible in the sidebar switcher; lifecycle actions update the registry and list immediately, with destructive deletion restricted to archived projects.
- **Responsive desktop:** at normal 1280×577 viewport all top-level workspaces remain visible; cards stack into two or one columns as width narrows. This is a PC-first mockup rather than a mobile app.

## Screen-state inventory

| Surface | Default / empty | Editing / validation | Future connected state (not implemented) |
| --- | --- | --- | --- |
| Map | schematic starter canvas with WGS84 scope | local GeoJSON import, project 3D view, and a separate city explorer with generated buildings or token-enabled Cesium OSM Buildings, imagery and terrain; city exploration does not change RF inputs | validated OSM-to-Sionna geometry and materials with verified production scene provenance |
| Ray-tracing | proxy values labeled synthetic; no solved paths | bounded local Sionna-RT single-link path job when runtime is installed; unverified path JSON import; 3D overlay and provenance | calibrated multi-link jobs, durable artifacts, verified radio maps and timestamps |
| Use cases | planned route/matrix/schema; no samples or rows | route, seeds, labels and splits bounded by model tests | backend job state and versioned measurements/datasets |
| Tasks & Schedule | all tasks planned; none executed | dependency-safe due dates and new task form | authenticated scheduler with timezones, retries, evidence |
| H/W inventory | target GH200/H200/Grace/fronthaul; zero discovery | target alias edits | device IDs, topology, capacity and probe timestamps |
| Software | target components; installation not verified | version target edits | package artifact hash, deploy status and audit trail |
| Monitoring | blank signal readings and no collector | alert-threshold edits | timestamped samples, source provenance and alarm routing |
| Project artifacts | SQLite-backed project configuration, planning files, activity and RT runs | expand folders, edit JSON, preview, download and retrieve saved lists | calibrated execution artifacts with checksums and retention policy |

## Scope / acceptance

- The prototype opens over a localhost HTTP server without package installation.
- All five top-level sections and their pages navigate without JavaScript exceptions; accordion operation works with mouse and keyboard.
- Twin Workspace supports isolated project creation, switching, duplication, rename, archive/restore, archived-project deletion, legacy single-project migration, and non-destructive manifest import; Project artifacts presents a hierarchical tree with per-project configuration, test-result status, logs and reports.
- Task add/reschedule, hardware alias, software version and monitoring threshold edits survive a reload and a JSON export/import.
- GeoJSON footprint and ray-path imports persist per project and in exported manifests; the viewer labels coordinates, assumptions, and unverified provenance.
- Every offline state remains explicit after import. The app does not call a RAN or OSM service. An optional local Sionna-RT subprocess can solve bounded path jobs; it is never presented as a calibrated or deployed RAN twin.
- Both deterministic model tests and browser navigation/screenshots validate the design. See the project README for commands.
