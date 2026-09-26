import datetime as dt
from threading import Lock

import numpy as np
import pandas as pd
from cachetools import TTLCache, cached
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.ml import registry
from app.ml.dataset import load_frame
from app.ml.features import FEATS, LABELS, build_features
from app.models import Mine
from app.schemas import BandPoint, Driver, RiskOut

cache: TTLCache = TTLCache(maxsize=256, ttl=300)


def level_for(pct: float) -> str:
    return "red" if pct >= 12 else "amber" if pct >= 5 else "green"


@cached(cache, key=lambda db, mine, horizon=7: (mine.code, horizon), lock=Lock())
def compute_risk(db: Session, mine: Mine, horizon: int = 7) -> RiskOut:
    bundle = registry.load("shortfall")
    today = dt.date.today()
    df = load_frame(db.get_bind(), mine.id, start=today - dt.timedelta(days=75))
    df["planned"] = df["planned"].fillna(mine.plan_tpd)
    feats = build_features(df, mine.method == "opencast")
    fut = feats[feats.date > pd.Timestamp(today)].head(horizon)
    if fut.empty:
        raise HTTPException(503, "No forecast weather rows: run the weather refresh or seed script")

    X = fut[bundle["feats"]]
    q = {a: bundle["q"][a].predict(X) for a in (0.1, 0.5, 0.9)}
    cqr = bundle.get("cqr", 0.0)                 # conformal margin from train_all; widens q10-q90 to ~80% coverage
    q = {0.1: (q[0.1] - cqr).clip(0.0, 1.1), 0.5: q[0.5].clip(0.0, 1.1), 0.9: (q[0.9] + cqr).clip(0.0, 1.1)}
    q10, q50, q90 = np.minimum(q[0.1], q[0.5]), q[0.5], np.maximum(q[0.9], q[0.5])
    plan = fut.planned.to_numpy()

    # Counterfactual: same weather, equipment fully available -> splits weather vs equipment loss
    Xw = X.copy()
    Xw["avail_1"] = 1.0
    Xw["avail_7"] = 1.0
    eff_w = bundle["q"][0.5].predict(Xw).clip(0, 1.1)

    loss_t = float((plan - q50 * plan).sum())
    short_pct = 100 * loss_t / float(plan.sum())

    # SHAP on the worst forecast day: what drags efficiency down
    sv = np.asarray(registry.explainer().shap_values(X))[int(np.argmin(q50))]
    agg: dict[str, float] = {}
    for f, v in zip(FEATS, sv):
        agg[LABELS[f]] = agg.get(LABELS[f], 0.0) + float(v)
    drivers = [Driver(feature=k, label=k, impact_pct=round(100 * v, 1))
               for k, v in sorted(agg.items(), key=lambda t: t[1])[:3] if v < -0.005]

    return RiskOut(
        mine=mine.code, issued_on=today, horizon_days=horizon, level=level_for(short_pct),
        p_shortfall=float(bundle["clf"].predict_proba(X)[:, 1].mean()),
        expected_shortfall_pct=short_pct, expected_loss_t=loss_t,
        band=[BandPoint(date=r.date.date(), planned=float(p), q10=float(a) * float(p),
                        q50=float(b) * float(p), q90=float(c) * float(p), rain_mm=float(r.rain))
              for r, p, a, b, c in zip(fut.itertuples(), plan, q10, q50, q90)],
        drivers=drivers,
        signals={"avail_7": float(fut.avail_7.iloc[0]),
                 "weather_pct": 100 * float((1 - eff_w).mean()),
                 "equipment_pct": 100 * float(max(0.0, (eff_w - q50).mean()))},
    )
