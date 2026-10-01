# Atlas RAN Twin — Proposal 2 frontend refactoring design

> **Status:** implementation design draft; Proposal 2 is the recommended direction, not an authorization to replace the backend or begin a big-bang rewrite.
>
> **Source decision:** [Proposal 2 — TypeScript + React/Vite product workbench](frontend-architecture-proposals.md#proposal-2--typescript--reactvite-product-workbench).

**Goal:** Migrate the existing planning workbench from its imperative browser ES-module UI to a React + TypeScript + Vite client SPA in reversible, behavior-preserving vertical slices.

**Architecture:** Keep `serve.py`, the loopback JSON API, SQLite, project/revision semantics, exports/imports, and the existing pure planning modules as the source of truth. Introduce a React-owned shell and a temporary legacy-route adapter; each route moves behind the same typed application/API boundaries and is retired only after parity checks. Treat Cesium as a client-only imperative island with explicit create/update/dispose ownership.

**Target stack:** React + TypeScript + Vite; Zod for runtime parsing of untrusted transport/import data; Vitest + Testing Library for frontend contracts; Playwright for real-browser flows. Preserve the current Node built-in tests for the existing `.mjs` domain modules during migration. Validate the Cesium bundling/worker asset approach in the first build spike before selecting a plugin or custom copy configuration.

---

## 1. Design principles and non-goals

1. **One canonical project state.** SQLite remains authoritative after hydration. React, the legacy adapter, and Python must not maintain independent copies of persisted project data.
2. **One persistence path.** All project mutations go through the application store/service and the existing revision-checked `PUT /api/workspace` contract. Preserve the serialized save queue, save feedback, 409 conflict behavior, and localStorage's existing migration/backup role.
3. **TypeScript is not runtime validation.** Parse API responses and imported files at runtime, then run existing domain validators/upgraders for semantic constraints.
4. **Preserve domain logic.** Continue using tested functions in `model.mjs`, `workspaces.mjs`, `usecases.mjs`, `tasks.mjs`, `management.mjs`, `scene.mjs`, `artifacts.mjs`, and `rt-job.mjs`. Convert a module to TypeScript only as a separate, parity-tested slice; do not duplicate its logic in React components.
5. **Truthful readiness and provenance are product contracts.** Planned, illustrative, no-data, not-discovered, not-verified, imported/unverified, and locally solved/uncalibrated states stay semantically distinct. The UI never upgrades imported claims or synthetic KPIs into observed results.
6. **No route flag day.** Keep the old renderer available as a fallback while each equivalent React route passes functional, persistence, accessibility, and browser checks.
7. **No premature server-rendering tier.** The app is an interaction-heavy localhost workbench. Keep client-side rendering; add SSR only if a concrete public-content or collaboration requirement is approved.

**Out of scope:** changes to Python business logic, SQLite schema, Sionna-RT execution semantics, network/RAN integrations, authentication, calibration claims, mobile-first redesign, a new backend, or a second source of truth. This refactor does not promise a performance gain; performance is measured against the same fixture/device before and after.

## 2. Verified current baseline

The baseline was inspected on the current tree and `make check` passed before this design was written: **75 Node tests and 17 Python tests passed**, with the Makefile's JavaScript syntax checks also completing successfully. This is the current baseline, not a forecast for future changes.

- `index.html:23-88` owns the static navigation/shell, loads many global stylesheets, loads Cesium from `node_modules`, and starts `app.mjs` directly.
- `app.mjs:22-43` holds module-global project, workspace, route, editor, job, and Cesium state. `app.mjs:52-89` owns raw fetches, the revisioned save queue, localStorage backup, and persistence feedback.
- `app.mjs:360-431` imperatively replaces the content with HTML strings and manually preserves/recreates the Cesium host. `app.mjs:696-980` contains delegated click/change/input/keyboard behavior and most UI actions.
- `model.mjs:108-260` validates/upgrades project data and builds planning output. `workspaces.mjs:59-229` provides immutable-clone project lifecycle operations and activity updates. These modules already have focused tests and are the rules React must call, not reproduce.
- `scene-ui.mjs:36-154` constructs the Cesium viewer, creates/synchronizes entities, and moves the camera. `app.mjs:360-431` currently owns the viewer's route lifetime and render-time synchronization.
- `serve.py:122-203` serves static files and GET APIs; `serve.py:226-261` enforces loopback/origin checks for revisioned workspace saves and RT job submission. `serve.py:263-279` protects local files and sends no-store responses. Do not relax these boundaries for the Vite development server.
- Current API contracts are documented in `README.md:39-43`: workspace read/write, project/task/artifact/run reads, RT capability/jobs, and their existing pagination/conflict behavior.
- The visual and accessibility contracts live in `docs/uiux-design.md`; planning-flow semantics live in `docs/use-cases.md`.

### Baseline test contract to preserve

`make check` currently runs the `make test` suites and JavaScript syntax checks. Keep those suites green through the migration. Add frontend unit/component tests and browser tests without removing or weakening the current model, workspace, artifact, scene, server, storage, or RT-boundary assertions.

## 3. Target architecture

### 3.1 Boundaries

```text
React routes and shared components
        ↓ user intent / view models
Application controller + canonical workspace store
        ↓ typed commands and queries
Typed API adapters ─────────── existing pure domain modules
        ↓ same-origin JSON                       ↓ validation/planning
Python loopback API → SQLite             existing model and planners

React Cesium component → Cesium lifecycle adapter → existing scene helpers
```

- **Presentation:** React owns the application shell, navigation, page lifecycle, focus management, and visual components. Page components display view models and dispatch intent; they do not issue fetches or recalculate planning/risk logic.
- **Application/store:** one application controller owns canonical workspace snapshots, active project, server revision, serialized saves, async status, and commands such as switch/create/update/import. Keep transient presentation state (open navigation group, selected tab, local dialog state) outside persisted project data.
- **API adapters:** typed modules own endpoint paths, request/response parsing, HTTP errors, and conflict translation. Components never call `fetch` directly.
- **Domain:** the existing tested `.mjs` functions remain authoritative. Runtime schemas validate transport shape; domain validators and migration helpers validate project semantics.
- **Legacy compatibility:** unconverted routes render through a single `LegacyRoute` adapter using the existing sanitized renderer output and controller callbacks. It is a temporary presentation adapter only: no independent workspace, duplicate persistence queue, iframe, or hidden local database.
- **Cesium:** a client-only adapter owns one viewer per mounted scene host. Create on mount, synchronize project/ray/camera changes incrementally, and destroy on unmount or an intentional source-mode change. Ordinary form edits must not recreate the viewer.

### 3.2 Proposed source layout

```text
src/
  main.tsx
  app/
    App.tsx
    routeRegistry.ts
    AppController.ts
    AppContext.tsx
    selectors.ts
  api/
    httpClient.ts
    schemas.ts
    workspaceApi.ts
    projectsApi.ts
    artifactsApi.ts
    runsApi.ts
    rtJobsApi.ts
  legacy/
    LegacyRoute.tsx
    legacyRenderer.ts
    legacyEventAdapter.ts
  features/
    mission-control/
    projects/
    site-planner/
    city-map/
    artifacts/
    ray-tracing/
    use-cases/
    tasks/
    management/
  shared/
    components/
    status/
    cesium/CesiumScene.tsx
    cesium/cesiumLifecycle.ts
    styles/tokens.css
  test/
    fixtures/
    setup.ts

vite.config.ts
vitest.config.ts
tsconfig.json
playwright.config.ts
tests/e2e/
```

The layout is a destination, not a reason to move all current files in one patch. The existing root `.mjs` domain modules and tests remain in place initially; import them through small typed facades/declarations where needed. Move a module only when its callers and tests can move together.

### 3.3 Typed boundary contracts

Use Zod schemas in `src/api/schemas.ts` for the outer JSON envelopes and file-import shapes. Reuse domain functions for project-level invariants (`validateWorkspaceState`, `validateProject`, `upgradeProject`, `parseGeoJsonScene`, `parseRayPaths`, and `applyArtifactJson`). Required adapter operations:

| Adapter | Existing contract | Required behavior |
| --- | --- | --- |
| `workspaceApi` | `GET /api/workspace`; `PUT /api/workspace` with `{revision, workspace, artifacts}` | Parse envelope; preserve server revision; serialize writes; map HTTP 409 to an explicit conflict state; never silently retry with a newer revision. |
| `projectsApi` | `GET /api/projects`; project lifecycle remains represented in the workspace save | Read the current registry; dispatch lifecycle mutations through the canonical store and save path. |
| `artifactsApi` | `GET /api/projects/{id}/artifacts[?content=1]`, artifact detail | Verify project scope and artifact shape; preserve hierarchy/IDs and editable-file rules. |
| `runsApi` | project run list with `limit`/`offset`, `GET /api/runs/{id}` | Preserve `runs`, `total`, `nextOffset`; reject a selected run from another project. |
| `rtJobsApi` | `GET /api/rt/capability`, `POST /api/rt/jobs`, `GET /api/rt/jobs/{id}` | Parse status/result envelopes; retain project ID and generation guards; show unavailable/failed separately from completed. |

`GET`/`PUT` paths, payloads, response semantics, and Python validation stay unchanged. The dev proxy must preserve the loopback restriction and make the forwarded `Host`/`Origin` satisfy the server's existing same-origin check; test a real save through the proxy before using it for development. Never weaken `serve.py`'s origin check to make the proxy pass.

## 4. Route migration order

The shared shell and route registry are introduced once, while each old route remains a fallback. Use stable route IDs matching the current navigation (`overview`, `projects`, `artifacts`, `map`, `stack`, `planner`, `radio`, `ray`, `ues`, `drive`, `ab`, `data`, `tasks`, `schedule`, `hardware`, `software`, `monitoring`, `activity`). Do not add a routing library until URL-addressable/deep-link routes become a requirement; the current app uses in-memory view navigation.

Each route slice includes: initial/loading/empty/error states; keyboard and focus behavior; selected-project switching; its relevant edit/validation path; reload persistence if it writes; export/import semantics if it participates; and honest status/provenance labels. A screenshot or a static render alone is not route parity.

## 5. Step-by-step implementation plan

### Phase 0 — Freeze observable contracts and record the migration baseline

**Files:** `docs/uiux-design.md`, `docs/use-cases.md`, existing tests; add `tests/e2e/` only when Playwright is introduced.

1. Keep the passing `make check` output as the baseline; do not edit production code in this phase.
2. Record a route/behavior matrix for all 18 route IDs, including default, empty, invalid, save-failed/conflict, and post-reload states where applicable.
3. Capture a representative desktop viewport (1280×577 as specified) and one narrow viewport for the old app; note browser, viewport, and fixture so comparisons are repeatable.
4. Identify flows to exercise end-to-end: project switch and isolation; create/rename/archive/restore/delete; save and 409 conflict; reload; site selection and 2D/3D mode; import/export provenance; artifact edit/reject/save; RT unavailable/queued/failed/completed states; keyboard navigation and focus return.
5. Treat `docs/uiux-design.md` and `docs/use-cases.md` as behavior acceptance criteria. Resolve any conflict in favor of the explicit persisted/domain contract and record the decision before implementation.

**Exit gate:** baseline command is green; route IDs, data contracts, and browser fixtures are written down; no new UI code is required to start the refactor.

### Phase 1 — Add the frontend toolchain without changing the active UI

**Files:** `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `src/main.tsx`, `src/app/App.tsx`, `src/shared/styles/tokens.css`, `Makefile`, `serve.py` (only for the proven build-serving seam).

1. Add pinned React/React DOM, TypeScript, Vite, the React Vite plugin, Zod, Vitest, jsdom, Testing Library, and Playwright test dependencies. Keep Cesium pinned at its current version.
2. Configure strict TypeScript for new `.ts/.tsx` code (`strict`, `noEmit`, explicit `include`); keep legacy `.mjs` tests working and do not enable broad `checkJs` across the entire old app in this phase.
3. Add a minimal React entry and a deterministic production build. Do not switch the root route until the shell/legacy adapter can render all existing routes.
4. Prove a real Cesium viewer can be produced in both Vite dev and production build, including its worker/static assets. Select the plugin/copy strategy only after this smoke passes; document its base URL and ensure Cesium stays lazy-loaded for non-map routes.
5. Configure same-origin API proxying for Vite development; integration-test a successful revisioned save and a 409 conflict through it without weakening Python checks.
6. Add explicit targets: `npm run typecheck`, `npm run test:ui`, `npm run build`, and `npm run test:e2e`; extend `make check` to include typecheck, current `make test`, frontend unit tests, and the production build. Keep a separate browser target if browser installation is not part of the default local test setup.
7. Extend `serve.py` only to serve the production Vite entry/assets while preserving existing local static files, API routing, blocked paths, cache headers, and port-reuse checks. Add server tests for root/index/assets, API precedence, missing build behavior, and SQLite/graft path denial.

**Exit gate:** existing `make check` behavior remains green; React can render a minimal route in dev and built mode; Cesium smoke succeeds; Python API security tests are unchanged and pass.

### Phase 2 — Extract typed API adapters and the single application controller

**Files:** `src/api/*`, `src/app/AppController.ts`, `src/app/selectors.ts`, `src/legacy/legacyEventAdapter.ts`, existing `app.mjs` (incremental extraction), `tests/` and existing domain tests.

1. Add runtime schemas for API envelopes and imported JSON. Add valid, missing-field, wrong-type, oversized/invalid, and unexpected-project fixtures.
2. Move raw endpoint construction and `fetch` out of UI/event-handler code into the typed adapters; preserve no-store behavior and precise API error messages.
3. Extract the workspace snapshot, active project, revision, serialized save queue, database status, artifact/run records, and project-scoped async-generation guards behind one controller API: `getSnapshot`, `subscribe`, `hydrate`, `dispatch`, and explicit query methods.
4. Route existing legacy handlers through controller commands. Keep `model.mjs`, `workspaces.mjs`, artifact application, and task/use-case functions as the domain operations called by those commands.
5. On a successful write only, advance the revision and update localStorage backup. On conflict, preserve the unsaved local draft and show explicit reload/compare/retry choices; never auto-overwrite another tab.
6. Preserve first-run legacy localStorage migration only when the database is empty; test database-first reload and migration exactly once. Keep browser storage failure non-fatal when SQLite has confirmed the save.
7. Add architecture tests that forbid UI/features from importing `serve.py`/storage concerns, forbid page-level `fetch`, and ensure all persisted mutations use the controller save path.

**Exit gate:** legacy UI uses the controller/API adapters with unchanged behavior; API payloads and SQLite schema are unchanged; tests prove 409, retry, project isolation, failed storage, and legacy migration semantics.

### Phase 3 — Establish the React shell and a single-owner legacy fallback

**Files:** `index.html`, `src/main.tsx`, `src/app/App.tsx`, `src/app/routeRegistry.ts`, `src/app/AppContext.tsx`, `src/legacy/LegacyRoute.tsx`, `src/legacy/legacyRenderer.ts`, `src/legacy/legacyEventAdapter.ts`, `app.mjs` and shared CSS.

1. Move the shared header/sidebar/status bar into React using the existing route IDs and visual tokens. Preserve visible workspace navigation, `aria-expanded`/`aria-controls`, independent sidebar scrolling, breadcrumb, project context, and active route state.
2. Introduce a typed route registry: each route is either a React component or a temporary legacy-render adapter. The registry is the only route-to-view mapping.
3. Give React sole ownership of the shell and route host. Legacy screens may provide sanitized HTML as a temporary leaf view, but must not write `innerHTML` into a DOM node reconciled by React. Scope the legacy delegated events to that leaf host and send state-changing actions through the controller.
4. Keep exactly one mounted renderer for the current route. Remove legacy navigation ownership as React shell takes over; keep the old route renderer only for fallback content.
5. Move keyboard focus to the page heading/main region after route changes; preserve Escape/cancel behavior and warn before abandoning dirty artifact edits.
6. Add shell tests for route selection, accordion keyboard behavior, active project context, focus movement, and legacy fallback rendering. Add a guard test against two simultaneous shell roots or duplicate save subscriptions.

**Exit gate:** all current routes still work through the React-owned shell (unmigrated screens may still be legacy leaves); there is one active route renderer, one navigation state, and one persisted store.

### Phase 4 — Migrate Mission Control as the first complete React vertical slice

**Files:** `src/features/mission-control/*`, `src/shared/components/*`, `src/app/selectors.ts`, `src/app/routeRegistry.ts`, `app.mjs` only to remove the migrated route renderer.

1. Add a pure Mission Control view model from controller selectors and existing `readiness`/`simulatePreview` functions; do not recalculate planning rules inside JSX.
2. Build the page title/boundary banner, readiness summary, next action, project context, illustrative metrics, and activity summary with shared status components.
3. Preserve explicit synthetic/not-run labels and the distinction between configured gates and external verification.
4. Test default, database-loading, database-unavailable, empty activity, invalid stored project, and small viewport states.
5. Compare browser behavior, accessibility tree, screenshots, keyboard focus, and console output against Phase 0 fixtures.

**Exit gate:** Mission Control uses typed selectors and the shared store, passes route tests and browser checks, and has no page-level fetch or duplicated domain calculations.

### Phase 5 — Migrate Projects and revision-safe editing

**Files:** `src/features/projects/*`, `src/app/AppController.ts`, `src/api/workspaceApi.ts`, `workspaces.test.mjs`, new controller/API tests, `tests/e2e/projects.spec.ts`.

1. Port project listing and active-project switch using existing workspace lifecycle functions.
2. Port create, rename, duplicate, archive, restore, and permanent delete. Keep the final-active-project/archive-only constraints and confirmation behavior.
3. Make active project name/city/cluster update consistently in sidebar, breadcrumb, Mission Control, and downstream route data.
4. Exercise concurrent-tab conflict, rejected save, retry, explicit reload, dirty artifact draft cancellation, and successful reload from SQLite.
5. Verify exported manifest/import creates a new project and strips external readiness claims before moving import/export UI from its legacy fallback.

**Exit gate:** every project action is isolated and durable after reload; revision conflicts are visible and recoverable; no action replaces another project or silently advances a stale revision.

### Phase 6 — Migrate Site & Cell Planner, Radio Planner, and map with a Cesium lifecycle adapter

**Files:** `src/features/site-planner/*`, `src/features/city-map/*`, `src/shared/cesium/*`, `scene-ui.mjs` (adapt behind the lifecycle boundary only), `scene.test.mjs`, new component/browser tests.

1. Port editable site/cell forms and selected-site/cell controls, calling existing model functions for defaults, validation, coordinate conversions, and mutations.
2. Port schematic 2D selection and coordinate placement. Keep `map-estimate` labeling and never describe schematic percentages as surveyed coordinates.
3. Implement the 3D host as a client-only React component. Create the viewer once per host; update entities/camera through the adapter; destroy it on unmount or an intentional source switch. Clear timers/listeners and stale async city requests on unmount.
4. Lazy-load Cesium only when a map/3D route needs it. Keep the city explorer's generated/live layers separate from project RF geometry and retain the in-memory-only ion-token policy.
5. Preserve an accessible textual/list alternative for selected site, coordinates, layers, path details, and map actions; verify keyboard operation without pointer-only requirements.
6. Test repeated route entry/exit, switching projects, site/cell edits, switching 2D/3D and demo/live modes, stale async completion, Cesium viewer destruction count, and no duplicated entities.

**Exit gate:** same coordinates, geometry, provenance and project mutations as the old route; repeated navigation leaves one live viewer and no stale timer/listener; the textual equivalent is usable with keyboard/screen reader.

### Phase 7 — Migrate artifacts, imports/exports, and run records

**Files:** `src/features/artifacts/*`, `src/api/artifactsApi.ts`, `src/api/runsApi.ts`, `src/features/ray-tracing/*`, `src/features/mission-control/*`, `artifacts.mjs`, `app.mjs`, `artifacts.test.mjs`, `tests/e2e/artifacts.spec.ts`.

1. Port the project-scoped hierarchical tree and empty states using existing artifact tree builders and record normalizers.
2. Preserve editable JSON allowlists, generated-file read-only behavior, stale-draft detection, validation, save confirmation, and unverified-provenance demotion for edited ray results.
3. Port downloads and manifest import/export through the existing artifact/domain contracts. Keep schema-version upgrade behavior and never import readiness claims.
4. Port run list pagination and run detail; verify a selected run belongs to the active project.
5. Test empty/non-empty trees, full paths, rejected JSON without mutation, successful save/reload, local vs imported ray provenance, project switch during an async read, pagination, and download content.

**Exit gate:** artifacts and exports match existing schema and hierarchy; project scope is enforced; no generated report is editable; imports cannot claim external verification.

### Phase 8 — Migrate Ray Tracing and Cesium results as an async workflow

**Files:** `src/features/ray-tracing/*`, `src/api/rtJobsApi.ts`, `src/app/AppController.ts`, `src/shared/cesium/*`, `rt-job.mjs`, `scene.mjs`, `scene-ui.mjs`, `rt-job.test.mjs`, `scene.test.mjs`, `tests/e2e/ray-tracing.spec.ts`.

1. Port capability/loading/unavailable states and all bounded job input validation.
2. Keep save-before-run ordering; require an explicitly persisted active project; submit the unchanged payload with `projectId`.
3. Preserve generation/project guards for polling and late responses. On route/project change, ignore stale responses and clear timers without falsely marking a job complete.
4. Keep failed, queued, running, completed-with-paths, and completed-with-no-paths states distinct. Show local output as uncalibrated and imported paths as unverified.
5. Verify RT result artifacts remain durable after server restart and that project/export boundaries demote provenance as documented.

**Exit gate:** server job/API behavior is unchanged; failed or stale jobs cannot mutate another project; returned results preserve scene/job assumptions and provenance.

### Phase 9 — Migrate remaining routes, one bounded route family at a time

**Files:** one feature directory per family under `src/features/`, the associated root renderer modules, and their existing tests.

Suggested order:

1. `stack` / RAN architecture and `ues` / virtual UE fleet.
2. `drive`, `ab`, and `data` use-case pages, keeping `usecases.mjs` as authority and maintaining planned/not-executed/zero-generated-row semantics.
3. `tasks` and `schedule`, preserving dependency checks and persisted planned state.
4. `hardware`, `software`, and `monitoring`, preserving target/not-discovered/not-verified/no-data meanings.
5. `activity`, preserving project scope and chronological order.

For each route: add focused state/interaction tests first, port its renderer and handlers, run related existing Node tests, then browser-check normal, invalid, and empty states. Do not batch unrelated routes into a single unreviewable rewrite.

**Exit gate:** every route ID maps to a React feature or has an explicitly documented approved removal; no hidden legacy route is required for normal product behavior.

### Phase 10 — Retire the legacy renderer and close the cutover

**Files:** `app.mjs`, legacy route adapter files, `index.html`, `Makefile`, `serve.py`, `README.md`, route and browser tests.

1. Confirm every route's Phase 0 parity checklist is green and project/export semantics match on the same fixtures.
2. Remove legacy render/event code only after its last route is migrated. Retain pure domain `.mjs` modules and their Node tests unless separately approved for TypeScript conversion.
3. Make the React/Vite build the sole served UI entry. Keep `make run`'s public usage stable; build/asset failures must stop with an actionable message rather than silently serving a stale bundle or the retired UI.
4. Verify the production build through the real Python loopback server, not only Vite dev. Verify static files, API routes, blocked database paths, no-store behavior, port reuse/stale-server diagnostics, and API origin protections.
5. Remove obsolete CSS/templates/tests only when they are provably unused. Do not remove styles by filename guess; verify imports and browser routes first.
6. Run all checks and browser workflows from a clean install using the checked-in lockfile; review final `git diff --check` and status without committing unless asked.

**Exit gate:** the shipped app has one React shell, one application controller/store, unchanged Python/SQLite contracts, no legacy route dependency, and a complete green quality/browser gate.

## 6. Verification matrix and Definition of Done

| Boundary | Required evidence |
| --- | --- |
| Existing behavior | `make test` remains green throughout; tests are not deleted merely because a route renderer moved. |
| Type safety | `npm run typecheck` passes with strict checking for new TS/TSX code. Runtime data parsing has negative tests. |
| Frontend behavior | `npm run test:ui` covers controller, adapters, reducers/selectors, route states, error/conflict states, and accessibility-relevant semantics. |
| Build/serving | `npm run build`; built assets load through `make run`; API calls use same origin; missing/invalid build is actionable. |
| Browser flows | `npm run test:e2e` (or an equivalently documented browser run) verifies project switch/CRUD, save/conflict/reload, keyboard nav/focus, site selection, Cesium teardown, imports/exports/provenance, and failed/unavailable RT jobs. |
| Security/data boundary | Python loopback/origin tests pass; no new external backend, CORS relaxation, credential persistence, or direct SQLite access from the browser. |
| User trust | Every synthetic, planned, no-data, not-discovered, not-verified, imported/unverified, and local uncalibrated label remains correct across React routes, reload, and export/import. |
| UX quality | Desktop 1280×577 and narrow viewport are checked for clipping/overflow; keyboard navigation and accessible text alternative for Cesium are exercised; no console errors after core flows. |
| Cesium lifecycle | Viewer create/destroy and async cleanup are tested; repeated navigation does not leak viewers/timers/listeners or duplicate scene entities. |
| Performance | Measure bundle size, route transitions, typing responsiveness, first Cesium view, and memory after repeated map navigation on the same fixture/device. Report measured results only; do not use targets as results. |

**Definition of Done:** all ten phases' exit gates are met; `make check` and browser verification pass on the final tree; no user data/schema migration was introduced; project/revision/API/export behavior is unchanged; accessibility/provenance requirements are met; temporary legacy code is removed only after verified parity; and the final report names any measured deltas and known limitations.

## 7. Rollback and stop conditions

- Keep the current route available until its React counterpart passes that route's tests and browser acceptance. If a slice fails, revert only that slice and keep the remaining app on the prior implementation.
- Stop the migration and remain on the existing JS baseline if the React pilot requires duplicate persisted state, changes Python/SQLite contracts, weakens local API security, or cannot prove Cesium cleanup.
- Do not continue toward route retirement if a save conflict can silently overwrite data, imported data can claim readiness, a screen reader loses the map's textual equivalent, or browser evidence differs materially from model/API tests.
- Reassess Proposal 2 after the Mission Control + Projects + Site/Cesium vertical slices. If a simpler alternative materially reduces state/lifecycle complexity for this team, record the decision before broadening the migration.

## 8. Related documentation

- [Phase 0 route/behavior baseline and browser fixture](frontend-refactoring-baseline.md)
- [Frontend architecture proposals](frontend-architecture-proposals.md)
- [Desktop UI/UX design specification](uiux-design.md)
- [Use-case contracts](use-cases.md)
- [Repository run and verification instructions](../README.md)
