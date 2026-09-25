import hashlib
import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import models as M
from app.core.db import get_db
from app.core.security import require_key
from app.schemas import IngestResponse
from app.services import risk_service
from app.services.db_utils import set_provenance, upsert

router = APIRouter(prefix="/ingest", tags=["ingest"], dependencies=[Depends(require_key)])

SPECS = {   # kind: (Model, required CSV columns, conflict keys)
    "production": (M.ProductionDaily, ["mine_code", "date", "planned_t", "actual_t"], ["mine_id", "date"]),
    "weather":    (M.WeatherDaily, ["mine_code", "date", "rain_mm"], ["mine_id", "date"]),
    "blasts":     (M.BlastLog, ["mine_code", "date", "delayed"], ["mine_id", "date"]),
    "equipment":  (M.EquipmentDaily, ["mine_code", "unit_code", "date", "available_hours",
                                      "scheduled_hours", "breakdown"], ["mine_id", "unit_code", "date"]),
}


def _deterministic_hole_id(mine_id: int, hole_code: str) -> int:
    digest = hashlib.sha256(f"{mine_id}:{hole_code}".encode()).hexdigest()
    return int(digest[:8], 16) % (2**31 - 1) + 1


@router.post("/{kind}", response_model=IngestResponse)
def ingest(kind: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if kind == "drillholes":
        df = pd.read_csv(file.file)
        required = ["mine_code", "hole_code", "lat", "lon", "collar_z", "from_m", "to_m", "mn_pct"]
        missing = [c for c in required if c not in df.columns]
        if missing:
            raise HTTPException(422, f"missing columns: {missing}")

        ids = {m.code: m.id for m in db.scalars(select(M.Mine))}
        df["mine_id"] = df["mine_code"].map(ids)
        if df["mine_id"].isna().any():
            bad = sorted(set(df.loc[df["mine_id"].isna(), "mine_code"]))
            raise HTTPException(422, f"unknown mine_code: {bad}")

        holes_inserted = 0
        assays_inserted = 0

        # Group by hole coordinates and identifier
        for (mine_id, hole_code, lat, lon, cz), obj in df.groupby(["mine_id", "hole_code", "lat", "lon", "collar_z"]):
            target_id = _deterministic_hole_id(int(mine_id), str(hole_code))
            h = db.scalars(select(M.DrillHole).where(M.DrillHole.mine_id == int(mine_id),
                                                    M.DrillHole.id == target_id)).first()
            if not h:
                h = M.DrillHole(id=target_id, mine_id=int(mine_id), collar_z=float(cz),
                                collar_lat=float(lat), collar_lon=float(lon))
                db.add(h)
                holes_inserted += 1
            else:
                # Clear existing assays for this hole to avoid duplicates on re-upload
                db.execute(delete(M.Assay).where(M.Assay.hole_id == h.id))

            db.flush()
            for row in obj.itertuples():
                db.add(M.Assay(hole_id=h.id, from_m=float(row.from_m), to_m=float(row.to_m),
                               mn_pct=float(row.mn_pct),
                               fe_pct=float(row.fe_pct) if hasattr(row, "fe_pct") and pd.notna(row.fe_pct) else None))
                assays_inserted += 1

        set_provenance(db, "drillholes", "uploaded",
                       f"{holes_inserted} holes, {assays_inserted} assays from {file.filename or 'CSV'}")
        db.commit()
        return IngestResponse(
            kind="drillholes",
            rows=assays_inserted,
            rows_holes=holes_inserted,
            rows_assays=assays_inserted,
            date_min="N/A",
            date_max="N/A"
        )

    if kind not in SPECS:
        raise HTTPException(404, f"kind must be one of {list(SPECS) + ['drillholes']}")
    Model, required, keys = SPECS[kind]
    df = pd.read_csv(file.file)
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise HTTPException(422, f"missing columns: {missing}")
    ids = {m.code: m.id for m in db.scalars(select(M.Mine))}
    bad = sorted(set(df.mine_code) - set(ids))
    if bad:
        raise HTTPException(422, f"unknown mine_code: {bad}")
    df["mine_id"] = df.pop("mine_code").map(ids)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    for c in ("breakdown", "delayed", "is_forecast"):
        if c in df:
            df[c] = df[c].astype(bool)
    cols = {c.name for c in Model.__table__.columns} - {"id"}
    df = df[[c for c in df.columns if c in cols]]
    rows = df.astype(object).where(df.notna(), None).to_dict("records")
    upsert(db, Model, rows, keys)
    set_provenance(db, kind, "uploaded",
                   f"{len(rows)} rows from {file.filename or 'CSV'} ({df['date'].min()} to {df['date'].max()})")
    risk_service.cache.clear()
    return IngestResponse(
        kind=kind,
        rows=len(rows),
        date_min=str(df["date"].min()),
        date_max=str(df["date"].max())
    )
