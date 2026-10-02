# Declared cell inventory and measurement associations

The next Sites and Cells enhancement supplies explicit per-cell radio identity declarations. Existing internal sector IDs remain stable. Registered KCA/SKT facility positions do not identify current cells, antennas or carriers, so example sites acquire no invented PLMN or sector identities.

## Usage

Select a site and sector, open RF, then expand **Cell identity and carrier**. Choose LTE or NR and enter only supplied values. Save the group explicitly; other RF and position fields retain their existing save-on-blur behavior. Unsaved identity drafts survive sector and inspector-tab switches within this workspace. Changing projects starts that project's editor. Reset loads the current declaration, while Clear removes it. Navigating away from the editor does not retain an unsaved form draft.

Blank values remain unspecified. MCC/MNC preserve leading zeros. NCI/ECI accepts decimal or `0x` hexadecimal input and stores a canonical decimal string. Summary and measurement inspectors display complete identities with fixed-width hexadecimal local IDs. This is an application display and storage convention, not a protocol encoding.

Save validates the complete group and records one activity entry in the same workspace transaction. A changed declaration invalidates the form's original identity token; reset before saving again. Pending, failed or conflicting database saves block new identity writes. Failed writes retain the controller draft and form values for the existing workspace recovery controls; the editor does not report success until confirmation.

The desktop inspector scrolls within its bounded panel so expanding the identity form preserves a usable map. Mobile uses the page's vertical flow. All labels and controls remain keyboard accessible.

## Optional project contract

`cell.inventoryIdentity` is an optional schema 1 object with exactly these fields:

| Field | Stored value |
| --- | --- |
| `schemaVersion` | `1` |
| `technology` | Explicit `LTE` or `NR`, compatible with the parent site's declared RAT |
| `mcc`, `mnc` | Strings or null; both supplied or both null |
| `cellId` | Canonical nonnegative decimal string or null; NCI for NR, ECI for LTE |
| `pci`, `arfcn` | Integers or null |
| `carrierName` | Trimmed reference label, 1–80 characters, or null |
| `sourceReference` | Trimmed manual source reference, 1–160 characters, or null |
| `source`, `verification` | Fixed `manual`, `unverified` |

Absent metadata leaves older projects unchanged. Present null records, extra fields, malformed numbers and verification claims reject the save. Complete global identity keys include RAT, MCC, MNC and local cell ID; duplicates are rejected across the inventory. Two- and three-digit MNCs remain distinct. PCI reuse is allowed.

## Pinned validation bounds

MCC uses three decimal digits and MNC uses two or three. Public-PLMN global cell identity combines PLMN with the local cell identifier. NR identifiers use 36 bits and EUTRA identifiers use 28 bits. The referenced editions are [ETSI TS 23.003 V18.6.0, clauses 2.2, 19.6 and 19.6A](https://www.etsi.org/deliver/etsi_ts/123000_123099/123003/18.06.00_60/ts_123003v180600p.pdf) and [ETSI TS 38.455 V17.3.0, CGI information elements and ASN.1](https://www.etsi.org/deliver/etsi_ts/138400_138499/138455/17.03.00_60/ts_138455v170300p.pdf).

| RAT | Local cell ID | PCI | Channel number |
| --- | --- | --- | --- |
| NR | 0–68,719,476,735 | 0–1,007 | NR-ARFCN 0–3,279,165 |
| LTE | 0–268,435,455 | 0–503 | EARFCN 0–262,143 |

The PCI and channel integer ranges are taken from [ETSI TS 38.455 V17.3.0](https://www.etsi.org/deliver/etsi_ts/138400_138499/138455/17.03.00_60/ts_138455v170300p.pdf). They do not validate band-specific raster, spectrum permissions, actual carrier frequency, antenna behavior or live operator configuration. This contract covers public-PLMN identities; SNPN/NID identities require a separate schema extension. The pinned references do not imply support for every release feature.

## Observation and frozen-input behavior

Serving-cell IDs in measurement CSVs remain opaque source identifiers. Manual source ID / RAT associations are retained as dataset interpretations. There is no automatic PLMN inference or source-to-CGI reconciliation. Target selection filters against both site RAT and declared cell RAT. Legacy cells without declarations inherit the site RAT for compatibility. Missing, ambiguous or incompatible targets remain unresolved; observations never move to a substitute cell.

The shared association inspector shows the resolved cell's declared CGI and carrier label with unverified status. Working inventory changes can make an older association incompatible; its original source and interpretation remain retained. Frozen propagation views resolve against their captured inventory, not current working declarations.

Client and server validate metadata in working inputs and captured baselines. Existing canonical engineering snapshots, manifests and frozen run inputs retain the full cell object. An identity edit does not change source CSVs, samples, retained datasets, baselines or prior run requests. Channel metadata does not configure the single-link path solver.

## Verification and remaining scope

Domain, command, form, SQLite and browser tests cover bounds, missing versus zero, PLMN zeros, duplicate keys, RAT compatibility, atomic rejection, stale ownership, failed writes, reload, source retention and captured inventory. Screenshots: [desktop](design-review/cell-inventory/inventory-desktop.png), [390 px mobile](design-review/cell-inventory/inventory-mobile.png). Browser tests use disposable databases and test PLMN values; no live operator identity is asserted.

Operator inventory imports, source-column PLMN/NCGI reconciliation, neighbor identities, time/space alignment, gNB/CU/DU/RU topology, band validation and calibrated antenna models remain pending. The three-sector and 50-site limits are unchanged. See the [implementation register](ran-enhancement-implementation.md) for the remaining commercial workflow.
