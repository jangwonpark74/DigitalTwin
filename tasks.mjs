function localDatePlus(anchor, days) {
  const day=new Date(Date.UTC(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()+days));
  return day.toISOString().slice(0,10);
}
export function defaultTasks(anchor=new Date()) {
  const specs=[
    ['OSM geometry & coordinates','scene',1,[]],
    ['RF material calibration','scene',3,['T-01']],
    ['Virtual RU / antenna site-cell review','ran',4,['T-02']],
    ['Real vCore / vDU interface verification','integration',5,[]],
    ['Virtual drive test evidence gate','drive',7,['T-02','T-03','T-04']],
    ['Paired package A/B execution plan','ab',9,['T-05']],
    ['AI-RAN dataset build & leakage review','data',11,['T-05']],
  ];
  return specs.map(([title,category,days,dependsOn],i)=>({id:`T-${String(i+1).padStart(2,'0')}`,title,category,
    dueDate:localDatePlus(anchor,days),dependsOn:[...dependsOn],priority:i<4?'high':'normal',status:'planned',execution:'not-executed'}));
}
const dateValid=value=> typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function validateTasks(items) {
  if(!Array.isArray(items) || items.length>100) return ['Task list must be an array with at most 100 entries'];
  const errors=[], ids=new Set(items.map(x=>x?.id));
  if(ids.size!==items.length) errors.push('Duplicate task IDs');
  const byId=new Map(items.map(x=>[x?.id,x]));
  for(const item of items) {
    if(!item || typeof item.id!=='string' || !/^T-\d{2,3}$/.test(item.id)) { errors.push('Invalid task ID'); continue; }
    if(typeof item.title!=='string'|| !item.title.trim() || item.title.length>120) errors.push(`Invalid title for ${item.id}`);
    if(!['scene','ran','integration','drive','ab','data','custom'].includes(item.category)) errors.push(`Invalid category for ${item.id}`);
    if(!['low','normal','high'].includes(item.priority)) errors.push(`Invalid priority for ${item.id}`);
    if(item.status!=='planned' || item.execution!=='not-executed') errors.push(`Task ${item.id} cannot claim execution`);
    if(!dateValid(item.dueDate)) errors.push(`Invalid due date for ${item.id}`);
    if(!Array.isArray(item.dependsOn) || new Set(item.dependsOn).size!==item.dependsOn.length) { errors.push(`Invalid dependency list for ${item.id}`); continue; }
    for(const dependency of item.dependsOn) {
      if(!byId.has(dependency)) errors.push(`Unknown dependency ${dependency} for ${item.id}`);
      else if(dateValid(item.dueDate) && dateValid(byId.get(dependency).dueDate) && byId.get(dependency).dueDate>item.dueDate) errors.push(`Task ${item.id} scheduled before dependency ${dependency}`);
    }
  }
  const visiting=new Set(), visited=new Set();
  function visit(id) {
    if(visiting.has(id)) { errors.push(`Task dependency cycle at ${id}`); return; }
    if(visited.has(id)) return;
    visiting.add(id);
    for(const dep of byId.get(id)?.dependsOn || []) if(byId.has(dep)) visit(dep);
    visiting.delete(id); visited.add(id);
  }
  for(const id of byId.keys()) visit(id);
  return errors;
}
export function addPlannedTask(items,spec) {
  const next=structuredClone(items);
  const id=`T-${String(Math.max(0,...items.map(x=>Number(x.id.slice(2))||0))+1).padStart(2,'0')}`;
  next.push({id,title:spec.title?.trim(),category:spec.category||'custom',priority:spec.priority||'normal',
    dueDate:spec.dueDate,dependsOn:[...(spec.dependsOn||[])],status:'planned',execution:'not-executed'});
  const errors=validateTasks(next); if(errors.length) throw new Error(errors[0]);
  return next;
}
export function rescheduleTask(items,id,dueDate) {
  const next=structuredClone(items), task=next.find(x=>x.id===id);
  if(!task) throw new Error(`Unknown task ${id}`);
  task.dueDate=dueDate;
  const errors=validateTasks(next); if(errors.length) throw new Error(errors[0]);
  return next;
}
export function schedulePlan(items) {
  const errors=validateTasks(items); if(errors.length) throw new Error(errors[0]);
  return items.map(x=>({...x,blockers:[...x.dependsOn],execution:'not-executed'}))
    .sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id));
}
