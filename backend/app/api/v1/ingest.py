import hashlib
import io
import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
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

COLUMN_ALIASES = {
    "mine": "mine_code",
    "mine_name": "mine_code",
    "mine_id": "mine_code",
    "minecode": "mine_code",
    "planned": "planned_t",
    "plan": "planned_t",
    "planned_tonnes": "planned_t",
    "target_t": "planned_t",
    "target": "planned_t",
    "actual": "actual_t",
    "actual_tonnes": "actual_t",
    "production": "actual_t",
    "prod_t": "actual_t",
    "rain": "rain_mm",
    "rainfall": "rain_mm",
    "rainfall_mm": "rain_mm",
    "unit": "unit_code",
    "unit_id": "unit_code",
    "unitcode": "unit_code",
    "dumper": "unit_code",
    "avail_hours": "available_hours",
    "sched_hours": "scheduled_hours",
    "delay": "delayed",
    "blast_delayed": "delayed",
    "hole": "hole_code",
    "hole_id": "hole_code",
    "holecode": "hole_code",
    "latitude": "lat",
    "longitude": "lon",
    "elevation": "collar_z",
    "depth_from": "from_m",
    "from": "from_m",
    "depth_to": "to_m",
    "to": "to_m",
    "grade": "mn_pct",
    "mn": "mn_pct",
    "fe": "fe_pct",
}

TEMPLATES = {
    "production": "mine_code,date,planned_t,actual_t\nBLG,2026-09-25,1200,1180\nDBZ,2026-09-25,1000,950\nKDR,2026-09-25,300,295\nMNS,2026-09-25,333,320\nCHK,2026-09-25,566,540\n",
    "weather": "mine_code,date,rain_mm\nBLG,2026-09-25,0.0\nDBZ,2026-09-25,4.5\nKDR,2026-09-25,2.0\nMNS,2026-09-25,1.5\nCHK,2026-09-25,0.0\n",
    "blasts": "mine_code,date,delayed\nBLG,2026-09-25,false\nDBZ,2026-09-25,true\nKDR,2026-09-25,false\nMNS,2026-09-25,false\nCHK,2026-09-25,false\n",
    "equipment": "mine_code,unit_code,date,available_hours,scheduled_hours,breakdown\nBLG,BLG-D1,2026-09-25,18.5,20.0,false\nBLG,BLG-D2,2026-09-25,6.0,20.0,true\nDBZ,DBZ-D1,2026-09-25,20.0,20.0,false\n",
    "drillholes": "mine_code,hole_code,lat,lon,collar_z,from_m,to_m,mn_pct,fe_pct\nBLG,BLG_DH_01,21.966,80.233,350.0,0,5,38.5,7.2\nBLG,BLG_DH_01,21.966,80.233,350.0,5,10,42.1,6.8\nDBZ,DBZ_DH_01,21.548,79.682,350.0,0,5,31.2,8.4\n",
}


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    cols = []
    for c in df.columns:
        clean = str(c).strip().lower().replace(" ", "_")
        cols.append(COLUMN_ALIASES.get(clean, clean))
    df.columns = cols
    return df


def _resolve_mine_ids(df: pd.DataFrame, mines: list[M.Mine]) -> pd.Series:
    code_map = {}
    for m in mines:
        code_map[m.code.lower()] = m.id
        code_map[m.name.lower()] = m.id
        code_map[m.name.lower().replace(" ", "")] = m.id
    return df["mine_code"].astype(str).str.strip().str.lower().map(code_map)


def _deterministic_hole_id(mine_id: int, hole_code: str) -> int:
    digest = hashlib.sha256(f"{mine_id}:{hole_code}".encode()).hexdigest()
    return int(digest[:8], 16) % (2**31 - 1) + 1


@router.get("/template/{kind}")
def get_template(kind: str):
    if kind not in TEMPLATES:
        raise HTTPException(404, f"Template not found for kind '{kind}'. Valid kinds: {list(TEMPLATES.keys())}")
    return Response(
        content=TEMPLATES[kind],
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={kind}_template.csv"},
    )


@router.get("/records/{kind}")
def get_recent_records(kind: str, limit: int = 15, db: Session = Depends(get_db)):
    mine_map = {m.id: m.code for m in db.scalars(select(M.Mine))}
    if kind == "production":
        rows = db.scalars(
            select(M.ProductionDaily).order_by(M.ProductionDaily.date.desc()).limit(limit)
        ).all()
        return [
            {"mine_code": mine_map.get(r.mine_id, str(r.mine_id)), "date": str(r.date),
             "planned_t": r.planned_t, "actual_t": r.actual_t}
            for r in rows
        ]
    elif kind == "weather":
        rows = db.scalars(
            select(M.WeatherDaily).order_by(M.WeatherDaily.date.desc()).limit(limit)
        ).all()
        return [
            {"mine_code": mine_map.get(r.mine_id, str(r.mine_id)), "date": str(r.date),
             "rain_mm": r.rain_mm, "is_forecast": r.is_forecast}
            for r in rows
        ]
    elif kind == "blasts":
        rows = db.scalars(
            select(M.BlastLog).order_by(M.BlastLog.date.desc()).limit(limit)
        ).all()
        return [
            {"mine_code": mine_map.get(r.mine_id, str(r.mine_id)), "date": str(r.date),
             "delayed": r.delayed}
            for r in rows
        ]
    elif kind == "equipment":
        rows = db.scalars(
            select(M.EquipmentDaily).order_by(M.EquipmentDaily.date.desc()).limit(limit)
        ).all()
        return [
            {"mine_code": mine_map.get(r.mine_id, str(r.mine_id)), "unit_code": r.unit_code,
             "date": str(r.date), "available_hours": r.available_hours,
             "scheduled_hours": r.scheduled_hours, "breakdown": r.breakdown}
            for r in rows
        ]
    elif kind == "drillholes":
        rows = db.scalars(
            select(M.DrillHole).order_by(M.DrillHole.id.desc()).limit(limit)
        ).all()
        return [
            {"mine_code": mine_map.get(r.mine_id, str(r.mine_id)), "hole_id": r.id,
             "lat": round(r.collar_lat, 4), "lon": round(r.collar_lon, 4),
             "collar_z": round(r.collar_z, 1)}
            for r in rows
        ]
    else:
        raise HTTPException(404, f"Unknown kind: {kind}. Valid kinds: {list(SPECS.keys()) + ['drillholes']}")


@router.post("/{kind}", response_model=IngestResponse)
def ingest(kind: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    mines = db.scalars(select(M.Mine)).all()
    valid_codes = [f"{m.code} ({m.name})" for m in mines]

    try:
        df = pd.read_csv(file.file)
    except Exception as e:
        raise HTTPException(422, f"Failed to parse CSV file: {str(e)}")

    if df.empty:
        raise HTTPException(422, "Uploaded CSV file is empty.")

    df = _normalize_columns(df)

    if kind == "drillholes":
        required = ["mine_code", "hole_code", "lat", "lon", "collar_z", "from_m", "to_m", "mn_pct"]
        missing = [c for c in required if c not in df.columns]
        if missing:
            raise HTTPException(422, f"Missing required columns: {missing}. Expected columns: {required}")

        df["mine_id"] = _resolve_mine_ids(df, mines)
        if df["mine_id"].isna().any():
            bad = sorted(set(df.loc[df["mine_id"].isna(), "mine_code"]))
            raise HTTPException(422, f"Unknown mine identifiers: {bad}. Valid options: {valid_codes}")

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
        raise HTTPException(404, f"Kind must be one of {list(SPECS) + ['drillholes']}")
    Model, required, keys = SPECS[kind]

    missing = [c for c in required if c not in df.columns]
    if missing:
        raise HTTPException(422, f"Missing required columns: {missing}. Expected columns: {required}")

    df["mine_id"] = _resolve_mine_ids(df, mines)
    if df["mine_id"].isna().any():
        bad = sorted(set(df.loc[df["mine_id"].isna(), "mine_code"]))
        raise HTTPException(422, f"Unknown mine identifiers: {bad}. Valid options: {valid_codes}")

    try:
        df["date"] = pd.to_datetime(df["date"]).dt.date
    except Exception as e:
        raise HTTPException(422, f"Invalid date values in 'date' column: {str(e)}")

    for c in ("breakdown", "delayed", "is_forecast"):
        if c in df:
            df[c] = df[c].astype(bool)

    cols = {c.name for c in Model.__table__.columns} - {"id"}
    df_to_save = df[[c for c in df.columns if c in cols]]
    rows = df_to_save.astype(object).where(df_to_save.notna(), None).to_dict("records")
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
