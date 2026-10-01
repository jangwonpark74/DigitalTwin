# Atlas RAN Twin — frontend architecture proposals

**Decision requested:** choose a frontend direction for the *existing* planning workbench, not a replacement for its Python/SQLite/Sionna-RT backend. This is a comparative proposal, not an approved migration or a performance benchmark. No application code changes are implied.

## 1. Decision context

The repository is currently a browser ES-module application, **not a TypeScript app despite its directory name**: `app.mjs` owns navigation, imperative state and rendering; `model.mjs`, `workspaces.mjs` and other modules implement validated planning state; HTML-string renderers supply the UI; `scene-ui.mjs` and CesiumJS provide 3D views. `serve.py`/`storage.py` expose the local JSON API and SQLite persistence. The locked npm dependency is CesiumJS; there is no React, Vue or build-tool dependency. Preserve the project-scoped activity, artifact and run contracts, revision-checked saves, offline-first planning semantics, imported-result provenance and existing JavaScript/Python tests. See `README.md`, `docs/uiux-design.md`, `package.json`, and `graft/app-shell-browser-spa.md` for the baseline.

The 2025 State of JS survey describes largely stable usage rankings rather than a sudden framework replacement. Treat novelty as a hypothesis to test, not a reason to rewrite.[1]

### Non-negotiable product behavior

- Keep **planned**, **unverified**, **not discovered**, **not executed**, **no data**, **locally solved/uncalibrated** and **imported/unverified** visually and semantically distinct. Never turn a synthetic KPI into an operational result.
- Preserve the Python loopback API, SQLite project isolation/revision protection, artifact export/import schemas, ray-job status and Cesium token/session boundary. A frontend rewrite must not silently replace these with a separate data store or claim calibrated RF output.
- Support the desktop-first workbench, keyboard navigation, clear focus after route changes, labeled forms and recoverable save errors. The 3D canvas needs an accessible textual equivalent (selected site, coordinates, layer state and path details).

## 2. Design space: choose layers independently

**Language** is not **framework** is not **rendering mode**. TypeScript checks contracts at build time but does not make external JSON trustworthy. CSR = client-side rendering; SSR = server-side rendering; SSG = static generation. An authenticated, interaction-heavy localhost workbench gets much less from SEO/SSR than a public information site. Vite offers vanilla/TS, React/TS, Vue/TS and Svelte/TS templates, so build tooling need not dictate the UI library.[2]

| Option | Language / UI / delivery | Best fit and benefit | Main cost and Atlas fit |
| --- | --- | --- | --- |
| **A — Incremental baseline** | JavaScript → strict TypeScript for domain/API modules; existing DOM templates; optionally Vite for bundling | Lowest migration risk, preserve current UX/exports; type the model and network boundary first | Imperative whole-screen rendering remains hard to evolve; suitable for a small team or limited roadmap.[2] |
| **B — Recommended product SPA** | TypeScript + React + Vite, client-rendered routes | Deep ecosystem for dense forms, data exploration and component libraries; isolate Cesium as an imperative island | Component/state refactor and React/Cesium ownership discipline; Vite alone supplies no routing/data policy. React recommends full-stack frameworks for new general-purpose apps, but also documents Vite when building a tailored client app; this localhost constraint justifies testing that path.[2][3] |
| **C — Lightweight product SPA** | TypeScript + Vue 3 + Vite; Nuxt only if hybrid/SSR is needed | Approachable component model; Nuxt adds routing, code splitting, TypeScript support and SSR/SSG options | New team conventions; Nuxt's server layer adds little for the present local Python API. Validate the Cesium component lifecycle in a pilot.[2][8] |
| **D — Compact reactive SPA** | TypeScript + Svelte + Vite; SvelteKit if routing/SSR is wanted | Lean component authoring and built-in SvelteKit routing/rendering choices | Smaller hiring/library surface than React (a planning assumption, not a measured performance claim); test complex tables/forms before committing.[2][6] |
| **E — Full-stack React** | TypeScript + Next.js App Router, selective client components | Strong choice if a future public/collaborative product needs server routes, content pages and server-side data access | Adds a second web-server/runtime boundary beside Python; Cesium, file imports and browser-only editors stay client-side. RSC is a server/client code boundary, not a free performance upgrade for a local WebGL console.[3][7] |
| **F — Enterprise standardization** | TypeScript + Angular | Strong conventions for large teams: built-in routing, forms, dependency injection and signals | Greater initial framework commitment for this small local app; choose when organization-wide Angular skills and governance dominate.[9] |
| **G — Cross-platform app** | Dart + Flutter Web | Consider if a shared mobile/desktop app becomes the primary product; Flutter lists interactive dashboards as a good fit | Rebuilding native-DOM controls around a web-heavy Cesium viewer adds integration/accessibility work. Not a direct migration of this site's JS UI.[10] |

**Separate design-system choices:** (1) semantic CSS + tokens + accessible headless primitives for maximum control; (2) a mature component kit for dense desktop forms; (3) utility CSS for fast layout iteration. These are alternatives to evaluate within the chosen framework, not architectural reasons to select a framework. Do not let the framework's default visual kit redefine provenance colors or interaction states.

## 3. Three fundable proposals

### Proposal 1 — Preserve and type the core (lowest risk)

Keep `serve.py`, `storage.py`, Cesium and the current page system. Introduce strict TypeScript and a build step **only after** baseline exports and tests are frozen; migrate `model.mjs`/`workspaces.mjs` contracts and an API adapter before UI templates, or use JSDoc/checkJs if avoiding a build is more valuable. Extract repeated screen chrome and design tokens without touching persistence semantics. This wins for a prototype or a short-lived internal tool. Its ceiling is the imperative `app.mjs` render/event model; it does not solve long-term component reuse by itself.

### Proposal 2 — TypeScript + React/Vite product workbench (recommended)

Keep Python as a bounded local API and SQLite as source of truth. Move one complete route at a time into a React shell, with typed API adapters and runtime validation at JSON/import boundaries. Maintain a single canonical project store; server saves use existing revision checks, while view-only UI state (open panel, selected tab) remains local. Embed Cesium behind one client-only lifecycle adapter that creates/disposes the viewer and updates entities incrementally; never recreate it on every form edit. Preserve `model.mjs` rules as tested pure functions, converted gradually rather than duplicated in components.

Suggested slices: **(1)** read-only Mission Control/project selector and design tokens; **(2)** project CRUD + revision-conflict/save-error feedback; **(3)** site/cell editor + Cesium 2D/3D selection; **(4)** imports, ray jobs, artifact tree and exports; **(5)** retire old renderer routes only after behavior-parity checks. Retain the old route until its replacement passes browser and export tests. For a client-only localhost app, CSR is the default; add a server-rendered tier only after a concrete public-content or collaboration requirement exists.[2][3][7]

### Proposal 3 — Vue/Vite or SvelteKit product workbench (lean alternative)

Run the *same first two vertical slices* against Vue/Vite or SvelteKit with the same API/model contracts and Cesium adapter boundary. Choose Vue if team readability and conventional tooling win in the pilot; choose SvelteKit if the component authoring model and integrated routing make iteration measurably simpler. Do not compare framework toy demos: use the real project-switch/save/conflict and map/inspector workflows. If the app stays client-only, avoid introducing a second server merely because a meta-framework can provide one.[6][8]

### Recommendation / trigger to change it

Fund **Proposal 1 as a short stabilization gate, then Proposal 2 as the default migration** if this is a sustained product. Choose Proposal 3 instead if its real vertical slice delivers demonstrably simpler state/Cesium integration for the actual team. Consider Next/Nuxt/SSR when public indexing or server-rendered reports justify an additional rendering tier; choose Flutter only for a deliberate cross-platform product pivot. The recommendation is architectural judgment, not a benchmark result.

## 4. UI/UX direction independent of stack

| Direction | First screen | Navigation and interaction | Appropriate use |
| --- | --- | --- | --- |
| **Decision cockpit (default)** | Active project, honest readiness and next action, then evidence and the editable workspaces | Persistent desktop sidebar + compact context bar; progressively disclose long configuration panels | Daily planning and stakeholder walkthroughs; respects the existing `docs/uiux-design.md` hierarchy |
| **Geo-first studio** | Cesium/2D canvas with selected-site inspector and clear synthetic/real layer legend | Direct selection, side-by-side site/cell editing, keyboard-accessible list alternative | Radio engineers comparing map context and site configuration |
| **Evidence/research lab** | Recent runs, artifact provenance, input assumptions and blockers | Trace from source scene → job → result → interpretation; no result shown without status | RF validation, audit and handoff |

Use shared semantic tokens for status, typography, spacing and focus; start with the existing white/light identity rather than a trend-driven dark reset. Show separate empty/loading/error/conflict/stale states; keep destructive actions confirmed, cancel reversible edits, and place raw JSON/tables below the decision summary. Preserve sidebar discoverability at the documented short desktop height and check a narrow viewport for clipping. Aim for WCAG 2.2 AA as a **design target**, with keyboard/screen-reader tests and a real textual alternative for canvas information; this is not a claim of current conformance.[13]

## 5. Efficiency and quality gates (targets, not measured outcomes)

- **Avoid unnecessary work:** split non-map routes; lazy-load Cesium only for 3D views; dispose viewers/listeners on unmount; avoid rerendering full maps on field edits; virtualize large artifact/task lists only if profiling identifies a problem. Rendering strategy alone cannot remove WebGL/scene costs.
- **Protect correctness:** define one typed interface for `/api/workspace`, projects, artifacts and runs; validate inbound JSON and maintain schema-version migrations. Separate server state from transient UI state and preserve optimistic revision conflicts; never silently overwrite another tab's edits.
- **Measure before claiming improvement:** collect bundle sizes, route transition latency, editor typing responsiveness, Cesium first-view time, memory after repeated map navigation, and save-error recoverability on the same fixture/device. Track LCP, INP and CLS for web views at the 75th percentile where representative users exist; treat local WebGL startup as an additional product metric, not a substitute for Web Vitals.[5]
- **Test the user contract:** existing `make test` and `make check`; new unit tests for model/API invariants and component states; browser tests for project switch, save/conflict/reload, keyboard sidebar, site selection, map teardown, import/export provenance and failed ray jobs. Review desktop and narrow screenshots plus console errors before retiring an old route.
- **Pilot exit criterion:** old and new route produce equivalent project/manifest semantics and truthful status labels, no regression on the measured baseline, and the target team can extend the new screen without duplicating state or Python API policy. If any fail, keep Proposal 1 rather than forcing a framework rewrite.

## Sources

[1] https://2025.stateofjs.com/en-US/libraries/front-end-frameworks — State of JavaScript 2025: Front-end Frameworks
[2] https://vite.dev/guide — Vite: Getting Started
[3] https://react.dev/learn/creating-a-react-app — React: Creating a React App
[5] https://web.dev/articles/vitals — web.dev: Web Vitals
[6] https://svelte.dev/docs/kit/introduction — SvelteKit: Introduction
[7] https://nextjs.org/docs/app/guides/server-and-client-boundary — Next.js: Server and Client Boundary
[8] https://nuxt.com/docs/4.x/getting-started/introduction — Nuxt: Introduction
[9] https://angular.dev/overview — Angular: Overview
[10] https://flutter.dev/development/web — Flutter: Web
[13] https://www.w3.org/TR/WCAG22 — W3C: WCAG 2.2
