from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import DrillHole, Mine
from app.schemas import DrillHolePoint, MineSummary
from app.services.reserve_service import latest_reserve
from app.services.risk_service import compute_risk

router = APIRouter(prefix="/mines", tags=["mines"])


@router.get("", response_model=list[MineSummary])
def list_mines(db: Session = Depends(get_db)):
    out = []
    for m in db.scalars(select(Mine).order_by(Mine.code)):
        r, rv = compute_risk(db, m, 7), latest_reserve(db, m)
        out.append(MineSummary(code=m.code, name=m.name, method=m.method, lat=m.lat, lon=m.lon,
                               level=r.level, expected_shortfall_pct=r.expected_shortfall_pct,
                               reserve_p50_t=rv.p50_t if rv else None))
    return out


@router.get("/drillholes", response_model=list[DrillHolePoint])
def list_drillholes(db: Session = Depends(get_db)):
    mines = {m.id: m.code for m in db.scalars(select(Mine))}
    holes = db.scalars(select(DrillHole)).all()
    return [
        DrillHolePoint(
            id=h.id,
            mine_code=mines.get(h.mine_id, ""),
            lat=h.collar_lat,
            lon=h.collar_lon,
            collar_z=h.collar_z,
        )
        for h in holes
    ]
