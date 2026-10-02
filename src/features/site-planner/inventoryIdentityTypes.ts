export type InventoryIdentity = {
  schemaVersion: 1; technology: 'LTE' | 'NR'; mcc: string | null; mnc: string | null; cellId: string | null;
  pci: number | null; arfcn: number | null; carrierName: string | null; sourceReference: string | null;
  source: 'manual'; verification: 'unverified';
};
export type InventoryIdentityDraft = { technology: '' | 'LTE' | 'NR'; mcc: string; mnc: string; cellId: string;
  pci: string; arfcn: string; carrierName: string; sourceReference: string };
export const inventoryIdentityToken = (value?: InventoryIdentity) => stableJson(value ?? null);
import { stableJson } from '../../../study.mjs';
