"""Module C training: daily efficiency (actual/planned) quantile models + shortfall classifier."""

from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal, engine
from app.ml.dataset import load_frame
from app.ml.features import FEATS, build_features
from app.models import Mine


def pinball(y, q, a):
    return float(np.mean(np.maximum(a * (y - q), (a - 1) * (y - q))))


def main():
    frames = []
    with SessionLocal() as db:
        for m in db.scalars(select(Mine)):
            df = load_frame(engine, m.id)
            df["planned"] = df.planned.fillna(m.plan_tpd)
            f = build_features(df, m.method == "opencast")
            f["eff"] = f.actual / f.planned
            frames.append(f.dropna(subset=["eff"]))
    data = pd.concat(frames).sort_values("date")
    cut = data.date.iloc[int(len(data) * 0.8)]                  # time-based split
    tr, va = data[data.date < cut], data[data.date >= cut]

    q = {a: lgb.LGBMRegressor(objective="quantile", alpha=a, n_estimators=500, learning_rate=0.03,
                              num_leaves=31, verbose=-1).fit(tr[FEATS], tr.eff) for a in (0.1, 0.5, 0.9)}
    clf = lgb.LGBMClassifier(n_estimators=300, learning_rate=0.03, verbose=-1).fit(
        tr[FEATS], (tr.eff < 0.9).astype(int))

    # Conformalized quantile regression: the raw q10-q90 band under-covers, so widen it by
    # the margin that makes it cover 80% of a held-out calibration slice (first half of the
    # validation period), then report coverage on the untouched second half.
    half = va.date.iloc[len(va) // 2]
    cal, test = va[va.date < half], va[va.date >= half]
    c10, c90 = q[0.1].predict(cal[FEATS]), q[0.9].predict(cal[FEATS])
    scores = np.maximum(c10 - cal.eff.values, cal.eff.values - c90)
    level = min(1.0, np.ceil((len(scores) + 1) * 0.8) / len(scores))
    cqr = float(max(0.0, np.quantile(scores, level)))

    p10, p50, p90 = (q[a].predict(test[FEATS]) for a in (0.1, 0.5, 0.9))
    y = test.eff.values
    print("pinball q50:", pinball(y, p50, 0.5))
    print(f"coverage 10-90: raw {float(((y >= p10) & (y <= p90)).mean()):.3f}, "
          f"calibrated {float(((y >= p10 - cqr) & (y <= p90 + cqr)).mean()):.3f} (target 0.80, margin {cqr:.3f})")
    Path(settings.model_dir).mkdir(parents=True, exist_ok=True)
    joblib.dump({"q": q, "clf": clf, "feats": FEATS, "cqr": cqr}, Path(settings.model_dir) / "shortfall.joblib")


if __name__ == "__main__":
    main()
