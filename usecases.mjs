export const ROUTES = Object.freeze({
  'downtown-loop': { name: 'Downtown loop', points: [{ x: 18, y: 25 },{ x: 31, y: 35 },{ x: 65, y: 27 },{ x: 76, y: 54 },{ x: 54, y: 71 },{ x: 28, y: 62 },{ x: 18, y: 25 }] },
  'river-corridor': { name: 'River corridor', points: [{ x: 12, y: 73 },{ x: 26, y: 65 },{ x: 44, y: 67 },{ x: 62, y: 72 },{ x: 84, y: 82 }] },
  'station-to-campus': { name: 'Station to campus', points: [{ x: 11, y: 32 },{ x: 29, y: 37 },{ x: 50, y: 51 },{ x: 71, y: 46 },{ x: 86, y: 25 }] },
});
export const DATA_TASKS = Object.freeze({
  'channel-prediction': { name: 'Channel prediction', requiredMode: 'EM', features: ['scene_id','tx_cell_id','ue_position_xyz','carrier_ghz','antenna_config','material_id'], labels: ['channel_cir','path_gain_db'] },
  'handover-prediction': { name: 'Handover prediction', requiredMode: 'EM+RAN', features: ['scene_id','ue_trace_id','serving_cell_id','neighbor_cell_id','rsrp_history_dbm','sinr_history_db'], labels: ['handover_success','time_to_trigger_ms'] },
  'scheduler-optimization': { name: 'Scheduler optimization', requiredMode: 'EM+RAN', features: ['scene_id','cell_id','ue_load','cqi','buffer_state','radio_config'], labels: ['throughput_mbps','latency_ms'] },
});

export function defaultUseCases() {
  return {
    drive: { route: 'downtown-loop', samples: 48, speedKph: 30, ueMode: 'single-software-ue' },
    ab: { packageA: 'RAN-BASELINE-A', packageB: 'RAN-CANDIDATE-B', seeds: [42,43,44], trafficProfile: 'matched-current-ue-load', guardrailDropPct: 5, minSinrGainDb: 1 },
    data: { task: 'channel-prediction', sceneVariants: 12, seeds: [11,22,33], sampleBudget: 10000, split: { train: 70, validation: 15, test: 15 }, outputFormat: 'parquet' },
  };
}

function validSeeds(seeds) { return Array.isArray(seeds) && seeds.length >= 1 && seeds.length <= 16 && seeds.every(v => Number.isSafeInteger(v) && v >= 0 && v <= 2147483647) && new Set(seeds).size === seeds.length; }
export function validateUseCases(config) {
  const e = [];
  if (!config || !config.drive || !config.ab || !config.data) return ['Use-case configuration missing'];
  const { drive, ab, data } = config;
  if (!Object.hasOwn(ROUTES, drive.route)) e.push('Unknown virtual drive route');
  if (!Number.isInteger(drive.samples) || drive.samples < 8 || drive.samples > 500) e.push('Drive sample count must be 8–500');
  if (!Number.isFinite(drive.speedKph) || drive.speedKph < 1 || drive.speedKph > 130) e.push('Drive speed must be 1–130 km/h');
  if (drive.ueMode !== 'single-software-ue') e.push('Only a single software UE is supported in this drive plan');
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(ab.packageA || '') || !/^[A-Za-z0-9._-]{1,40}$/.test(ab.packageB || '')) e.push('Package IDs must be simple identifiers');
  if (ab.packageA === ab.packageB) e.push('A/B package IDs must be distinct');
  if (!validSeeds(ab.seeds)) e.push('A/B seeds must be unique bounded integers');
  if (ab.trafficProfile !== 'matched-current-ue-load') e.push('A/B traffic must remain matched');
  if (!Number.isFinite(ab.guardrailDropPct) || ab.guardrailDropPct < 0 || ab.guardrailDropPct > 50) e.push('Guardrail drop must be 0–50%');
  if (!Number.isFinite(ab.minSinrGainDb) || ab.minSinrGainDb < -20 || ab.minSinrGainDb > 20) e.push('Minimum SINR gain must be -20–20 dB');
  if (!Object.hasOwn(DATA_TASKS, data.task)) e.push('Unknown AI-RAN data task');
  if (!Number.isInteger(data.sceneVariants) || data.sceneVariants < 1 || data.sceneVariants > 100) e.push('Scene variants must be 1–100');
  if (!validSeeds(data.seeds)) e.push('Data seeds must be unique bounded integers');
  if (!Number.isInteger(data.sampleBudget) || data.sampleBudget < 100 || data.sampleBudget > 1000000) e.push('Sample budget must be 100–1,000,000');
  const split = data.split;
  if (!split || !['train','validation','test'].every(k => Number.isInteger(split[k]) && split[k] >= 5 && split[k] <= 90) || split.train + split.validation + split.test !== 100) e.push('Train/validation/test splits must each be 5–90 and sum to 100');
  if (data.outputFormat !== 'parquet') e.push('Only Parquet output is planned');
  return e;
}

export function drivePlan(project) {
  const cfg = project.useCases.drive, route = ROUTES[cfg.route];
  const segments = route.points.slice(1).map((point,i) => Math.hypot(point.x - route.points[i].x, point.y - route.points[i].y));
  const total = segments.reduce((sum,d) => sum+d, 0);
  const samples = Array.from({ length: cfg.samples }, (_, i) => {
    let remaining = total * i / (cfg.samples - 1);
    for (let j=0; j<segments.length; j++) {
      if (remaining <= segments[j] || j===segments.length-1) {
        const t = segments[j] ? Math.min(1,remaining/segments[j]) : 0;
        const a = route.points[j], b = route.points[j+1];
        return { x: Math.round((a.x+(b.x-a.x)*t)*100)/100, y: Math.round((a.y+(b.y-a.y)*t)*100)/100 };
      }
      remaining -= segments[j];
    }
  });
  return { status:'not-executed', route: { id:cfg.route, name:route.name, points:route.points }, samples,
    ueMode:cfg.ueMode, speedKph:cfg.speedKph, requestedMetrics:['RSRP','SINR','throughput','handover events'],
    measurements:null, requiredMode:'EM+RAN for throughput and handover; EM-only for channel/path gain',
    caveat:'Coordinates are schematic canvas percentages, not georeferenced driving positions.' };
}

export function abPlan(project) {
  const cfg = project.useCases.ab;
  const pairs = project.sites.flatMap(site => cfg.seeds.map(seed => ({
    pairId:`${site.id}-S${seed}`, a:{siteId:site.id,seed,packageId:cfg.packageA,trafficProfile:cfg.trafficProfile},
    b:{siteId:site.id,seed,packageId:cfg.packageB,trafficProfile:cfg.trafficProfile},
  })));
  return { status:'not-executed', pairs, commonInputs:['same scene/materials','same sites/cells and antenna pattern','same UE traces and seed','same traffic load','same RF/channel realization'],
    primaryMetrics:['cell-edge throughput','RSRP/SINR','handover success','latency'],
    guardrails:{maximumAllowedThroughputDropPercent:cfg.guardrailDropPct, minimumSINRGainDb:cfg.minSinrGainDb},
    verdict:null, caveat:'A/B requires the same verified environment and paired runs; no package was executed.' };
}

export function datasetPlan(project) {
  const cfg=project.useCases.data, task=DATA_TASKS[cfg.task], budget=cfg.sampleBudget;
  const train=Math.floor(budget*cfg.split.train/100), validation=Math.floor(budget*cfg.split.validation/100);
  return { status:'not-executed', task:cfg.task, requiredMode:task.requiredMode,
    requestedColumns:{features:[...task.features],labels:[...task.labels]}, labels:[...task.labels],
    sceneVariants:cfg.sceneVariants, seeds:[...cfg.seeds], plannedRows:budget, generatedRows:0,
    plannedSplitRows:{train,validation,test:budget-train-validation}, outputFormat:cfg.outputFormat,
    leakageRule:'Split by scene/route/seed group before any sample-level splitting; no shared channel realizations across splits.',
    provenanceFields:['project_manifest_id','scene_hash','material_hash','antenna_hash','RAN_package_id','sim_mode','seed','run_id'],
    caveat:'Schema and budget only. No generated samples or ground-truth labels exist until backend simulation and validation.' };
}

export function buildUseCasePlanSpec(project, type) {
  const planner = { drive: drivePlan, ab: abPlan, data: datasetPlan };
  if (!Object.hasOwn(planner, type)) throw new Error(`Unknown use-case plan: ${type}`);
  return { schemaVersion:1, mode:'PLANNING_ONLY', useCase:type, city:project.map.city,
    cluster:project.map.cluster, config:project.useCases[type], plan:planner[type](project),
    note:'Not executed. No RF measurements, A/B verdict or training samples were generated.' };
}
