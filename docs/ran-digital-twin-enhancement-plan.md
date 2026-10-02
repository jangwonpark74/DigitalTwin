# 5G RAN digital twin workflow and UI UX enhancement plan

**Draft for product and engineering review · 2 October 2026**

## Product direction

Keep the current MapLibre visualization foundation and reorganize the product around an RF engineer's decisions: establish a trustworthy network baseline, identify a problem, test a proposed change, compare evidence, and hand off a reviewed recommendation. A recognizable 3D city and colored measurements are useful tools within that process. The product needs a consistent connection between physical network records, observations, models, simulation runs, and decisions.

The first release should complete an **offline radio planning and measurement validation workflow**. Connected network monitoring and controlled network changes should follow as separate capabilities. This sequence preserves the value of today's working maps and local ray tracing while making the meaning and operational limits of each result explicit.

This plan records the software review before enhancement implementation. The assessment and source spans below describe that snapshot, including the preceding map and planner improvements. Implementation is underway; see the [implementation status](ran-enhancement-implementation.md) for delivered behavior, current verification and remaining work. Live SKT connectivity, radio calibration and production deployment remain unverified.

**Primary user:** RAN planning and optimization engineer. **Supporting users:** RF simulation engineer, experiment reviewer, operations analyst, and platform administrator. These personas are a proposed prioritization based on the current Gangnam site and drive-test work; validate them with representative users before committing the delivery schedule.

## Current software assessment

At the review snapshot, the application had 18 registered routes. The sidebar separated Workspace, Use Cases, System, Tasks and Schedule, and Activity. Those categories explained implementation features more clearly than they explained how to complete a network engineering task. Capabilities and observed gaps at that point are summarized below; the proposed actions are design recommendations.

| Current surface | Observed behavior | Enhancement needed |
| --- | --- | --- |
| Navigation | Nine different pages appear in Workspace; Drive, A/B, and datasets sit in another group. | Organize around the engineering lifecycle and make the next task discoverable. |
| Mission control | The project map now shares geographic context with other map views. The launchpad still leads through scene, tasks, GH200 targets, and monitoring preparation. | Lead through evidence import, baseline assessment, scenario evaluation, and result review. Select the next action from actual capability checks. |
| Spatial views | City Map, Site and Cell Planner, Ray Tracing Lab, and Mission Control reuse the open map and shared map session. | Retain this investment. Give the views consistent layer names, selection behavior, source indicators, and links to the same dataset and scenario. |
| Site and radio editing | Site and cell geometry, sector RF fields, radio metadata, and GPS inputs are distributed between two planners. | Provide one Sites and Cells workspace with Summary, Position, RF, Antenna, and Topology tabs. Preserve advanced access without duplicate editors. |
| Drive analysis | GPS imports can be saved into project drive measurements. The Drive page still owns a separate session and defaults to a synthetic trace when that session has no imported trace; its analysis map uses normalized schematic coordinates. | Load the saved dataset by ID, reuse the geographic map, and synchronize measurement filters and the selected sample with map views. Separate measurement analysis from virtual route planning. |
| KPI evidence | Overview coverage and capacity figures are illustrative formulas. CSV samples are tagged imported and unverified. | Make provenance visible beside every KPI. Replace engineering headline values with observed or explicitly modeled results when available; show unavailable values otherwise. |
| Readiness | The model's geometry, materials, antenna, runtime, and integration checks remain false; the lab separately checks prerequisites for a local RT job. | Use evidence-driven checks per action. Distinguish a renderable scene, an executable EM job, a calibrated model, and connected operations. |
| Experiments and jobs | Local RT submissions and saved run records exist. Package A/B, AI-RAN datasets, tasks, and dates largely define plans. | Create a common experiment and job workspace that distinguishes plans from executions and links actual runs to input snapshots. |
| Network model | Validation requires three sectors per site, at most 50 sites, and a GH200/H200/Grace target profile. | Preserve limits during migration, then introduce versioned schemas, capability-based runtime profiles, and real site/cell identity relationships. |
| Design documentation | Existing documents still describe Cesium and older schematic navigation, and the use-case contract omits newer measurement analysis. | Publish a current workflow specification and mark historical design descriptions as superseded before implementation. |

**Retain:** the MapLibre renderer, source attribution, 2D/3D controls, visible site overlays, 1.5 m drive-trace display, searchable planner, sector compass, keyboard controls, project isolation, revision conflict handling, local RT job path, and explicit synthetic/unverified labels. Improve the workflow around these components rather than replacing the visualization library.

## Main engineering scenario

Use the existing Nonhyeon-dong, Teheran-ro, and Gangnam example as the first complete demonstration. Its registered SKT positions and synthetic street KPIs are suitable for testing interactions, not for accepting real network performance or calibrating a physical network.

| Step | Engineer action | Saved output and handoff |
| --- | --- | --- |
| 1 Define the study | Select project, area, operator, RAT, carrier, study objective, and assessment window. | Study definition with agreed KPI definitions, thresholds, and scope. |
| 2 Import evidence | Import site/cell inventory, geometry, antenna information, and drive-test or network observations. Resolve field and identity mappings. | Versioned datasets and an import quality report; unresolved records remain visible. |
| 3 Establish the baseline | Review site placement, cell topology, geometry assumptions, materials, reference signals, and observation freshness. | Immutable baseline snapshot with completeness and uncertainty indicators. |
| 4 Identify and explain a problem | Select a weak street segment, inspect serving/neighbor cells and measured trends, and inspect propagation paths where supported. | Issue record linked to sample IDs, map extent, dataset version, and baseline. |
| 5 Calibrate where evidence permits | Align observations and modeled metrics, fit permitted parameters using a training subset, and evaluate on held-out routes or spatial groups. | Versioned calibration model and residual report. Synthetic or unsuitable observations cannot produce an accepted physical calibration. |
| 6 Design a candidate | Branch a scenario and change sector tilt, power, azimuth, antenna profile, site placement, or carrier configuration. Define traffic and mobility when needed. | Candidate scenario with a precise change list; the baseline is unchanged. |
| 7 Execute and compare | Run supported propagation or RAN experiments against frozen inputs. Compare baseline and candidate under equivalent conditions. | Run records, spatial KPI differences, uncertainty, affected cells, and pass/fail/inconclusive assessment against declared criteria. |
| 8 Review and follow up | Review improvements and regressions, export the recommendation and evidence, and specify a follow-up measurement. | Review record and reproducible report. Connected monitoring or a network change requires separately implemented operational capabilities. |

The main interaction sequence is **Import evidence → Establish baseline → Diagnose → Create scenario → Run → Compare → Review**. Task scheduling supports that sequence; it does not determine the engineering workflow.

Additional scenario templates should reuse the same objects and evidence flow:

- **New site planning:** compare candidate locations and sector layouts using the same study area and calibrated propagation assumptions.
- **Mobility troubleshooting:** correlate serving-cell changes, recorded handover events, interference, and route segments; avoid treating a cell change alone as proof of a successful handover.
- **Software package comparison:** hold topology, traffic, seeds, observation window, and resource profile constant across A/B arms.
- **Energy saving:** assess modeled or observed energy against coverage and service constraints; do not infer energy savings from a site being hidden or disabled in the display.
- **AI-RAN research:** generate or curate a versioned dataset, define grouping and leakage controls, and evaluate a model against an independent test set.

Network planning, site optimization, testing automation, energy saving, and AI/ML evaluation are also identified as DT-RAN use cases in the [O-RAN research report](https://www.o-ran.org/research-reports/digital-twin-ran-use-cases). The workflow and release order above are this plan's product recommendations, not a claim of O-RAN compliance.

## Proposed menu organization

Use six lifecycle sections in the main sidebar, with the current project and scenario always visible. Expand the active section by default. Put the project switcher above navigation and platform administration below it. Role presets may shorten the menu, but should retain a discoverable All Workspaces entry.

| Main section | Pages or tabs | Main user decision |
| --- | --- | --- |
| Overview | Study overview; readiness and next action; recent results | What needs attention and what can I do next? |
| Data and Twin Setup | Data sources; imports and quality; geometry and materials; network topology | Is the baseline evidence complete and suitable for this study? |
| Network Design | Spatial workbench; Sites and Cells; scenario editor | Which network configuration am I evaluating or changing? |
| Simulation and Experiments | Propagation; mobility and traffic; experiment templates; jobs and runs | What should execute, with which inputs and capabilities? |
| Validation and Optimization | Drive-test analysis; calibration; baseline comparison; optimization candidates | Does the model explain observations and does the candidate improve the objective? |
| Operations and Reports | Observation timeline; review and recommendations; reports and artifacts; work plan | What was reviewed, what is observable, and what should happen next? |

**Platform settings**, a utility entry, contains connections, runtime resources, software packages, and access settings. Hardware-specific terms belong in runtime details. They should not be compulsory navigation steps for an RF engineer importing observations or inspecting a map.

Operations pages must expose capability status explicitly. A preparation-only monitoring page should be labeled **Monitoring setup**. A planned date remains in **Work plan**. Only an executing job service or a connected collector can populate execution or telemetry states.

### Migration of current routes

| Current route and label | Proposed destination | Migration behavior |
| --- | --- | --- |
| `overview` Mission control | Overview | Replace the fixed preparation launchpad with study progress and a context-specific next action. |
| `projects` Projects | Global project switcher and project library | Keep lifecycle operations and isolated project data. |
| `map` City map | Network Design → Spatial workbench | Retain the shared renderer and geographic state. |
| `planner` Site and cell planner | Network Design → Sites and Cells | Default to site inventory, sector editor, and map. |
| `radio` Radio planner | Sites and Cells → RF and Position tabs | Keep existing deep links as aliases; assign one canonical editor to each field. |
| `stack` RAN topology | Data and Twin Setup → Network topology | Link logical nodes to physical sites and cells. |
| `ray` Ray tracing lab | Simulation and Experiments → Propagation | Preserve path inspection and solver options; launch against a scenario snapshot. |
| `ues` Virtual UE fleet | Simulation and Experiments → Mobility and traffic | Reuse UE profiles in scenarios and experiments. |
| `drive` Virtual drive test | Validation → Drive-test analysis; Simulation → Mobility route planning | Split analysis and planning into explicit modes; retain old route aliases. |
| `ab` Package A/B test | Simulation and Experiments → Software comparison | Keep paired-arm controls and link results to Validation. |
| `data` AI-RAN data generation | Simulation and Experiments → AI-RAN research | Separate dataset specification, actual generation jobs, and evaluation evidence. |
| `hardware` Hardware inventory | Platform settings → Runtime resources | Separate target metadata from discovered capacity. |
| `software` Software management | Platform settings → Software packages | Distinguish requested, available, installed, and verified versions. |
| `monitoring` Monitoring | Operations → Observation timeline; Platform → Connections | Show setup until collectors supply timestamped observations. |
| `tasks` Task board | Operations and Reports → Work plan | Preserve dependencies; link tasks to studies, issues, and experiments. |
| `schedule` Schedule | Work plan → Calendar tab | Planned dates and actual job scheduling remain separate. |
| `artifacts` Project artifacts | Operations and Reports → Reports and artifacts | Preserve file access; add input versions, run relationships, and provenance. |
| `activity` Activity | Operations and Reports → Event timeline | Separate edits, jobs, observations, and reviews with filters. |

Introduce this hierarchy using navigation metadata and aliases first. Consolidate underlying screens incrementally after routing and selection contracts are stable. Avoid one large rewrite of all 18 routes.

## Consistent screen operation

### Study overview

Show the study objective, baseline revision, active scenario, dataset freshness, open issues, and latest supported result. The main action should be the next feasible step, such as Import site inventory, Resolve three unmatched cells, Run baseline propagation, or Compare completed runs. Each blocked action should name the missing input and link to its correction.

Observed KPIs, simulated KPIs, and illustrative demonstration values must remain separate. A completed local EM job is useful evidence, but it does not establish an accepted network model or connected RAN readiness.

### Spatial workbench

Use a stable layout: optional layer/inventory panel on the left, dominant map in the center, selected-object inspector on the right, and a collapsible measurement timeline below. Mode tabs select Design, Measurements, Coverage, and Paths without recreating the entire user's spatial context.

Synchronize site, sector, dataset, sample, KPI, RAT, carrier, time range, and map extent through common view state. The recent shared map session is a starting point; the separate Drive session still needs integration. Save camera and layer preferences separately from engineering inputs. Switching projects must restore or reset only that project's context.

Map markers, tables, charts, and event lists should select the same object. A keyboard-accessible site list remains available when labels overlap. Label decluttering and zoom-dependent detail should supplement, rather than hide, the selected site. Unknown geographic positions stay in the inventory with a placement action; they must not appear as invented street locations.

Keep imported GPS tracks at the current **1.5 m above ground** display height. Label the current flat-ground assumption. A future terrain-aware implementation must store the vertical datum and distinguish ground-relative antenna/receiver height from absolute altitude. Road snapping may create a separate derived route, but must preserve original samples and displacement information.

### Data import and quality

Provide one import wizard: choose source → map columns and units → declare origin → validate → resolve identifiers → preview geographic extent → save dataset. List accepted, rejected, missing, duplicate, and unmatched records before committing. Preserve the raw file, its digest, source date, import date, coordinate reference, and transformation history.

Support partial KPI columns through an explicit versioned schema. Missing SINR or throughput should stay unavailable; never populate them with zero or a synthetic substitute. Keep today's strict validation until the new importer and migration have complete acceptance coverage. Unknown metric semantics may be displayed with a clear label but must block incompatible model comparisons.

### Sites and Cells

Keep the new searchable list, enlarged map, sector compass, and responsive editor. Combine radio metadata and geometry editing into one inspector with basic and advanced tabs. Prefer WGS84 coordinates and map placement to normalized percentages for real network work. Keep normalized coordinates only for legacy examples or an explicitly marked schematic mode.

Show source, verification date, positional uncertainty, height origin, and unresolved cell mappings. A registered radio facility position is not sufficient evidence of an exact antenna mounting point, live sector configuration, or current cell identity. Provide batch import and reviewable batch changes after the canonical data model exists.

### Scenario editor and experiment jobs

Keep a read-only baseline beside the candidate change list. Basic controls should expose the engineering action and units. Put beam/array and solver details in the selected sector's advanced inspector; do not restore a large Configure Beam form over the map.

Before execution, show the frozen input revision, compatible engine, geometry and antenna checks, run budget, and requested output. Allow local supported jobs to run without asserting connected RAN readiness. For unsupported capabilities, show the unmet prerequisite and a usable preparation path.

A job record must preserve its type, inputs, engine/version, resource profile, timestamps, status, logs, outputs, and failure reason. Start, cancel, retry, and clone should be available only where the backend actually supports them. Retrying creates a linked run record instead of replacing previous evidence.

### Results and recommendations

Present synchronized baseline/candidate maps, comparable color scales, spatial differences, distributions, affected cells, and measurement-versus-model residuals. Explain which samples were matched, excluded, or outside the modeled area. Use the same KPI definition and observation/traffic assumptions for both arms.

Coverage should identify its denominator: study grid area, sampled street length, or observation sample count. These are different metrics. Do not summarize imported street samples as city-wide coverage. Show target thresholds as named, versioned operator/study profiles rather than universal green/amber/red defaults.

Export the study objective, baseline and candidate versions, change list, dataset sources, calibration status, run evidence, tradeoffs, and review outcome. An inconclusive result is a valid outcome when evidence or comparability is insufficient.

## Required RAN and evidence model

Introduce these objects incrementally rather than treating the whole mutable project as every input and output.

| Object | Required relationships and fields |
| --- | --- |
| Study | Project, area, operator, objective, assessment window, RAT/carrier scope, and named acceptance policy. |
| Network snapshot | Source/version, site and cell inventory, logical topology, timestamps, and immutable physical configuration. |
| Site and cell | Stable internal ID plus external identity mapping; PLMN and NCI/NCGI where supplied; gNB/CU/DU/RU relationships; carrier, NR-ARFCN, PCI, antenna and position metadata. Do not use PCI alone as a unique network identity. |
| Geometry and antenna model | Geometry revision, coordinate and vertical references, material assumptions, antenna pattern/version, and quality flags. |
| Measurement dataset | Raw artifact/digest, declared origin, independent verification status, acquisition and import times, device and reference-signal context, nullable KPIs, and serving/neighbor identity mappings. |
| Calibration model | Input dataset and model versions, allowed fitted parameters, held-out grouping policy, residual metrics, uncertainty, and acceptance scope. |
| Scenario | Baseline snapshot reference plus a versioned set of proposed changes, traffic/mobility assumptions, and author/review history. |
| Experiment and run | Objective, comparable A/B arms where applicable, input digests, engine/version, seed, capability profile, logs, and output artifact references. |
| Issue and recommendation | Linked route segment/cells, evidence, affected KPI, proposed change, run comparisons, reviewer, and follow-up requirement. |

Keep **origin**, **verification**, and **execution status** independent. An imported synthetic CSV remains synthetic. A successful solver run remains simulated. A schema-valid dataset may still be unverified. A calibrated result is accepted only for its documented area, time, frequency, and modeling assumptions.

The longer-term synchronization architecture should separate source adapters, versioned canonical datasets, physical/configuration snapshots, model engines, experiment execution, and the review UI. Physical observations update a new baseline version; they must not silently overwrite an active experiment. This is a proposed architecture consistent with the data/model/interface relationship described by [ITU-T Y.3090](https://www.itu.int/itu-t/recommendations/rec.aspx?rec=14852).

### Propagation and RAN modeling boundaries

Sionna documents distinct path and radio-map solvers; a path display is not a coverage map. Extend the existing single-link workflow to route sampling and multi-transmitter radio maps with explicit receiver height, antenna orientation, frequency, and convergence checks. [Sionna RT introduction](https://nvlabs.github.io/sionna/rt/tutorials/Introduction.html).

The product must also define how EM outputs become NR measurement predictions. Require an explicit SS/CSI reference-signal type, transmit-power allocation, bandwidth, beam/antenna context, interference assumptions, and noise model. Received signal strength must not be relabeled as NR RSRP without that mapping. SS-RSRP, CSI-RSRP, SS-SINR, and CSI-SINR are distinct named measurements in [3GPP TS 38.215, Release 18](https://www.etsi.org/deliver/etsi_ts/138200_138299/138215/18.03.00_60/ts_138215v180300p.pdf).

Throughput, latency, scheduler behavior, and handover outcomes require a declared link/system/RAN model or observations. They cannot be accepted as results of drawing beam paths. Open street geometry is visual context until a separately versioned geometry/material validation process qualifies it as solver input.

## Capability and validation gates

Use action-specific gates and report why each passes, fails, or is unknown. Keep current conservative behavior for unsupported capabilities; replace hardcoded placeholders only when evidence-backed checks exist.

| Capability | Minimum evidence | Allowed operation |
| --- | --- | --- |
| Geographic review | Usable coordinates, declared reference system, and visible source/quality flags | Inspect sites and tracks, including unverified observations. |
| Baseline propagation | Valid imported solver geometry, usable antenna/position inputs, compatible runtime, bounded options, and saved input snapshot | Execute the supported EM job; label output simulated and uncalibrated as applicable. |
| Physical calibration | Suitable nonsynthetic observations, compatible KPI semantics, identity/time/space alignment, declared fitting parameters, and held-out evaluation | Fit and evaluate a calibration model. Acceptance remains scoped to its evidence. |
| Scenario comparison | Comparable baseline/candidate inputs, same metric definition and study denominator, and completed relevant runs | Review improvement, regression, or inconclusive outcomes. |
| Connected observation | Authenticated read adapter, source identity, collection interval, timestamps, quality and stale-data policy | Display network observations with collection health and freshness. |
| Network change | Separately validated integration, permission model, exact change diff, impact review, approval, monitoring, and rollback support | Execute a controlled change through a supported external adapter. |

Implement connected observation in a read-only shadow mode first. O1-oriented management/PM integrations, vendor inventory APIs, and E2-based observability/control should be separate adapter projects with compatibility tests for the target deployment. The proposal does not assume these interfaces already exist in this application or in the user's network.

## UI UX enhancement backlog

P0 establishes a coherent workflow and trustworthy evidence presentation. P1 enables useful engineering comparisons. P2 introduces connected or specialized capabilities. Owners are proposed responsibilities, not assigned staff.

| ID and priority | Enhancement | Proposed owner | Acceptance evidence |
| --- | --- | --- | --- |
| UX01 P0 | Lifecycle navigation with one route/navigation registry, aliases, active-section expansion, and role presets | Product and frontend | All 18 current routes have a destination; bookmarks and keyboard/mobile navigation still work. |
| UX02 P0 | Persistent project, baseline, scenario, dataset, and save context | Frontend | Context survives workflow transitions; project switching never leaks selections or writes into another project. |
| UX03 P0 | Common geographic workbench and one measurement selection/filter contract | Frontend and data | Import in either location, reopen Drive, and select a sample in map/chart/table; every view shows the same dataset and sample. |
| UX04 P0 | Unified import wizard and explicit origin/quality presentation | Data and RF | Raw artifact preserved; unknown identifiers and missing KPIs remain visible; synthetic imports cannot become measured evidence. |
| UX05 P0 | Action-specific readiness and next-step guidance | Backend and RF | A valid local EM study can run while connected operations remain unavailable; each blocked action links to its missing prerequisite. |
| UX06 P0 | Consistent editing, units, and recovery feedback | Frontend | Inline field errors, saving/saved/failed states, preserved drafts on conflict, and one canonical editor per engineering field. |
| UX07 P1 | Consolidated Sites and Cells inspector and realistic identity model | RF and backend | Sector, carrier, position, antenna, and topology edits refer to the same objects; schema migration preserves existing projects. |
| UX08 P1 | Immutable baseline and candidate scenario editor | Backend and frontend | Candidate edits leave the baseline unchanged; reviewers see the exact field-level change list and input versions. |
| UX09 P1 | Jobs and results linked to frozen inputs | Simulation and backend | Completed and failed runs preserve inputs, logs, versions, artifacts, and links; changing configuration marks affected results stale. |
| UX10 P1 | Calibration and aligned comparison workspace | RF and simulation | Matched/excluded observations, held-out evaluation, residuals, units, denominator, and comparable color scales are inspectable. |
| UX11 P1 | Reports and review outcomes | Product and frontend | A report reproduces the decision context and preserves source/model status; insufficient evidence yields an inconclusive result. |
| UX12 P0 | Readability, accessibility, and loading/error states | Design and frontend | Accessible contrast targets, visible focus, keyboard alternatives, reduced motion, legible units, and no horizontal overflow at 390 px. |
| UX13 P1 | Dense-map and large-dataset interaction | GIS and frontend | Selected sites remain readable; label decluttering, viewport filtering, and virtualized tables are validated on agreed pilot-scale data. |
| UX14 P2 | Connected observation with freshness and collection health | RAN integration | Authenticated read-only data have source timestamps, stale indicators, gap handling, and zero network configuration writes. |
| UX15 P2 | Controlled actions and specialized experiment templates | RAN integration and product | End-to-end adapter, review, approval, monitoring, and rollback evidence exists before any production-changing action is exposed. |

Accessibility implementation should be checked against the adopted product standard; automated checks and keyboard tests are necessary but do not replace manual usability review. The immediate visual target is readable 12–14 px secondary text, 14–16 px body text, clear selected-object emphasis, and controls sized appropriately for touch and dense desktop work. These are proposed design targets, not current conformance claims.

## Delivery phases and release criteria

The sequence below is a proposed dependency order. Calendar estimates require a confirmed team, data access, runtime availability, and pilot scope. Do not promise a connected digital twin release based on a menu redesign alone.

| Phase | Main deliverables | Dependencies | Exit criterion |
| --- | --- | --- | --- |
| 0 Validate the product journey | User walkthroughs, current documentation alignment, menu prototype, agreed vocabulary, study objective and KPI policy | Product owner and representative RF/operations users | Users can explain baseline → candidate → run → evidence; every existing route is mapped. |
| 1 Complete the offline workflow | New shell/navigation metadata, shared context, common dataset/cursor, unified importer, consolidated site editing entry, next-action guidance | Phase 0; versioned import and view-state contracts | Gangnam demonstration completes import → diagnosis → scenario preparation without duplicate imports, lost selections, or false measured claims. |
| 2 Deliver reproducible RF validation | Baseline/scenario snapshots, capability preflight, linked run/artifact model, route/multi-site propagation, calibration and comparison UI, reports | Suitable antenna/geometry inputs; compatible execution engines; actual observations for physical calibration | A real pilot dataset supports a reproducible baseline/candidate study with held-out validation and declared acceptance limits. |
| 3 Add connected observation | Read adapters, identity reconciliation, freshness/drift monitoring, collection health, observation timeline | Deployment-specific source access, authentication, retained evidence, and integration tests | The pilot runs in read-only shadow mode; source gaps and model drift are visible and no RAN configuration is changed. |
| 4 Add controlled optimization and advanced research | Supported change adapters, impact review, approval/rollback flow, energy and AI-RAN experiments | Phase 3 plus validated RAN/system models and operational ownership | A bounded nonproduction change can be reviewed, executed, observed, and reversed with a complete audit trail. |

Within Phase 1, deliver UX01, UX02, UX03, and UX04 first. Then implement UX05, UX06, and UX12. Start the versioned scenario/run architecture before multi-cell simulation, optimization automation, or additional 3D features.

### First implementation package

1. Add a typed workflow/navigation model beside the existing route registry; render sidebar groups from it and preserve route aliases.
2. Define a shared project study context, separate view preferences, and a canonical measurement dataset reference. Adapt DriveSession to saved project datasets and shared sample selection.
3. Replace the fixed launchpad with action-specific prerequisite cards. Move illustrative overview values into a clearly labeled demonstration panel.
4. Establish one import entry point with source declaration, quality preview, and explicit KPI/identity mapping. Link existing import buttons to it rather than duplicating parsing behavior.
5. Present Site and Cell and Radio editing through one workspace entry and tabs; preserve current validated command functions during the first migration.
6. Add a scenario draft/change-list model and acceptance fixtures. Keep baseline snapshots immutable before connecting job submissions to scenario versions.

This first package is a menu, context, data, and workflow change. It does not require replacing MapLibre or implementing live RAN control.

## Pilot validation and product measures

Use two fixtures: the Gangnam synthetic example for deterministic UX checks, and a separately sourced pilot measurement dataset for engineering validation. Passing the synthetic fixture does not establish calibration or network performance.

| Measure | Proposed acceptance target |
| --- | --- |
| Findability | At least 4 of 5 representative users locate import, scenario creation, and result comparison without assistance in a moderated pilot. |
| Primary task completion | At least 4 of 5 complete import → weak-zone review → candidate → comparison handoff with no critical task failure. Treat this small pilot as directional evidence. |
| Navigation efficiency | Measure current task time and route changes first; target at least 30% fewer unnecessary workspace transitions in the pilot workflow. |
| Evidence consistency | No duplicate import is needed to reuse a dataset; map/chart/table sample selection and filters agree across all relevant views. |
| Provenance comprehension | Users correctly distinguish synthetic, imported-unverified, simulated, accepted calibration, and observed network data in all tested decision tasks. |
| Reproducibility | Every compared result identifies baseline/scenario versions, dataset/model versions, engine/options, and required artifacts. |
| Model quality | RF owner defines KPI-specific error, bias, spatial coverage, and holdout criteria before fitting. Report MAE/RMSE and residual distributions where suitable; no universal accuracy number is assumed. |
| Stability and access | No critical console errors, draft loss, cross-project write, or unauthorized network change; keyboard access and 390 px overflow checks pass. |
| Performance | Establish a declared device/dataset baseline and measure p95 interaction and map readiness. Set budgets for cached data separately from public tile/network latency. |

Test missing coordinates, unknown cell identities, absent KPI columns, mixed LTE/NR measurements, SS/CSI mismatch, stale observations, synthetic-only input, unavailable runtime, tile failure/retry, interrupted runs, configuration changes after a run, and concurrent save conflicts. Retain the existing domain, component, integration, and browser checks as migration gates.

## Decisions needed before detailed estimation

- Which first pilot objective will be accepted: coverage improvement, weak-zone explanation, new site planning, or mobility troubleshooting?
- Which real inventory, antenna, drive-test, and observation sources are available, with what positional accuracy, timestamps, and identifiers?
- Which outputs must the first engine support: path inspection, route predictions, radio maps, or end-to-end RAN KPIs?
- What is the pilot scale in sites, cells, samples, study area, and concurrent runs? Today's 50-site and 5,000-sample limits need measured migration decisions.
- Which team owns calibration acceptance, runtime integration, operator review, and any eventual network change?

These decisions refine scope and estimates. They do not prevent Phase 0 prototyping or the first navigation/context improvements.

## Source evidence and review limits

The findings were traced through Graft and exact source spans in the current working tree. Existing design documents were reviewed as historical intent; current source behavior takes precedence where they disagree. Recent map and planner improvements are retained as implemented assets rather than proposed again.

| Finding | Current source evidence |
| --- | --- |
| Eighteen routes and current sidebar grouping | [routeRegistry.ts](../src/app/routeRegistry.ts), lines 2–21; [PreviewWorkspaceShell.tsx](../src/app/PreviewWorkspaceShell.tsx), lines 14–102. |
| Fixed preparation launchpad | [MissionControlLaunchpad.tsx](../src/features/mission-control/MissionControlLaunchpad.tsx), lines 9–31. |
| Shared geographic Mission Control map | [MissionControlPage.tsx](../src/features/mission-control/MissionControlPage.tsx), lines 29–58; [MissionControlProjectMap.tsx](../src/features/mission-control/MissionControlProjectMap.tsx), lines 14–59. |
| Independent Drive state, demo fallback, and schematic analysis | [DrivePreviewLeaf.tsx](../src/features/drive/DrivePreviewLeaf.tsx), lines 35–75 and 180–207; [DriveSession.ts](../src/features/drive/DriveSession.ts), lines 22–48 and 120–140. |
| Saved GPS measurements and CSV normalization | [driveCommands.ts](../src/features/drive/driveCommands.ts), lines 41–52; [dm.mjs](../dm.mjs), lines 64–105. |
| Illustrative headline metrics, model limits, and hardcoded readiness | [model.mjs](../model.mjs), lines 110–163, 189–199, and 236–246. |
| Existing local RT submission and saved run query path | [RayTracingPreviewLeaf.tsx](../src/features/ray-tracing/RayTracingPreviewLeaf.tsx), lines 135–170; [AppController.ts](../src/app/AppController.ts), lines 193–217 and 248–270. |
| Existing commercial planner design | [Desktop review image](design-review/planner-commercial/gangnam-2d-desktop.png); [mobile review image](design-review/planner-commercial/gangnam-mobile.png); [SitePlannerPreviewLeaf.tsx](../src/features/site-planner/SitePlannerPreviewLeaf.tsx). |
| Existing provenance and use-case boundaries | [SKT data-fetch method](skt-base-station-data-fetch.md); [use-case contracts](use-cases.md); [historical UI specification](uiux-design.md); [historical product review](ui-ux-product-review.md). |

External sources were checked on 2 October 2026. The referenced 3GPP document is a specifically identified Release 18 edition, not a claim that it is the latest release. Interface selection, product requirements, phases, and acceptance targets are this plan's proposals. The review is a source and workflow assessment, not a new live RAN or calibration test.
