"""Build data/deposits.json (map layer + prospectivity labels) from the USGS MRDS export.

Source: mrds-fIN.txt, the MRDS CSV export for India (all commodities). Keeps every
site whose commodity fields mention manganese, plus any site listed in the MRDS
full-text manganese search (fulltext-search.json) as a cross-check.

Both inputs live in data/sources/ (tracked in git).
"""

import csv
import json
from pathlib import Path

SOURCES = Path("data/sources")
OUT = Path("data/deposits.json")


def find(name: str) -> Path | None:
    p = SOURCES / name
    return p if p.exists() else None


def main():
    csv_path = find("mrds-fIN.txt")
    if not csv_path:
        raise SystemExit(f"{SOURCES / 'mrds-fIN.txt'} not found (see data/README.md)")

    search_ids: set[str] = set()
    if (search := find("fulltext-search.json")):
        search_ids = {str(d["dep_id"]) for d in json.loads(search.read_text())}

    out = []
    with open(csv_path, encoding="utf-8", errors="replace") as f:
        for r in csv.DictReader(f):
            commods = " ".join(r.get(k) or "" for k in ("commod1", "commod2", "commod3"))
            if "manganese" not in commods.lower() and r["dep_id"] not in search_ids:
                continue
            try:
                lat, lon = float(r["latitude"]), float(r["longitude"])
            except (TypeError, ValueError):
                continue
            out.append({
                "dep_id": r["dep_id"],
                "site_name": r["site_name"] or "Unnamed site",
                "latitude": lat,
                "longitude": lon,
                "state": r["state"] or "",
                "dev_stat": r["dev_stat"] or None,
                "oper_type": r["oper_type"] or None,
                "ore": r["ore"] or None,
                "gangue": r["gangue"] or None,
                "host_rock": r["hrock_type"] or None,
            })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1))
    belt = sum(78.5 <= d["longitude"] <= 81.0 and 21.0 <= d["latitude"] <= 22.5 for d in out)
    print(f"wrote {len(out)} manganese sites to {OUT} ({belt} in the Nagpur-Bhandara-Balaghat belt)")


if __name__ == "__main__":
    main()
