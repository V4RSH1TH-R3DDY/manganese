from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import require_key
from app.models import Action, Mine
from app.schemas import ActionOut, RiskOut
from app.services.recommend_service import generate_all, simulate
from app.services.risk_service import compute_risk

router = APIRouter(prefix="/actions", tags=["actions"])


def _out(a: Action, code: str) -> ActionOut:
    return ActionOut(id=a.id, mine=code, kind=a.kind, title=a.title, detail=a.detail or {},
                     expected_tonnes=a.expected_tonnes, confidence=a.confidence, status=a.status)


@router.get("", response_model=list[ActionOut])
def list_actions(mine: str | None = None, db: Session = Depends(get_db)):
    q = (select(Action, Mine.code).join(Mine, Mine.id == Action.mine_id)
         .where(Action.status == "open").order_by(Action.expected_tonnes.desc()))
    if mine:
        q = q.where(Mine.code == mine)
    return [_out(a, c) for a, c in db.execute(q)]


@router.post("/refresh", response_model=list[ActionOut], dependencies=[Depends(require_key)])
def refresh(db: Session = Depends(get_db)):
    generate_all(db)
    q = (select(Action, Mine.code).join(Mine, Mine.id == Action.mine_id)
         .where(Action.status == "open").order_by(Action.expected_tonnes.desc()))
    return [_out(a, c) for a, c in db.execute(q)]


@router.post("/{action_id}/simulate", response_model=RiskOut)
def simulate_action(action_id: int, horizon: int = 7, db: Session = Depends(get_db)):
    a = db.get(Action, action_id)
    if not a:
        raise HTTPException(404, "unknown action")
    return simulate(compute_risk(db, db.get(Mine, a.mine_id), horizon), a)
