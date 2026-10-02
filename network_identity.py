"""Validate declared public-PLMN inventory identities; no operator or RF attestation."""
import re

KEYS = {"schemaVersion", "technology", "mcc", "mnc", "cellId", "pci", "arfcn", "carrierName", "sourceReference", "source", "verification"}
LIMITS = {"NR": {"cellId": 68719476735, "pci": 1007, "arfcn": 3279165},
          "LTE": {"cellId": 268435455, "pci": 503, "arfcn": 262143}}
# ECMAScript String.trim whitespace, including BOM, for the same stored-text contract.
TRIM_CHARS = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def validate_inventory_identities(sites):
    if not isinstance(sites, list):
        raise ValueError("Invalid cell identity inventory")
    seen = set()
    for site in sites:
        if not isinstance(site, dict) or not isinstance(site.get("cells"), list):
            raise ValueError("Invalid cell identity inventory")
        for cell in site["cells"]:
            if not isinstance(cell, dict):
                raise ValueError("Invalid cell identity inventory")
            if "inventoryIdentity" not in cell:
                continue
            identity = cell["inventoryIdentity"]
            error = f"Invalid cell identity for {cell.get('id')}"
            if (not isinstance(identity, dict) or set(identity) != KEYS or isinstance(identity.get("schemaVersion"), bool)
                    or identity.get("schemaVersion") != 1 or not isinstance(identity.get("technology"), str)
                    or identity["technology"] not in LIMITS or identity.get("source") != "manual" or identity.get("verification") != "unverified"):
                raise ValueError(error)
            limits = LIMITS[identity["technology"]]
            mcc, mnc, local_id = identity["mcc"], identity["mnc"], identity["cellId"]
            if ((mcc is not None and (not isinstance(mcc, str) or not re.fullmatch(r"[0-9]{3}", mcc)))
                    or (mnc is not None and (not isinstance(mnc, str) or not re.fullmatch(r"[0-9]{2,3}", mnc)))
                    or ((mcc is None) != (mnc is None))
                    or (local_id is not None and (not isinstance(local_id, str) or len(local_id) > 11
                        or not re.fullmatch(r"0|[1-9][0-9]*", local_id) or int(local_id) > limits["cellId"]))):
                raise ValueError(error)
            for key in ("pci", "arfcn"):
                number = identity[key]
                if number is not None and (isinstance(number, bool) or not isinstance(number, (int, float))
                        or not 0 <= number <= limits[key] or number != int(number)):
                    raise ValueError(error)
            for key, maximum in (("carrierName", 80), ("sourceReference", 160)):
                value = identity[key]
                if value is not None and (not isinstance(value, str) or not value or value != value.strip(TRIM_CHARS)
                        or len(value.encode("utf-16-le")) // 2 > maximum):
                    raise ValueError(error)
            radio = site.get("radio")
            site_rat = radio.get("technology") if isinstance(radio, dict) else None
            expected = "5G NR" if identity["technology"] == "NR" else "4G LTE"
            if site_rat not in (expected, "4G LTE + 5G NR"):
                raise ValueError(f"Cell identity technology does not match site {site.get('id')}")
            if mcc is not None and local_id is not None:
                key = (identity["technology"], mcc, mnc, local_id)
                if key in seen:
                    raise ValueError(f"Duplicate global cell identity for {cell.get('id')}")
                seen.add(key)
