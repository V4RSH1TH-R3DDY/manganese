import datetime as dt
import numpy as np
from pykrige.ok3d import OrdinaryKriging3D
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import Mine, ReserveEstimate

SQL = text("""
SELECT (h.collar_lon * 111320.0 * cos(radians(h.collar_lat))) AS x,
       (h.collar_lat * 110574.0) AS y,
       h.collar_z - (a.from_m + a.to_m) / 2 AS z,
       a.mn_pct AS g
FROM assays a JOIN drillholes h ON h.id = a.hole_id WHERE h.mine_id = :m
""")


def get_latest(db: Session, mine: Mine) -> ReserveEstimate | None:
    return db.scalars(
        select(ReserveEstimate)
        .where(ReserveEstimate.mine_id == mine.id)
        .order_by(ReserveEstimate.computed_on.desc())
    ).first()


latest_reserve = get_latest


def estimate_reserve(db: Session, mine: Mine, cutoff=25.0, density=3.6, n_sim=100, seed=0):
    rows = db.execute(SQL, {"m": mine.id}).all()
    if len(rows) < 30:
        return None
    arr = np.array(rows, dtype=float)
    if len(arr) > 400:                                           # keep kriging fast for the MVP
        arr = arr[np.random.default_rng(seed).choice(len(arr), 400, replace=False)]
    x, y, z, g = arr.T

    # Use a spherical variogram with range=250m matching the geological lens extent
    sill = float(g.var()) if g.var() > 0 else 10.0
    ok = OrdinaryKriging3D(
        x, y, z, g,
        variogram_model="spherical",
        variogram_parameters=[sill, 250.0, 0.05],
        nlags=12
    )

    dx, dz = 35.0, 5.0
    gx = np.arange(x.min(), x.max() + dx, dx)
    gy = np.arange(y.min(), y.max() + dx, dx)
    gz = np.arange(z.min(), z.max() + dz, dz)

    gk, var = ok.execute("grid", gx, gy, gz)
    gk = np.asarray(gk)
    sd = np.sqrt(np.clip(np.asarray(var), 0, None))
    vol = dx * dx * dz

    rng = np.random.default_rng(seed)        # conditional block simulation
    sims = [((gk + rng.normal(0, 1, gk.shape) * sd) >= cutoff).sum() * vol * density for _ in range(n_sim)]
    p10, p50, p90 = np.percentile(sims, [10, 50, 90])
    ore = gk[gk >= cutoff]

    max_grade = float(ore.max()) if ore.size else cutoff + 10.0
    hist_y, hist_edges = np.histogram(ore, bins=10, range=(cutoff, max(cutoff + 10.0, max_grade)))
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


recompute = estimate_reserve
