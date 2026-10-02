/** Declared public-PLMN cell inventory. Never infers operator ownership or RF compatibility. */
const keys = ['schemaVersion', 'technology', 'mcc', 'mnc', 'cellId', 'pci', 'arfcn', 'carrierName', 'sourceReference', 'source', 'verification'];
const draftKeys = ['technology', 'mcc', 'mnc', 'cellId', 'pci', 'arfcn', 'carrierName', 'sourceReference'];
const limits = { NR: { cellId: 68719476735, pci: 1007, arfcn: 3279165 }, LTE: { cellId: 268435455, pci: 503, arfcn: 262143 } };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const siteRat = (site, rat) => site?.radio?.technology === '4G LTE + 5G NR' || site?.radio?.technology === (rat === 'NR' ? '5G NR' : '4G LTE');
const text = (value, max) => value === null || (typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= max);

export function globalCellIdentityKey(identity) {
  return identity?.mcc != null && identity?.mnc != null && identity?.cellId != null
    ? JSON.stringify([identity.technology, identity.mcc, identity.mnc, identity.cellId]) : null;
}

export function validateInventoryIdentities(sites) {
  if (sites === undefined) return [];
  if (!Array.isArray(sites)) return ['Invalid cell identity inventory'];
  const errors = [], seen = new Set();
  for (const site of sites) {
    if (!object(site) || !Array.isArray(site.cells)) { errors.push('Invalid cell identity inventory'); continue; }
    for (const cell of site.cells) {
      if (!object(cell)) { errors.push('Invalid cell identity inventory'); continue; }
      if (!Object.hasOwn(cell, 'inventoryIdentity')) continue;
      const identity = cell.inventoryIdentity, invalid = () => errors.push(`Invalid cell identity for ${cell.id}`);
      if (!object(identity) || Object.keys(identity).length !== keys.length || keys.some(key => !Object.hasOwn(identity, key))
        || identity.schemaVersion !== 1 || typeof identity.technology !== 'string' || !Object.hasOwn(limits, identity.technology) || identity.source !== 'manual' || identity.verification !== 'unverified') { invalid(); continue; }
      const bound = limits[identity.technology];
      if ((identity.mcc !== null && (typeof identity.mcc !== 'string' || !/^\d{3}$/.test(identity.mcc)))
        || (identity.mnc !== null && (typeof identity.mnc !== 'string' || !/^\d{2,3}$/.test(identity.mnc)))
        || ((identity.mcc === null) !== (identity.mnc === null))
        || (identity.cellId !== null && (typeof identity.cellId !== 'string' || !/^(0|[1-9]\d*)$/.test(identity.cellId) || Number(identity.cellId) > bound.cellId))
        || ['pci', 'arfcn'].some(key => identity[key] !== null && (!Number.isInteger(identity[key]) || identity[key] < 0 || identity[key] > bound[key]))
        || !text(identity.carrierName, 80) || !text(identity.sourceReference, 160)) { invalid(); continue; }
      if (!siteRat(site, identity.technology)) errors.push(`Cell identity technology does not match site ${site.id}`);
      const key = globalCellIdentityKey(identity);
      if (key !== null && seen.has(key)) errors.push(`Duplicate global cell identity for ${cell.id}`);
      if (key !== null) seen.add(key);
    }
  }
  return errors;
}

export function normalizeInventoryIdentity(draft) {
  if (!object(draft) || Object.keys(draft).some(key => !draftKeys.includes(key))) throw new Error('Invalid cell identity declaration');
  if (typeof draft.technology !== 'string' || !Object.hasOwn(limits, draft.technology)) throw new Error('Choose the cell radio technology');
  const optionalText = (key, max) => {
    const value = draft[key];
    if (value == null || value === '') return null;
    if (typeof value !== 'string') throw new Error(`Invalid ${key} in cell identity`);
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > max) throw new Error(`${key} is too long`);
    return trimmed;
  };
  const integer = (key, allowHex = false) => {
    const value = draft[key];
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const raw = typeof value === 'number' && Number.isInteger(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
    if (!/^\d+$/.test(raw) && !(allowHex && /^0x[0-9a-f]+$/i.test(raw))) throw new Error(`Invalid ${key} in cell identity`);
    const number = Number(raw);
    if (!Number.isSafeInteger(number) || number < 0 || number > limits[draft.technology][key]) throw new Error(`${key} outside ${draft.technology} identity range`);
    return allowHex ? String(number) : number;
  };
  const identity = { schemaVersion: 1, technology: draft.technology, mcc: optionalText('mcc', 3), mnc: optionalText('mnc', 3),
    cellId: integer('cellId', true), pci: integer('pci'), arfcn: integer('arfcn'), carrierName: optionalText('carrierName', 80), sourceReference: optionalText('sourceReference', 160), source: 'manual', verification: 'unverified' };
  const errors = validateInventoryIdentities([{ id: 'declaration', radio: { technology: '4G LTE + 5G NR' }, cells: [{ id: 'declaration', inventoryIdentity: identity }] }]);
  if (errors.length) throw new Error('Invalid cell identity: MCC needs 3 digits and MNC needs 2 or 3 digits; enter both or leave both blank');
  return identity;
}

export function inventoryIdentityLabel(identity) {
  if (!identity) return 'Identity not declared';
  const local = identity.cellId === null ? 'cell ID unset' : `0x${Number(identity.cellId).toString(16).toUpperCase().padStart(identity.technology === 'NR' ? 9 : 7, '0')}`;
  if (identity.mcc === null || identity.cellId === null) return `${identity.technology} · ${local} · ${identity.mcc === null ? 'PLMN unset' : `${identity.mcc}-${identity.mnc}`}`;
  return `${identity.technology === 'NR' ? 'NCGI' : 'ECGI'} ${identity.mcc}-${identity.mnc}-${local}`;
}
