export type CellIdentityBinding = { technology: 'LTE' | 'NR'; sourceCell: string; targetCellId: string | null };
export type CellIdentity = { schemaVersion: 1; method: 'manual-review'; bindings: CellIdentityBinding[] };
export type IdentitySite = { id: string; name: string; radio?: { technology: string }; cells: { id: string; inventoryIdentity?: InventoryIdentity }[] };
import type { InventoryIdentity } from '../site-planner/inventoryIdentityTypes';
