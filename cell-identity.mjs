const sourceId = /^[A-Za-z0-9._:/-]{1,60}$/;
const internalId = /^SITE-\d{2,4}-C[1-3]$/;
export const cellIdentityKey = (technology, sourceCell) => JSON.stringify([technology, sourceCell]);
export const cellSupportsTechnology = (site, technology, cell) => ['LTE', 'NR'].includes(technology)
  && (site?.radio?.technology === '4G LTE + 5G NR' || site?.radio?.technology === (technology === 'NR' ? '5G NR' : '4G LTE'))
  && (!cell?.inventoryIdentity || cell.inventoryIdentity.technology === technology);

/** Associations interpret an opaque source ID within this capture and RAT only. */
export function validateCellIdentity(trace) {
  if (!Object.hasOwn(trace ?? {}, 'cellIdentity')) return [];
  const identity = trace.cellIdentity, observed = new Set((trace.samples ?? []).map(sample => cellIdentityKey(sample?.technology, sample?.servingCell)));
  if (!identity || Object.keys(identity).length !== 3 || identity.schemaVersion !== 1 || identity.method !== 'manual-review'
    || !Array.isArray(identity.bindings) || identity.bindings.length > 5000) return ['Invalid measurement cell identity interpretation'];
  const seen = new Set();
  for (const item of identity.bindings) {
    const key = cellIdentityKey(item?.technology, item?.sourceCell);
    if (!item || Object.keys(item).length !== 3 || !['LTE', 'NR'].includes(item.technology)
      || typeof item.sourceCell !== 'string' || !sourceId.test(item.sourceCell) || !observed.has(key) || seen.has(key)
      || (item.targetCellId !== null && (typeof item.targetCellId !== 'string' || !internalId.test(item.targetCellId)))) return ['Invalid or duplicate measurement cell identity association'];
    seen.add(key);
  }
  return [];
}

export function resolveMeasurementCell(trace, sites, sample) {
  const binding = trace?.cellIdentity?.bindings.find(item => item.technology === sample.technology && item.sourceCell === sample.servingCell);
  const target = binding ? binding.targetCellId : sample.servingCell;
  const matches = (sites ?? []).flatMap(site => (site.cells ?? []).filter(cell => cell.id === target).map(cell => ({ site, cell })));
  const base = { sourceCell: sample.servingCell, technology: sample.technology, cellId: null, siteId: null, targetCellId: target };
  if (target === null || (!binding && !matches.length)) return { ...base, status: 'unresolved' };
  if (!matches.length) return { ...base, status: 'missing-cell' };
  if (matches.length > 1) return { ...base, status: 'ambiguous' };
  if (!cellSupportsTechnology(matches[0].site, sample.technology, matches[0].cell)) return { ...base, status: 'technology-mismatch' };
  return { ...base, cellId: matches[0].cell.id, siteId: matches[0].site.id, status: binding ? 'reviewed' : 'exact-id' };
}

export function cellIdentityRows(trace, sites) {
  const rows = new Map();
  for (const sample of trace?.samples ?? []) {
    const key = cellIdentityKey(sample.technology, sample.servingCell);
    if (!rows.has(key)) rows.set(key, { key, ...resolveMeasurementCell(trace, sites, sample), count: 0 });
    rows.get(key).count++;
  }
  return [...rows.values()].sort((a, b) => a.technology.localeCompare(b.technology) || a.sourceCell.localeCompare(b.sourceCell));
}

export function prepareCellIdentity(trace, sites, bindings) {
  if (!trace?.samples) throw new Error('A saved measurement dataset is required');
  const next = structuredClone(trace);
  next.cellIdentity = { schemaVersion: 1, method: 'manual-review', bindings: structuredClone(bindings) };
  const errors = validateCellIdentity(next); if (errors.length) throw new Error(errors[0]);
  for (const item of bindings) {
    if (item.targetCellId === null) continue;
    const resolution = resolveMeasurementCell(next, sites, { technology: item.technology, servingCell: item.sourceCell });
    if (resolution.status === 'technology-mismatch') throw new Error('Target cell radio technology does not match the source observation');
    if (resolution.status !== 'reviewed') throw new Error('Target cell must resolve uniquely in the project inventory');
  }
  next.cellIdentity.bindings.sort((a, b) => a.technology.localeCompare(b.technology) || a.sourceCell.localeCompare(b.sourceCell));
  return next;
}
