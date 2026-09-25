from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.v1.deps import get_mine
from app.core.db import get_db
from app.core.security import require_key
from app.models import Mine
from app.schemas import ReserveOut
from app.services.reserve_service import estimate_reserve, latest_reserve

router = APIRouter(prefix="/reserves", tags=["reserves"])


def _out(m: Mine, e) -> ReserveOut:
    return ReserveOut(mine=m.code, p10_t=e.p10_t, p50_t=e.p50_t, p90_t=e.p90_t,
                      mean_grade=e.mean_grade, cutoff=e.cutoff,
                      grade_hist_x=e.grade_hist_x or [], grade_hist_y=e.grade_hist_y or [],
                      computed_on=e.computed_on)


@router.get("/{code}", response_model=ReserveOut)
def get_reserve(mine: Mine = Depends(get_mine), db: Session = Depends(get_db)):
    e = latest_reserve(db, mine)
    if not e:
        raise HTTPException(404, "no reserve estimate yet")
    return _out(mine, e)


@router.post("/{code}/recompute", response_model=ReserveOut, dependencies=[Depends(require_key)])
def recompute(cutoff: float = 25.0, mine: Mine = Depends(get_mine), db: Session = Depends(get_db)):
    e = estimate_reserve(db, mine, cutoff=cutoff)
    if not e:
        raise HTTPException(422, "not enough assay data")
    return _out(mine, e)
