import datetime as dt

import numpy as np
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.ml.optimizer import redeploy
from app.models import Action, EquipmentDaily, EquipmentUnit, Mine
from app.schemas import RiskOut
from app.services.risk_service import compute_risk, level_for

RECOVERABLE = 0.40      # assumption: share of predicted loss an action can win back. Tune with MOIL.


def _confidence(r: RiskOut) -> float:
    w = float(np.mean([(b.q90 - b.q10) / b.planned for b in r.band]))
    return float(np.clip(1 - w, 0.3, 0.95))


def rule_actions(mine: Mine, r: RiskOut) -> list[dict]:
    out, conf = [], _confidence(r)
    rainy = [b for b in r.band if b.rain_mm >= 35]
    if mine.method == "opencast" and rainy:
        lost = sum(b.planned - b.q50 for b in rainy)
        out.append(dict(
            kind="blast_advance", confidence=conf, expected_tonnes=lost * RECOVERABLE,
            title=f"Advance blasting and pre-stock ore before the {rainy[0].date:%d %b} rain window",
            detail={"days": [b.date.isoformat() for b in rainy], "recovered_frac": RECOVERABLE,
                    "steps": ["Bring forward the next 2 blast rounds",
                              "Build a 2-day ROM stockpile at the pit head",
                              "Pre-position pumps at the sump and clear haul-road drains"]}))
    if r.signals["avail_7"] < 0.80:
        lost = r.expected_loss_t * 0.30
        out.append(dict(
            kind="maintenance", confidence=conf, expected_tonnes=lost,
            title="Pull forward preventive maintenance on low-availability fleet",
            detail={"days": None, "recovered_frac": 0.30,
                    "steps": ["Service units flagged by 7-day availability drop",
                              "Schedule on the lowest-load shift",
                              "Hold spares for the top-3 failure modes"]}))
    return out


def redeploy_actions(db: Session, mines: list[Mine], risks: dict[str, RiskOut]) -> list[dict]:
    by_id = {m.id: m for m in mines}
    units_db = db.scalars(select(EquipmentUnit)).all()
    # Latest breakdown flag per unit. Uses a window function rather than
    # PostgreSQL's DISTINCT ON, which SQLite *silently ignores* -- that made this
    # dict keep each unit's oldest row, so no unit ever looked broken and the
    # redeploy optimiser never saw a free slot.
    ranked = select(
        EquipmentDaily.unit_code,
        EquipmentDaily.breakdown,
        func.row_number().over(partition_by=EquipmentDaily.unit_code,
                               order_by=EquipmentDaily.date.desc()).label("rn"),
    ).subquery()
    latest = {r.unit_code: bool(r.breakdown) for r in db.execute(
        select(ranked.c.unit_code, ranked.c.breakdown).where(ranked.c.rn == 1))}

    units = [dict(id=u.code, home=by_id[u.home_mine_id].code, tpd=u.tpd, type=u.type)
             for u in units_db if not latest.get(u.code, False)]
    slots = {m.code: sum(1 for u in units_db if u.home_mine_id == m.id) for m in mines}

    wloss = {m.code: risks[m.code].signals["weather_pct"] / 100 for m in mines}
    egap = {m.code: risks[m.code].signals.get("equipment_pct", 0.0) / 100 for m in mines}
    res = redeploy(units, slots, wloss, equip_gap=egap, horizon=7)
    if not res["moves"]:
        return []
    dests = {mv["to"] for mv in res["moves"]}
    dest = max(dests, key=lambda c: risks[c].expected_loss_t)
    dest_mine = next(m for m in mines if m.code == dest)
    frac = min(0.8, res["expected_tonnes"] / max(risks[dest].expected_loss_t, 1.0))
    n = len(res["moves"])
    # Only claim a single destination when that is actually true: the previous
    # title attributed every move to one mine regardless of where units went.
    title = (f"Redeploy {n} healthy unit(s) to {dest_mine.name}" if len(dests) == 1
             else f"Redeploy {n} healthy unit(s) across {len(dests)} mines")
    return [dict(mine_id=dest_mine.id, kind="redeploy", confidence=_confidence(risks[dest]),
                 expected_tonnes=res["expected_tonnes"], title=title,
                 detail={"days": None, "recovered_frac": frac,
                         "steps": [f"Move {m['unit']}: {m['from']} → {m['to']}" for m in res["moves"]]})]


def generate_all(db: Session) -> int:
    mines = db.scalars(select(Mine)).all()
    risks = {m.code: compute_risk(db, m, 7) for m in mines}
    acts = []
    for m in mines:
        acts += [dict(a, mine_id=m.id) for a in rule_actions(m, risks[m.code])]
    acts += redeploy_actions(db, mines, risks)
    db.execute(update(Action).where(Action.status == "open").values(status="superseded"))
    db.add_all([Action(issued_on=dt.date.today(), status="open", **a) for a in acts])
    db.commit()
    return len(acts)


def simulate(r: RiskOut, action: Action) -> RiskOut:
    """What-if: apply the action's recovered fraction to the forecast band."""
    frac = float(action.detail.get("recovered_frac", 0.0))
    days = set(action.detail.get("days") or [b.date.isoformat() for b in r.band])
    out = r.model_copy(deep=True)
    for b in out.band:
        if b.date.isoformat() in days:
            for f in ("q10", "q50", "q90"):
                v = getattr(b, f)
                setattr(b, f, v + (b.planned - v) * frac)
    plan = sum(b.planned for b in out.band)
    out.expected_loss_t = sum(b.planned - b.q50 for b in out.band)
    out.expected_shortfall_pct = 100 * out.expected_loss_t / plan
    out.level = level_for(out.expected_shortfall_pct)
    return out
