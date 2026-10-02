import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { AppController } from '../../app/AppController';
import { inventoryIdentityLabel } from '../../../network-cell-identity.mjs';
import { saveInventoryIdentity } from './inventoryIdentityCommands';
import { inventoryIdentityToken, type InventoryIdentity, type InventoryIdentityDraft } from './inventoryIdentityTypes';

type Entry = { expected: string; fields: InventoryIdentityDraft; error?: string };
const from = (identity?: InventoryIdentity): Entry => ({ expected: inventoryIdentityToken(identity), fields: {
  technology: identity?.technology ?? '', mcc: identity?.mcc ?? '', mnc: identity?.mnc ?? '', cellId: identity?.cellId ?? '',
  pci: identity?.pci == null ? '' : String(identity.pci), arfcn: identity?.arfcn == null ? '' : String(identity.arfcn),
  carrierName: identity?.carrierName ?? '', sourceReference: identity?.sourceReference ?? '',
} });

export default function CellInventoryEditor({ controller, projectId, site, cell, hidden }: {
  controller: AppController; projectId: string; site: { id: string; radio: { technology: string } };
  cell: { id: string; inventoryIdentity?: InventoryIdentity }; hidden?: boolean;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [drafts, setDrafts] = useState<Record<string, Entry>>({}), [notices, setNotices] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false);
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const key = `${projectId}:${cell.id}`, draft = drafts[key] ?? from(cell.inventoryIdentity);
  const stale = draft.expected !== inventoryIdentityToken(cell.inventoryIdentity);
  const changed = JSON.stringify(draft.fields) !== JSON.stringify(from(cell.inventoryIdentity).fields);
  const locked = busy || snapshot.status !== 'ready' || snapshot.dirty;
  const forget = (id: string) => setDrafts(previous => { const next = { ...previous }; delete next[id]; return next; });
  const reset = () => { forget(key); setNotices(previous => ({ ...previous, [key]: '' })); };
  const change = (field: keyof InventoryIdentityDraft, value: string) => {
    setDrafts(previous => ({ ...previous, [key]: { ...draft, error: '', fields: { ...draft.fields, [field]: value } } }));
    setNotices(previous => ({ ...previous, [key]: '' }));
  };
  const save = async (clear = false) => {
    if (pending.current || locked) return;
    pending.current = true; setBusy(true); setNotices(previous => ({ ...previous, [key]: '' }));
    try {
      await saveInventoryIdentity(controller, projectId, cell.id, draft.expected, clear ? null : draft.fields);
      if (mounted.current) { forget(key); setNotices(previous => ({ ...previous, [key]: `${cell.id} declaration ${clear ? 'cleared' : 'saved'}` })); }
    } catch (cause) {
      if (mounted.current) setDrafts(previous => ({ ...previous, [key]: { ...draft, error: cause instanceof Error ? cause.message : String(cause) } }));
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const input = (label: string, field: Exclude<keyof InventoryIdentityDraft, 'technology'>, maximum?: number) =>
    <label>{label}<input aria-label={label} value={draft.fields[field]} maxLength={maximum} inputMode={['mcc', 'mnc', 'pci', 'arfcn'].includes(field) ? 'numeric' : undefined}
      onChange={event => change(field, event.target.value)} /></label>;
  return <section hidden={hidden} className="sp-cell-inventory" aria-label="Cell identity and carrier declaration">
    <details><summary><strong>Cell identity and carrier</strong><span>{inventoryIdentityLabel(cell.inventoryIdentity)}</span></summary>
      <p className="site-planner-note">Optional manual declaration · unverified. Save the complete group after editing. Blank values remain unspecified.</p>
      {changed && <p className="site-planner-note" aria-live="polite">Unsaved cell declaration</p>}
      <form noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={locked}><legend>{cell.id}</legend><div className="site-planner-fields">
          <label>Cell RAT<select aria-label="Cell RAT" value={draft.fields.technology} onChange={event => change('technology', event.target.value)}>
            <option value="">Choose LTE or NR</option>{site.radio.technology !== '5G NR' && <option value="LTE">LTE</option>}{site.radio.technology !== '4G LTE' && <option value="NR">5G NR</option>}
          </select></label>
          <div className="sp-plmn-fields">{input('MCC', 'mcc', 3)}{input('MNC', 'mnc', 3)}</div>
          {input('Local cell ID (NCI / ECI)', 'cellId', 30)}
          <p className="site-planner-note">Decimal or 0x hexadecimal. PLMN needs both MCC and MNC; leading zeros are retained.</p>
          <div className="sp-channel-fields">{input('PCI', 'pci', 8)}{input('Channel number (NR-ARFCN / EARFCN)', 'arfcn', 10)}</div>
          {input('Carrier label', 'carrierName', 80)}{input('Source reference', 'sourceReference', 160)}
        </div></fieldset>
        {stale && <p className="site-planner-note">The current declaration changed. Reset this draft before saving.</p>}
        {draft.error && <p role="alert" className="sp-inventory-error">{draft.error}</p>}
        {notices[key] && <p role="status">{notices[key]}</p>}
        <div className="sp-inspector-actions"><button type="submit" className="button primary" disabled={locked || stale}>Save cell declaration</button>
          <button type="button" className="button outline" disabled={busy} onClick={reset}>Reset declaration draft</button>
          {cell.inventoryIdentity && <button type="button" className="button outline" disabled={locked || stale} onClick={() => void save(true)}>Clear declaration</button>}</div>
      </form>
      <p className="site-planner-note">Channel numbers describe inventory. Band validity, frequency alignment and carrier configuration need separate verification.</p>
    </details>
  </section>;
}
