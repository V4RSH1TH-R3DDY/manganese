from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.ml.registry import _find_model_path
from app.models import DataProvenance

router = APIRouter(tags=["health"])

# Sources the UI expects to know the provenance of. Anything missing from the
# data_provenance table is reported as "unknown", never as live.
TRACKED = ("weather", "production", "equipment", "blasts", "drillholes")

# Modes that still need disclosure in the UI. "scenario" means real data with a
# deliberate synthetic overlay (e.g. a scripted storm) -- real enough to cite,
# not real enough to present unlabelled.
DISCLOSE = ("synthetic", "unknown", "scenario")


@router.get("/health")
def health(db: Session = Depends(get_db)):
    rows = {r.source: r for r in db.scalars(select(DataProvenance))}
    provenance = [
        {"source": s,
         "mode": rows[s].mode if s in rows else "unknown",
         "detail": rows[s].detail if s in rows else "",
         "updated_at": rows[s].updated_at.isoformat() if s in rows else None}
        for s in TRACKED
    ]
    model_file = _find_model_path("shortfall")
    return {
        "status": "ok",
        "data_mode": settings.data_mode,
        "model_loaded": model_file.exists(),
        "provenance": provenance,
        # convenience for the badge: which sources are not real data
        "synthetic_sources": [p["source"] for p in provenance if p["mode"] in DISCLOSE],
    }
