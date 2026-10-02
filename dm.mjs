// 4G/5G drive-measurement view-models. Demo numbers are illustrations, never RF results.
export const DM_METRICS = Object.freeze({
  rsrp:{label:'RSRP / SS-RSRP',category:'Signal power',unit:'dBm',key:'rsrpDbm',poor:-110,good:-95},
  rsrq:{label:'RSRQ / SS-RSRQ',category:'Signal quality',unit:'dB',key:'rsrqDb',poor:-15,good:-10},
  sinr:{label:'SINR / SS-SINR',category:'Signal quality',unit:'dB',key:'sinrDb',poor:0,good:13},
  dl:{label:'DL throughput',category:'Downlink throughput',unit:'Mbps',key:'dlMbps',poor:5,good:20},
  ul:{label:'UL throughput',category:'Uplink throughput',unit:'Mbps',key:'ulMbps',poor:2,good:8},
});
const round=(x,d=1)=>Number(x.toFixed(d));
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));

export function makeDemoTrace(project,plan) {
  const samples=plan.samples.map((point,index)=>{
    const closest=project.sites.reduce((best,site)=>{
      const distance=Math.hypot(point.x-site.x,point.y-site.y);
      return distance<best.distance?{site,distance}:best;
    },{site:project.sites[0],distance:Infinity});
    const technology=index%12<8?'NR':'LTE';
    const demoShadow=index%19>=12 && index%19<=15 ? 20 : 0;
    const rsrpDbm=round(clamp(-76-closest.distance*.78-project.channel.blockage*.15-Math.sin(index*.7)*5-(technology==='NR'?2:0)-demoShadow,-140,-55));
    const sinrDb=round(clamp(23-closest.distance*.55-project.channel.blockage*.13+Math.cos(index*.9)*5-demoShadow*.8,-25,38));
    const rsrqDb=round(clamp(-7-closest.distance*.16-Math.sin(index*.5)*1.4,-25,-4));
    const servingCell=closest.site.cells[Math.floor(index/14)%closest.site.cells.length].id;
    const previous=index?plan.samples[index-1]:null;
    const previousSite=previous && project.sites.reduce((best,site)=>Math.hypot(previous.x-site.x,previous.y-site.y)<Math.hypot(previous.x-best.x,previous.y-best.y)?site:best,project.sites[0]);
    const previousCell=previousSite?.cells[Math.floor((index-1)/14)%previousSite.cells.length].id;
    const previousTechnology=index?((index-1)%12<8?'NR':'LTE'):null;
    const event=index>0 && servingCell!==previousCell?'handover':index>0 && previousTechnology!==technology?'rat-change':'';
    return {index,timeS:round(index*3.6,1),technology,servingCell,x:point.x,y:point.y,
      rsrpDbm,rsrqDb,sinrDb,dlMbps:round(clamp((sinrDb+12)*(technology==='NR'?4.2:1.9),0,350)),
      ulMbps:round(clamp((sinrDb+10)*(technology==='NR'?1.1:.58),0,90)),event,
      provenance:'illustrative-not-measured'};
  });
  return {source:'synthetic-demo',coordinateMode:'schematic',samples};
}

function readCsv(text) {
  if(typeof text!=='string' || text.length>1_000_000) throw new Error('CSV must be text smaller than 1 MB');
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(ch==='"') {
      if(quoted && text[i+1]==='"') { field+='"'; i++; }
      else if(!quoted && field==='') quoted=true;
      else if(quoted) quoted=false;
      else throw new Error('Invalid CSV quoting');
    } else if(ch===',' && !quoted) { row.push(field);field=''; }
    else if(ch==='\n' && !quoted) { row.push(field.replace(/\r$/,''));if(row.some(v=>v.trim())) rows.push(row);row=[];field=''; }
    else if(ch==='\r' && !quoted) { if(text[i+1]!=='\n') throw new Error('Invalid CSV line ending'); }
    else field+=ch;
    if(rows.length>5001) throw new Error('CSV exceeds 5,000 samples');
  }
  if(quoted) throw new Error('Unterminated CSV quote');
  row.push(field.replace(/\r$/,''));if(row.some(v=>v.trim())) rows.push(row);
  return rows;
}
export const DM_CSV_FIELDS = Object.freeze({
  time_s: { label: 'Elapsed time', units: ['s', 'ms'], required: true },
  technology: { label: 'Radio technology', units: [null], required: true },
  serving_cell: { label: 'Serving cell', units: [null], required: true },
  latitude: { label: 'Latitude', units: ['degrees'], required: true },
  longitude: { label: 'Longitude', units: ['degrees'], required: true },
  rsrp_dbm: { label: 'RSRP / SS-RSRP', units: ['dBm'], required: false },
  rsrq_db: { label: 'RSRQ / SS-RSRQ', units: ['dB'], required: false },
  sinr_db: { label: 'SINR / SS-SINR', units: ['dB'], required: false },
  dl_mbps: { label: 'DL throughput', units: ['Mbps', 'kbps', 'bps'], required: false },
  ul_mbps: { label: 'UL throughput', units: ['Mbps', 'kbps', 'bps'], required: false },
  event: { label: 'Event annotation', units: [null], required: false },
  x_pct: { label: 'Schematic X', units: ['percent'], required: false },
  y_pct: { label: 'Schematic Y', units: ['percent'], required: false },
});
function csvHeader(rows) {
  if (!rows.length) throw new Error('DM CSV requires a header');
  const header = rows[0].map((h, i) => (i === 0 ? h.replace(/^\uFEFF/, '') : h).trim());
  if (new Set(header).size !== header.length) throw new Error('Duplicate DM CSV columns');
  if (header.length > 512 || header.some(h => !h || h.length > 120 || /[\x00-\x1f]/.test(h))) throw new Error('CSV requires 1–512 nonempty column names of at most 120 characters');
  return header;
}
export function inspectDmCsv(text) {
  const rows = readCsv(text), headers = csvHeader(rows);
  return { headers, rowCount: rows.length - 1, mapping: Object.fromEntries(Object.entries(DM_CSV_FIELDS)
    .map(([field, spec]) => [field, { column: headers.includes(field) ? field : null, unit: spec.units[0] }])) };
}
export function validateDmCsvMapping(mapping, headers) {
  if (!mapping || Object.keys(mapping).length !== Object.keys(DM_CSV_FIELDS).length || Object.keys(mapping).some(k => !Object.hasOwn(DM_CSV_FIELDS, k))) throw new Error('Invalid CSV field mapping');
  const used = new Set();
  for (const [field, spec] of Object.entries(DM_CSV_FIELDS)) {
    const entry = mapping[field];
    if (!entry || Object.keys(entry).length !== 2 || !Object.hasOwn(entry, 'column') || !Object.hasOwn(entry, 'unit')
      || !spec.units.includes(entry.unit)) throw new Error(`Invalid unit or mapping for ${field}`);
    if (entry.column !== null) {
      if (typeof entry.column !== 'string' || !headers.includes(entry.column)) throw new Error(`Unknown source column for ${field}`);
      if (used.has(entry.column)) throw new Error(`Source column ${entry.column} is mapped more than once`);
      used.add(entry.column);
    }
  }
}
function numberField(record,name,min,max,row,factor=1,nullable=false) {
  const raw=record[name]?.trim();
  if(nullable && (raw == null || ['', 'NA', 'N/A', 'NULL'].includes(raw.toUpperCase()))) return null;
  if(!raw || !/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) throw new Error(`Row ${row}: invalid ${name}`);
  const value=Number(raw)*factor;
  if(!Number.isFinite(value)||value<min||value>max) throw new Error(`Row ${row}: ${name} outside ${min}–${max}`);
  return value;
}
export function parseDmCsv(text,{mapping}={}) {
  const rows=readCsv(text);
  const header=csvHeader(rows); rows.shift();
  mapping = mapping ?? Object.fromEntries(Object.entries(DM_CSV_FIELDS).map(([field,spec]) => [field,{column:header.includes(field)?field:null,unit:spec.units[0]}]));
  validateDmCsvMapping(mapping,header);
  const required=['time_s','technology','serving_cell'];
  const missing=required.filter(k=>mapping[k].column === null);
  if(missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);
  const schematic=['x_pct','y_pct'].every(k=>mapping[k].column !== null);
  const gps=['latitude','longitude'].every(k=>mapping[k].column !== null);
  if(!schematic && !gps) throw new Error('Missing columns: x_pct/y_pct or latitude/longitude');
  if(rows.length<2) throw new Error('DM CSV requires at least two samples');
  if(rows.length>5000) throw new Error('CSV exceeds 5,000 samples');
  const samples=rows.map((values,i)=>{
    const row=i+2;
    if(values.length!==header.length) throw new Error(`Row ${row}: column count mismatch`);
    const source=Object.fromEntries(header.map((k,j)=>[k,values[j]]));
    const r=Object.fromEntries(Object.entries(mapping).map(([k,entry])=>[k,entry.column===null?undefined:source[entry.column]]));
    const technology=({LTE:'LTE','4G':'LTE',NR:'NR','5G':'NR'})[r.technology?.trim().toUpperCase()];
    if(!technology) throw new Error(`Row ${row}: technology must be LTE/4G or NR/5G`);
    const servingCell=r.serving_cell?.trim();
    if(!/^[A-Za-z0-9._:/-]{1,60}$/.test(servingCell)) throw new Error(`Row ${row}: invalid serving_cell`);
    const event=(r.event||'').trim();
    if(event.length>60 || /[<>\u0000-\u001f]/.test(event)) throw new Error(`Row ${row}: invalid event`);
    const factor = key => ({ ms: .001, kbps: .001, bps: .000001 }[mapping[key].unit] ?? 1);
    return {index:i,timeS:numberField(r,'time_s',0,604800,row,factor('time_s')),technology,servingCell,
      x:schematic?numberField(r,'x_pct',0,100,row):null,
      y:schematic?numberField(r,'y_pct',0,100,row):null,
      ...(gps?{latitude:numberField(r,'latitude',-90,90,row),longitude:numberField(r,'longitude',-180,180,row)}:{}),
      rsrpDbm:numberField(r,'rsrp_dbm',-160,-40,row,1,true),rsrqDb:numberField(r,'rsrq_db',-40,0,row,1,true),
      sinrDb:numberField(r,'sinr_db',-30,60,row,1,true),dlMbps:numberField(r,'dl_mbps',0,10000,row,factor('dl_mbps'),true),
      ulMbps:numberField(r,'ul_mbps',0,10000,row,factor('ul_mbps'),true),event,provenance:'imported-unverified'};
  });
  for(let i=1;i<samples.length;i++) if(samples[i].timeS<samples[i-1].timeS) throw new Error(`Row ${i+2}: time_s must be nondecreasing`);
  if(!schematic) {
    const lats=samples.map(s=>s.latitude),lons=samples.map(s=>s.longitude);
    const loLat=Math.min(...lats),hiLat=Math.max(...lats),loLon=Math.min(...lons),hiLon=Math.max(...lons);
    for(const sample of samples) {
      sample.x=round(10+80*(sample.longitude-loLon)/(hiLon-loLon||1),2);
      sample.y=round(90-80*(sample.latitude-loLat)/(hiLat-loLat||1),2);
    }
  }
  return {schemaVersion:2,source:'imported-unverified',coordinateMode:schematic?'schematic':'gps-normalized-schematic',mapping:structuredClone(mapping),samples};
}
function percentile(values,p) {
  const sorted=[...values].sort((a,b)=>a-b);
  const at=(sorted.length-1)*p,low=Math.floor(at),high=Math.ceil(at);
  return round(sorted[low]+(sorted[high]-sorted[low])*(at-low),1);
}
export function analyzeDmTrace(samples,{technology='ALL',metric='rsrp'}={}) {
  if(!Object.hasOwn(DM_METRICS,metric)) throw new Error('Unknown DM metric');
  if(!['ALL','LTE','NR'].includes(technology)) throw new Error('Unknown radio technology');
  const spec=DM_METRICS[metric], filtered=samples.filter(s=>technology==='ALL'||s.technology===technology);
  const values=filtered.map(s=>s[spec.key]).filter(Number.isFinite),weakZones=[];
  let open=null,weakCount=0;
  for(const sample of filtered) {
    if(Number.isFinite(sample[spec.key]) && sample[spec.key]<spec.poor) {
      weakCount++;
      if(!open || sample.index!==open.end+1) {open={start:sample.index,end:sample.index};weakZones.push(open);}
      else open.end=sample.index;
    } else open=null;
  }
  const events=filtered.filter(s=>s.event);
  return {metric,technology,filtered,sampleCount:filtered.length,validCount:values.length,missingCount:filtered.length-values.length,
    techCounts:{LTE:filtered.filter(s=>s.technology==='LTE').length,NR:filtered.filter(s=>s.technology==='NR').length},
    average:values.length?round(values.reduce((a,b)=>a+b,0)/values.length):null,
    p10:values.length?percentile(values,.1):null,p90:values.length?percentile(values,.9):null,
    weakCount,weakPercent:values.length?round(100*weakCount/values.length):null,weakZones,
    cellChangeCount:filtered.filter((s,i)=>i>0 && s.index===filtered[i-1].index+1 && s.servingCell!==filtered[i-1].servingCell).length,
    handoverCount:events.filter(s=>/^(handover|ho)(\b|:|-)/i.test(s.event)).length,events,
    thresholds:{poor:spec.poor,good:spec.good,unit:spec.unit}};
}

export function buildDmAnalysisReport(trace,{technology='ALL',metric='rsrp',filename=''}={}) {
  const stats=analyzeDmTrace(trace.samples,{technology,metric});
  const {filtered,events,...summary}=stats;
  return {schemaVersion:1,kind:'4G-5G-DM-ANALYSIS',source:trace.source,
    provenance:trace.source==='synthetic-demo'?'illustrative-not-measured':'imported-unverified',
    filename:filename||null,coordinateMode:trace.coordinateMode,filters:{technology,metric},
    ...(trace.evidence ? {dataset:Object.fromEntries(Object.entries(trace.evidence).filter(([key])=>key!=='rawCsv'))} : {}),
    ...(trace.cellIdentity ? {cellIdentity:structuredClone(trace.cellIdentity)} : {}),
    summary,events:events.map(s=>({sampleIndex:s.index,timeS:s.timeS,technology:s.technology,servingCell:s.servingCell,event:s.event})),
    note:'UI-only analysis. No Sionna-RT execution, verified 4G/5G measurement, or network acceptance verdict is implied.'};
}
