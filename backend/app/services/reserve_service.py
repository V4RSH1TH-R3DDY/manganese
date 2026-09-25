"""Module B: 3D ordinary kriging of drill-hole assays -> tonnes with uncertainty.

Kriging errors treated as independent per block give a *narrower* range than a
proper conditional simulation. Report this as "approximate P10-P90".
"""

import datetime as dt

import numpy as np
from pykrige.ok3d import OrdinaryKriging3D
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import Mine, ReserveEstimate

# Project lon/lat to local metric coordinates taking latitude into account:
# 1 deg lat ≈ 110,574 m; 1 deg lon ≈ 111,320 * cos(lat) m
SQL = text("""
SELECT (h.collar_lon * 111320.0 * cos(radians(h.collar_lat))) AS x,
       (h.collar_lat * 110574.0) AS y,
       h.collar_z - (a.from_m + a.to_m) / 2 AS z,
       a.mn_pct AS g
FROM assays a JOIN drillholes h ON h.id = a.hole_id WHERE h.mine_id = :m
""")


def latest_reserve(db: Session, mine: Mine) -> ReserveEstimate | None:
    return db.scalars(
        select(ReserveEstimate)
        .where(ReserveEstimate.mine_id == mine.id)
        .order_by(ReserveEstimate.computed_on.desc())
    ).first()


def estimate_reserve(db: Session, mine: Mine, cutoff=25.0, density=3.6, n_sim=200, seed=0):
    rows = db.execute(SQL, {"m": mine.id}).all()
    if len(rows) < 30:
        return None
    arr = np.array(rows, dtype=float)
    if len(arr) > 400:                                           # keep kriging fast for the MVP
        arr = arr[np.random.default_rng(seed).choice(len(arr), 400, replace=False)]
    x, y, z, g = arr.T
    ok = OrdinaryKriging3D(x, y, z, g, variogram_model="spherical", nlags=12)
    dx, dz = 50.0, 10.0
    gx = np.arange(x.min() - 100, x.max() + 100, dx)
    gy = np.arange(y.min() - 100, y.max() + 100, dx)
    gz = np.arange(z.min() - 10, z.max() + 10, dz)
    gk, var = ok.execute("grid", gx, gy, gz)
    gk, sd = np.asarray(gk), np.sqrt(np.clip(np.asarray(var), 0, None))
    vol = dx * dx * dz
    rng = np.random.default_rng(seed)        # independent-block noise: optimistic (narrow) range
    sims = [((gk + rng.normal(0, 1, gk.shape) * sd) >= cutoff).sum() * vol * density for _ in range(n_sim)]
    p10, p50, p90 = np.percentile(sims, [10, 50, 90])
    ore = gk[gk >= cutoff]
    
    hist_y, hist_edges = np.histogram(ore, bins=10, range=(cutoff, max(cutoff + 10, ore.max() if ore.size else cutoff + 10)))
    hist_x = [float((hist_edges[i] + hist_edges[i+1])/2) for i in range(len(hist_y))]
    # Scale hist_y from voxel count to approximate tonnes
    hist_y = [float(count * vol * density) for count in hist_y]

    r = db.scalars(select(ReserveEstimate).where(ReserveEstimate.mine_id == mine.id)).first()
    if not r:
        r = ReserveEstimate(mine_id=mine.id)
        db.add(r)
    r.computed_on = dt.date.today()
    r.p10_t, r.p50_t, r.p90_t = float(p10), float(p50), float(p90)
    r.mean_grade = float(ore.mean()) if len(ore) else float(cutoff)
    r.cutoff = float(cutoff)
    r.grade_hist_x = hist_x
    r.grade_hist_y = hist_y
    db.commit()
    db.refresh(r)
    return r
