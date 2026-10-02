# 5G RAN twin use cases — planning contracts

These are design-level planning flows. The browser does **not** acquire physical drive measurements, deploy RAN software or generate training rows. It can analyze imported GPS CSV evidence and execute supported local single-link Sionna-RT path jobs. The [enhancement plan](ran-digital-twin-enhancement-plan.md) and [implementation status](ran-enhancement-implementation.md) describe the current workflow.

## UC-01 — Virtual drive test

- **Actors:** RF planner, experiment operator.
- **Trigger:** a virtual route and UE behavior need specification for an existing cluster.
- **Inputs:** route waypoints on the schematic canvas, sample count, planned speed, chosen site/cell context and reproducibility seed.
- **Analysis flow:** open Drive → import a GPS CSV → declare origin/date → validate and review quality/extent → save → inspect the geographic trace, trends, events and sample table. City Map and Propagation reuse the same saved dataset, KPI/RAT filter and original sample selection. Imported data remain unverified; synthetic markers retain synthetic origin. The raw UTF-8 CSV, SHA-256 and source metadata are exported as project artifacts.
- **Route planning flow:** choose Route & simulation plan → edit route/parameters → inspect the schematic plan → export JSON. Route planning remains separate from measurement evidence and does not execute virtual UEs. Legacy percentage-coordinate CSVs stay transient in the Drive page.
- **Exceptions:** reject invalid sample count or malformed route and preserve previous state.
- **Backend requirements:** georeferenced scene, calibrated RF materials, Sionna-RT channel jobs, virtual RU/UE runtime, RSRP/SINR throughput/latency capture, run provenance and measured-vs-modeled comparison.
- **Acceptance:** deterministic route with bounded inputs and a visible *not executed* state; exported plan contains no fabricated measurement.

## UC-02 — Paired package A/B test

- **Actors:** RAN software operator, experiment reviewer.
- **Trigger:** compare two proposed packages against the same environment.
- **Inputs:** package A/B labels, paired seed set, scene and traffic profiles, guardrails and observation window.
- **Prototype flow:** enter two distinct packages → inspect paired matrix holding site, scene, traffic and seed constant → export plan. The mockup does not choose a winner.
- **Exceptions:** reject identical package labels, invalid seeds, or malformed guardrails.
- **Backend requirements:** authenticated package registry, deployments with rollback, matched UE cohorts, controlled randomization, audit log, baseline and guardrail metrics, stop rules, and statistical decision policy.
- **Acceptance:** every A arm has a matching B arm under identical experimental inputs; no success or metric is asserted without observed run artifacts.

## UC-03 — AI-RAN dataset generation

- **Actors:** RF engineer, ML dataset curator.
- **Trigger:** define channel-prediction or RAN-behavior training data needs.
- **Inputs:** task mode, scene variants, feature and label catalog, seed, grouping/split policy, planned output path.
- **Prototype flow:** choose task → inspect expected feature/label schema → edit leak-safe train/validation/test percentages and variants → export specification. Row count stays zero.
- **Exceptions:** reject invalid split sum, task/label mismatch or unsupported variant budget.
- **Backend requirements:** scene and RAN execution adapters, immutable data provenance, versioned Parquet artifacts, group-aware split by scene/site/seed/time, quality checks and governance review.
- **Acceptance:** schema distinguishes EM-only channel labels from RAN-dependent labels; export does not claim generation or training has occurred.

## Shared boundaries

Real vCore/vDU endpoints are metadata only; virtual O-RAN RU/antenna/MMU and software UE runtimes are targets. H200 ray tracing and Grace CPU UE execution require separate services with identity, resource control, logs, versions, and input/output artifact contracts. UI validation is not proof of hardware discovery, map readiness, network reachability, dataset creation or successful experiments.
