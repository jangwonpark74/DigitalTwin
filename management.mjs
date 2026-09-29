const poolIds=['GH-POOL-01','GH-POOL-02','GH-POOL-03','GH-POOL-04'];
function defaultTopology() {
  return {
    vduServerCount:null, switchPortCount:null,
    gh200Pools:poolIds.map((id,i)=>({id,alias:`GH200 pool ${i+1}`,plannedServers:6,discovery:'not-discovered'})),
    links:[
      {id:'ETH-VDU-FABRIC',from:'vdu-pool',to:'ethernet-switch',medium:'Ethernet',status:'unverified'},
      ...poolIds.map((id,i)=>({id:`ETH-FABRIC-P${i+1}`,from:'ethernet-switch',to:id,medium:'Ethernet',status:'unverified'})),
    ],
  };
}
export function defaultManagement() {
  return {
    hardware: [
      {id:'vdu-pool',name:'Real vDU server pool',role:'Physical distributed-unit compute upstream of the virtual RU',alias:'vDU pool target',discovery:'not-discovered'},
      {id:'host-gh200', name:'GH200 GPU server pools', role:'Four planned pools · up to six servers each', alias:'GH200 target', discovery:'not-discovered'},
      {id:'gpu-h200', name:'NVIDIA H200 GPU', role:'Sionna-RT / channel workload target', alias:'H200 target', discovery:'not-discovered'},
      {id:'cpu-grace', name:'Grace CPU', role:'Software-based virtual UE runtime', alias:'Grace CPU target', discovery:'not-discovered'},
      {id:'ethernet-switch',name:'Ethernet switch fabric',role:'Interconnect from real vDU pool to GH200 server pools',alias:'Ethernet switch target',discovery:'not-discovered'},
      {id:'fronthaul', name:'RAN fronthaul interface', role:'Real vDU ↔ virtual O-RAN RU integration target', alias:'Fronthaul target', discovery:'not-discovered'},
    ],
    topology:defaultTopology(),
    software: [
      {id:'sionna-rt',name:'Sionna-RT',layer:'Radio channel',targetVersion:'unassigned',installation:'not-verified'},
      {id:'virtual-ru',name:'Virtual O-RAN RU',layer:'Virtual RAN',targetVersion:'unassigned',installation:'not-verified'},
      {id:'antenna-mmu',name:'Virtual Antenna / MMU',layer:'RF front end',targetVersion:'unassigned',installation:'not-verified'},
      {id:'software-ue',name:'Software UE',layer:'Grace CPU',targetVersion:'unassigned',installation:'not-verified'},
      {id:'ran-package-a',name:'RAN package A',layer:'A/B experiment',targetVersion:'unassigned',installation:'not-verified'},
      {id:'ran-package-b',name:'RAN package B',layer:'A/B experiment',targetVersion:'unassigned',installation:'not-verified'},
    ],
    monitoring: {connected:false,lastSample:null,thresholds:{gpuUtilizationPct:85,gpuMemoryPct:90,cpuUtilizationPct:80,fronthaulLatencyMs:10}},
  };
}
const hardwareIds=['vdu-pool','host-gh200','gpu-h200','cpu-grace','ethernet-switch','fronthaul'];
const softwareIds=['sionna-rt','virtual-ru','antenna-mmu','software-ue','ran-package-a','ran-package-b'];
const validAlias=x=>typeof x==='string'&&!!x.trim()&&x.length<=80;

// Bring pre-topology local projects forward without discarding configured aliases/versions.
export function upgradeManagement(previous) {
  const next=defaultManagement();
  if(!previous || typeof previous!=='object') return next;
  for(const item of next.hardware) {
    const prior=Array.isArray(previous.hardware)&&previous.hardware.find(x=>x?.id===item.id);
    if(prior && Object.hasOwn(prior,'alias')) item.alias=prior.alias;
  }
  for(const item of next.software) {
    const prior=Array.isArray(previous.software)&&previous.software.find(x=>x?.id===item.id);
    if(prior && Object.hasOwn(prior,'targetVersion')) item.targetVersion=prior.targetVersion;
  }
  if(previous.monitoring?.thresholds) Object.assign(next.monitoring.thresholds,previous.monitoring.thresholds);
  const old=previous.topology;
  if(old && typeof old==='object') {
    if(Object.hasOwn(old,'vduServerCount')) next.topology.vduServerCount=old.vduServerCount;
    if(Object.hasOwn(old,'switchPortCount')) next.topology.switchPortCount=old.switchPortCount;
    for(const pool of next.topology.gh200Pools) {
      const prior=Array.isArray(old.gh200Pools)&&old.gh200Pools.find(x=>x?.id===pool.id);
      if(prior) {pool.alias=prior.alias;pool.plannedServers=prior.plannedServers;}
    }
  }
  return next;
}
export function validateManagement(m) {
  if(!m || !Array.isArray(m.hardware) || !Array.isArray(m.software) || !m.monitoring) return ['Twin management configuration missing'];
  const errors=[];
  if(m.hardware.length!==hardwareIds.length || m.hardware.some((item,i)=>item?.id!==hardwareIds[i])) errors.push('Hardware target inventory mismatch');
  if(m.software.length!==softwareIds.length || m.software.some((item,i)=>item?.id!==softwareIds[i])) errors.push('Software target inventory mismatch');
  for(const item of m.hardware) {
    if(!validAlias(item?.alias)) errors.push(`Invalid hardware alias for ${item?.id}`);
    if(item?.discovery!=='not-discovered') errors.push(`Hardware ${item?.id} cannot claim discovery`);
  }
  for(const item of m.software) {
    if(typeof item?.targetVersion!=='string' || !/^[A-Za-z0-9._+-]{1,40}$/.test(item.targetVersion)) errors.push(`Invalid target version for ${item?.id}`);
    if(item?.installation!=='not-verified') errors.push(`Software ${item?.id} cannot claim installation`);
  }
  if(m.monitoring.connected!==false || m.monitoring.lastSample!==null) errors.push('Monitoring cannot claim live telemetry');
  const limits={gpuUtilizationPct:[1,100],gpuMemoryPct:[1,100],cpuUtilizationPct:[1,100],fronthaulLatencyMs:[1,500]};
  for(const [key,[min,max]] of Object.entries(limits)) {
    const value=m.monitoring.thresholds?.[key];
    if(!Number.isFinite(value)||value<min||value>max) errors.push(`Invalid monitoring threshold ${key}`);
  }
  const t=m.topology, expected=defaultTopology();
  if(!t || !Array.isArray(t.gh200Pools) || !Array.isArray(t.links)) return [...errors,'Hardware topology configuration missing'];
  if(t.gh200Pools.length!==4 || t.gh200Pools.some((pool,i)=>pool?.id!==poolIds[i])) errors.push('Hardware topology needs exactly four GH200 pools');
  if(t.vduServerCount!==null && (!Number.isInteger(t.vduServerCount)||t.vduServerCount<1||t.vduServerCount>64)) errors.push('vDU planned server count must be 1–64 or TBD');
  if(t.switchPortCount!==null && (!Number.isInteger(t.switchPortCount)||t.switchPortCount<1||t.switchPortCount>512)) errors.push('Ethernet switch target ports must be 1–512 or TBD');
  for(const pool of t.gh200Pools) {
    if(!validAlias(pool?.alias)) errors.push(`Invalid GH200 pool alias for ${pool?.id}`);
    if(!Number.isInteger(pool?.plannedServers)||pool.plannedServers<0||pool.plannedServers>6) errors.push(`GH200 pool ${pool?.id} supports up to six planned servers`);
    if(pool?.discovery!=='not-discovered') errors.push(`GH200 pool ${pool?.id} cannot claim discovery`);
  }
  if(t.links.length!==5 || t.links.some((link,i)=>link?.id!==expected.links[i]?.id || link.from!==expected.links[i].from || link.to!==expected.links[i].to || link.medium!=='Ethernet')) errors.push('Fronthaul Ethernet link topology mismatch');
  if(t.links.some(link=>link?.status!=='unverified')) errors.push('Fronthaul links cannot claim physical connectivity');
  return errors;
}
export function sanitizeManagement(m) {
  const safe=upgradeManagement(m);
  for(const item of safe.hardware) item.discovery='not-discovered';
  for(const item of safe.software) item.installation='not-verified';
  for(const pool of safe.topology.gh200Pools) pool.discovery='not-discovered';
  for(const link of safe.topology.links) link.status='unverified';
  safe.monitoring.connected=false; safe.monitoring.lastSample=null;
  return safe;
}
export function topologySummary(m) {
  const pools=m.topology.gh200Pools;
  return {poolCount:pools.length,plannedGh200Servers:pools.reduce((sum,p)=>sum+p.plannedServers,0),maximumGh200Servers:24,
    discoveredGh200Servers:0,vduServerCount:m.topology.vduServerCount,switchPortCount:m.topology.switchPortCount,
    unverifiedLinks:m.topology.links.length,verifiedLinks:0};
}
export function managementSnapshot(m) {
  const labels={gpuUtilizationPct:'H200 GPU utilization',gpuMemoryPct:'H200 memory utilization',cpuUtilizationPct:'Grace CPU utilization',fronthaulLatencyMs:'vDU ↔ virtual RU latency'};
  return {connected:false,source:'not-configured',lastSample:null,
    hardwareCount:m.hardware.length,softwareCount:m.software.length,topology:topologySummary(m),
    signals:Object.entries(labels).map(([id,label])=>({id,label,threshold:m.monitoring.thresholds[id],unit:id.endsWith('Ms')?'ms':'%',value:null,status:'no-data'}))};
}
