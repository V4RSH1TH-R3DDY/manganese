## 9. Stack and monorepo layout

**Design rules (they keep the build fast and the demo robust):**

1. **One feature builder** (`ml/features.py`) is used by both training and serving. No train/serve skew.
2. **Thin routers, fat services.** Routers validate and delegate; services hold logic; ML lives in `ml/`.
3. **Models are artifacts** (`*.joblib`), not code paths. Retraining never touches the API.
4. **Stateless API + TTL cache.** Scale by adding containers; nightly jobs precompute actions.
5. **`DATA_MODE=demo|live`.** Demo uses the synthetic generator; live uses real feeds and CSV ingest. The UI shows a "synthetic data" badge in demo mode.

**Module C refinement (supersedes the earlier synthetic generator and target):** train a *daily efficiency* model (`actual / planned`) and roll it forward over the weather forecast. This gives the fan chart directly. The generator below also makes equipment availability *persistent* (breakdown episodes last days), otherwise lagged availability carries no signal and the model can't learn equipment effects.

```
moil-copilot/
├─ docker-compose.yml  .env.example  Makefile
├─ data/{raw,features,interim,cogs}/
├─ backend/
│  ├─ Dockerfile  requirements.txt
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ core/{config.py, db.py, security.py}
│  │  ├─ models.py                    # SQLAlchemy ORM (split per table later)
│  │  ├─ schemas.py                   # Pydantic I/O contracts
│  │  ├─ api/v1/{router.py, deps.py, health.py, mines.py, risk.py,
│  │  │          reserves.py, actions.py, prospectivity.py, ingest.py}
│  │  ├─ services/{risk_service.py, reserve_service.py, recommend_service.py,
│  │  │            weather_service.py, db_utils.py}
│  │  ├─ ml/{features.py, dataset.py, registry.py, synth.py, optimizer.py}
│  │  └─ jobs/scheduler.py
│  ├─ scripts/{seed_synthetic.py, train_all.py, predict_raster.py}
│  ├─ artifacts/                      # shortfall.joblib, prospectivity.joblib
│  └─ tests/{test_optimizer.py, test_features.py}
└─ web/
   ├─ Dockerfile  nginx.conf  vite.config.ts  index.html
   └─ src/{main.tsx, App.tsx, index.css, store.ts,
           lib/{api.ts, format.ts},
           components/{MapView, FanChart, ActionCard, RiskBadge, Kpi, Insights}.tsx,
           pages/{Overview, Reserves, Actions, Ingest}.tsx}
```

---

## 10. Backend build (FastAPI + PostGIS)

### 10.1 Dependencies and config

`backend/requirements.txt`

```
fastapi
uvicorn[standard]
sqlalchemy>=2.0
psycopg[binary]
geoalchemy2
pydantic-settings
apscheduler
httpx
python-multipart
pandas
numpy
lightgbm
scikit-learn
shap
pykrige
pulp
joblib
cachetools
rasterio
rio-cogeo
pytest
```

`app/core/config.py`

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+psycopg://moil:moil@db:5432/moil"
    model_dir: str = "/app/artifacts"
    cog_path: str = "/data/cogs/prospectivity.tif"
    titiler_public_url: str = "http://localhost:8001"
    cors_origins: list[str] = ["http://localhost:5173"]
    open_meteo_url: str = "https://api.open-meteo.com/v1/forecast"
    data_mode: str = "demo"          # demo = synthetic data, live = real feeds
    api_key: str = "change-me"       # protects /ingest and /actions/refresh

settings = Settings()
```

`app/core/db.py` and `app/core/security.py`

```python
# db.py
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.core.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, autoflush=False, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

def get_db():
    with SessionLocal() as db:
        yield db
```

```python
# security.py
from fastapi import Header, HTTPException
from app.core.config import settings

def require_key(x_api_key: str = Header(default="")):
    if x_api_key != settings.api_key:
        raise HTTPException(401, "invalid API key")
```

### 10.2 Database schema (ORM)

`app/models.py`

```python
import datetime as dt
from geoalchemy2 import Geometry
from sqlalchemy import JSON, Boolean, Date, Float, ForeignKey, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base

class Mine(Base):
    __tablename__ = "mines"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    method: Mapped[str] = mapped_column(String(16))              # opencast | underground
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    plan_tpd: Mapped[float] = mapped_column(Float)
    boundary = mapped_column(Geometry("POLYGON", srid=4326), nullable=True)

class EquipmentUnit(Base):
    __tablename__ = "equipment_units"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(24), unique=True)
    type: Mapped[str] = mapped_column(String(24))                # dumper | excavator | drill
    home_mine_id: Mapped[int] = mapped_column(ForeignKey("mines.id"))
    tpd: Mapped[float] = mapped_column(Float)                    # tonnes/day capacity

class _Daily:
    id: Mapped[int] = mapped_column(primary_key=True)

class ProductionDaily(Base):
    __tablename__ = "production_daily"
    __table_args__ = (UniqueConstraint("mine_id", "date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[int] = mapped_column(ForeignKey("mines.id"), index=True)
    date: Mapped[dt.date] = mapped_column(Date)
    planned_t: Mapped[float] = mapped_column(Float)
    actual_t: Mapped[float] = mapped_column(Float)

class EquipmentDaily(Base):
    __tablename__ = "equipment_daily"
    __table_args__ = (UniqueConstraint("mine_id", "unit_code", "date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[int] = mapped_column(ForeignKey("mines.id"), index=True)
    unit_code: Mapped[str] = mapped_column(String(24), index=True)
    date: Mapped[dt.date] = mapped_column(Date)
    available_hours: Mapped[float] = mapped_column(Float)
    scheduled_hours: Mapped[float] = mapped_column(Float)
    breakdown: Mapped[bool] = mapped_column(Boolean, default=False)

class BlastLog(Base):
    __tablename__ = "blast_log"
    __table_args__ = (UniqueConstraint("mine_id", "date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[int] = mapped_column(ForeignKey("mines.id"), index=True)
    date: Mapped[dt.date] = mapped_column(Date)
    delayed: Mapped[bool] = mapped_column(Boolean, default=False)

class WeatherDaily(Base):
    __tablename__ = "weather_daily"
    __table_args__ = (UniqueConstraint("mine_id", "date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[int] = mapped_column(ForeignKey("mines.id"), index=True)
    date: Mapped[dt.date] = mapped_column(Date)
    rain_mm: Mapped[float] = mapped_column(Float)
    soil_moisture: Mapped[float | None] = mapped_column(Float, nullable=True)   # SMAP
    lst_c: Mapped[float | None] = mapped_column(Float, nullable=True)           # MODIS LST
    ndvi: Mapped[float | None] = mapped_column(Float, nullable=True)            # MODIS NDVI
    is_forecast: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))

class DrillHole(Base):
    __tablename__ = "drillholes"
    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[int] = mapped_column(ForeignKey("mines.id"), index=True)
    collar = mapped_column(Geometry("POINT", srid=4326))
    collar_z: Mapped[float] = mapped_column(Float)               # m above sea level

class Assay(Base):
    __tablename__ = "assays"
    id: Mapped[int] = mapped_column(primary_key=True)
    hole_id: Mapped[int] = mapped_column(ForeignKey("drillholes.id"), index=True)
    from_m: Mapped[float] = mapped_column(Float)
    to_m: Mapped[float] = mapped_column(Float)
    mn_pct: Mapped[float] = mapped_column(Float)
    fe_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

class ReserveEstimate(Base):
    __tablename__ = "reserve_estimates"
    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[int] = mapped_column(ForeignKey("mines.id"), index=True)
    computed_on: Mapped[dt.date] = mapped_column(Date)
    p10_t: Mapped[float] = mapped_column(Float)                  # pessimistic
    p50_t: Mapped[float] = mapped_column(Float)
    p90_t: Mapped[float] = mapped_column(Float)                  # optimistic
    mean_grade: Mapped[float] = mapped_column(Float)
    cutoff: Mapped[float] = mapped_column(Float)

class Action(Base):
    __tablename__ = "actions"
    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[int] = mapped_column(ForeignKey("mines.id"), index=True)
    issued_on: Mapped[dt.date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(24))                # blast_advance | maintenance | redeploy
    title: Mapped[str] = mapped_column(String(200))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    expected_tonnes: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="open")   # open | superseded | done
```

(Delete the unused `_Daily` stub if you copy this; it is just a reminder that all daily tables share `mine_id` + `date`.)

### 10.3 API schemas

`app/schemas.py`

```python
import datetime as dt
from typing import Literal
from pydantic import BaseModel

Level = Literal["green", "amber", "red"]

class BandPoint(BaseModel):
    date: dt.date
    planned: float
    q10: float
    q50: float
    q90: float
    rain_mm: float

class Driver(BaseModel):
    feature: str
    label: str
    impact_pct: float          # efficiency points lost (negative = drag)

class RiskOut(BaseModel):
    mine: str
    issued_on: dt.date
    horizon_days: int
    level: Level
    p_shortfall: float
    expected_shortfall_pct: float
    expected_loss_t: float
    band: list[BandPoint]
    drivers: list[Driver]
    signals: dict[str, float]  # avail_7, weather_pct, equipment_pct, ...

class ReserveOut(BaseModel):
    mine: str
    p10_t: float
    p50_t: float
    p90_t: float
    mean_grade: float
    cutoff: float
    computed_on: dt.date

class ActionOut(BaseModel):
    id: int
    mine: str
    kind: str
    title: str
    detail: dict
    expected_tonnes: float
    confidence: float
    status: str

class MineSummary(BaseModel):
    code: str
    name: str
    method: str
    lat: float
    lon: float
    level: Level
    expected_shortfall_pct: float
    reserve_p50_t: float | None
```

### 10.4 Synthetic generator, loader and shared feature builder

`app/ml/synth.py` (persistent availability so equipment effects are learnable)

```python
import numpy as np, pandas as pd

def simulate(days: pd.DatetimeIndex, plan: float, opencast: bool, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed); n = len(days)
    doy = days.dayofyear.values
    monsoon = np.exp(-((doy - 215) / 40) ** 2)
    rain = rng.gamma(0.4, 1, n) * (2 + 45 * monsoon)

    avail = np.full(n, 0.93)                                   # breakdown episodes last 3-10 days
    for i in np.where(rng.random(n) < 0.03)[0]:
        avail[i:i + rng.integers(3, 11)] -= rng.uniform(0.25, 0.5)
    avail = np.clip(avail + rng.normal(0, 0.02, n), 0.3, 1.0)

    d = pd.DataFrame({"date": days, "rain": rain, "avail": avail,
                      "blast_delay": (rng.random(n) < 0.08).astype(int)})
    soil = d.rain.ewm(alpha=0.15, adjust=False).mean() / 60
    wet = (0.35 * (soil > 0.25) + 0.25 * (d.rain.rolling(3, min_periods=1).sum() > 60)) * int(opencast)
    eff = 1 - wet - 0.6 * (1 - d.avail) - 0.15 * d.blast_delay
    d["planned"] = plan
    d["actual"] = plan * eff.clip(0.2, 1.05) * rng.normal(1, 0.05, n)
    return d
```

`app/ml/dataset.py`

```python
import pandas as pd
from sqlalchemy import text

SQL = text("""
SELECT w.date, w.rain_mm AS rain, w.is_forecast,
       p.planned_t AS planned, p.actual_t AS actual,
       e.avail, e.breakdown, b.blast_delay
FROM weather_daily w
LEFT JOIN production_daily p ON p.mine_id = w.mine_id AND p.date = w.date
LEFT JOIN (SELECT mine_id, date,
                  AVG(available_hours / NULLIF(scheduled_hours, 0)) AS avail,
                  SUM(breakdown::int) AS breakdown
           FROM equipment_daily GROUP BY mine_id, date) e
       ON e.mine_id = w.mine_id AND e.date = w.date
LEFT JOIN (SELECT mine_id, date, MAX(delayed::int) AS blast_delay
           FROM blast_log GROUP BY mine_id, date) b
       ON b.mine_id = w.mine_id AND b.date = w.date
WHERE w.mine_id = :mid AND w.date >= :start
ORDER BY w.date
""")

def load_frame(engine, mine_id: int, start="2000-01-01") -> pd.DataFrame:
    with engine.connect() as c:
        return pd.read_sql(SQL, c, params={"mid": mine_id, "start": start}, parse_dates=["date"])
```

`app/ml/features.py` (train and serve both call this)

```python
import numpy as np, pandas as pd

FEATS = ["rain_1", "rain_3", "rain_7", "rain_14", "soil_idx", "avail_1", "avail_7",
         "bd_30", "blast_14", "opencast", "doy_sin", "doy_cos", "monsoon"]
LABELS = {
    "rain_1": "Rainfall today", "rain_3": "3-day rainfall", "rain_7": "7-day rainfall",
    "rain_14": "14-day rainfall", "soil_idx": "Soil wetness (SMAP proxy)",
    "avail_1": "Equipment availability (last day)", "avail_7": "Equipment availability (7 d)",
    "bd_30": "Breakdowns (30 d)", "blast_14": "Blast delays (14 d)",
    "opencast": "Open-cast exposure", "doy_sin": "Season", "doy_cos": "Season",
    "monsoon": "Monsoon phase",
}

def build_features(d: pd.DataFrame, opencast: bool) -> pd.DataFrame:
    """d needs: date, rain, avail, breakdown, blast_delay, planned, actual.
    Future (forecast) rows have NaN ops columns; they are filled by persistence."""
    d = d.sort_values("date").reset_index(drop=True).copy()
    d["rain"] = d["rain"].fillna(0.0)
    d["avail"] = d["avail"].ffill().fillna(0.9)
    for c in ("breakdown", "blast_delay"):
        d[c] = d[c].fillna(0.0)
    d["rain_1"] = d.rain
    for w in (3, 7, 14):
        d[f"rain_{w}"] = d.rain.rolling(w, min_periods=1).sum()
    d["soil_idx"] = d.rain.ewm(alpha=0.15, adjust=False).mean()
    d["avail_1"] = d.avail.shift(1)
    d["avail_7"] = d.avail.shift(1).rolling(7, min_periods=1).mean()
    d["bd_30"] = d.breakdown.shift(1).rolling(30, min_periods=1).sum()
    d["blast_14"] = d.blast_delay.shift(1).rolling(14, min_periods=1).sum()
    d["opencast"] = int(opencast)
    doy = d.date.dt.dayofyear
    d["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    d["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)
    d["monsoon"] = np.exp(-((doy - 215) / 40) ** 2)
    return d
```

### 10.5 Training

`scripts/train_all.py`

```python
import joblib, numpy as np, pandas as pd, lightgbm as lgb
from pathlib import Path
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
    clf = lgb.LGBMClassifier(n_estimators=300, learning_rate=0.03, verbose=-1).fit(tr[FEATS], (tr.eff < 0.9).astype(int))

    p10, p50, p90 = (q[a].predict(va[FEATS]) for a in (0.1, 0.5, 0.9))
    print("pinball q50:", pinball(va.eff.values, p50, 0.5))
    print("coverage 10-90:", float(((va.eff >= p10) & (va.eff <= p90)).mean()), "(target ≈ 0.80)")
    Path(settings.model_dir).mkdir(parents=True, exist_ok=True)
    joblib.dump({"q": q, "clf": clf, "feats": FEATS}, Path(settings.model_dir) / "shortfall.joblib")

if __name__ == "__main__":
    main()
```

### 10.6 Model registry and risk service

`app/ml/registry.py`

```python
from functools import lru_cache
from pathlib import Path
import joblib, shap
from app.core.config import settings

@lru_cache(maxsize=8)
def load(name: str):
    return joblib.load(Path(settings.model_dir) / f"{name}.joblib")

@lru_cache(maxsize=1)
def explainer():
    return shap.TreeExplainer(load("shortfall")["q"][0.5])
```

`app/services/risk_service.py`

```python
import datetime as dt
from threading import Lock
import numpy as np, pandas as pd
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
    q = {a: bundle["q"][a].predict(X).clip(0.0, 1.1) for a in (0.1, 0.5, 0.9)}
    q10, q50, q90 = np.minimum(q[0.1], q[0.5]), q[0.5], np.maximum(q[0.9], q[0.5])
    plan = fut.planned.to_numpy()

    # Counterfactual: same weather, equipment fully available -> splits weather vs equipment loss
    Xw = X.copy(); Xw["avail_1"] = 1.0; Xw["avail_7"] = 1.0
    eff_w = bundle["q"][0.5].predict(Xw).clip(0, 1.1)

    loss_t = float((plan - q50 * plan).sum())
    short_pct = 100 * loss_t / float(plan.sum())

    # SHAP on the worst forecast day: what drags efficiency down
    sv = registry.explainer().shap_values(X)[int(np.argmin(q50))]
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
```

### 10.7 Reserve service (kriging)

`app/services/reserve_service.py`

```python
import datetime as dt
import numpy as np
from pykrige.ok3d import OrdinaryKriging3D
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from app.models import Mine, ReserveEstimate

SQL = text("""
SELECT ST_X(ST_Transform(h.collar, 32644)) AS x, ST_Y(ST_Transform(h.collar, 32644)) AS y,
       h.collar_z - (a.from_m + a.to_m) / 2 AS z, a.mn_pct AS g
FROM assays a JOIN drillholes h ON h.id = a.hole_id WHERE h.mine_id = :m
""")   # EPSG:32644 = UTM 44N, covers the Nagpur-Bhandara-Balaghat belt

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
    rng = np.random.default_rng(seed)                            # independent-block noise: optimistic (narrow) range
    sims = [((gk + rng.normal(0, 1, gk.shape) * sd) >= cutoff).sum() * vol * density for _ in range(n_sim)]
    p10, p50, p90 = np.percentile(sims, [10, 50, 90])
    ore = gk[gk >= cutoff]
    est = ReserveEstimate(mine_id=mine.id, computed_on=dt.date.today(), p10_t=float(p10), p50_t=float(p50),
                          p90_t=float(p90), mean_grade=float(ore.mean()) if ore.size else 0.0, cutoff=cutoff)
    db.add(est); db.commit()
    return est

def latest_reserve(db: Session, mine: Mine):
    return db.scalars(select(ReserveEstimate).where(ReserveEstimate.mine_id == mine.id)
                      .order_by(ReserveEstimate.computed_on.desc(), ReserveEstimate.id.desc())).first()
```

Kriging errors treated as independent per block give a *narrower* range than a proper conditional simulation. Say "approximate P10–P90" on the slide.

### 10.8 Recommender: rules, optimizer, what-if

`app/ml/optimizer.py`

```python
import pulp as pl

def _solve(units, slots, value, allow_move):
    prob = pl.LpProblem("redeploy", pl.LpMaximize)
    mines = list(slots)
    x = {(u["id"], m): pl.LpVariable(f"x_{u['id']}_{m}", cat="Binary") for u in units for m in mines}
    prob += pl.lpSum(x[u["id"], m] * value(u, m) for u in units for m in mines)
    for u in units:
        prob += pl.lpSum(x[u["id"], m] for m in mines) <= 1
        if not allow_move:
            for m in mines:
                if m != u["home"]:
                    prob += x[u["id"], m] == 0
    for m in mines:
        prob += pl.lpSum(x[u["id"], m] for u in units) <= slots[m]
    prob.solve(pl.PULP_CBC_CMD(msg=0))
    assign = {u["id"]: next((m for m in mines if (x[u["id"], m].value() or 0) > 0.5), None) for u in units}
    return assign, float(pl.value(prob.objective) or 0.0)

def redeploy(units, slots, weather_loss, horizon=7, transfer_loss=0.10, min_gain_t=100):
    """units: [{id, home, tpd}] healthy only. slots: {mine: n units it needs}.
    weather_loss: {mine: 0..1} weather-only loss (equipment-neutral)."""
    def value(u, m):
        return u["tpd"] * horizon * (1 - weather_loss[m]) * (1 - (transfer_loss if m != u["home"] else 0.0))
    _, base_obj = _solve(units, slots, value, allow_move=False)
    best, best_obj = _solve(units, slots, value, allow_move=True)
    gain = best_obj - base_obj
    if gain < min_gain_t:
        return {"moves": [], "expected_tonnes": 0.0}
    moves = [{"unit": u["id"], "from": u["home"], "to": best[u["id"]]}
             for u in units if best[u["id"]] not in (None, u["home"])]
    return {"moves": moves, "expected_tonnes": gain}
```

`app/services/recommend_service.py`

```python
import datetime as dt
import numpy as np
from sqlalchemy import select, update
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
                    "steps": ["Bring forward the next 2 blast rounds", "Build a 2-day ROM stockpile at the pit head",
                              "Pre-position pumps at the sump and clear haul-road drains"]}))
    if r.signals["avail_7"] < 0.80:
        lost = r.expected_loss_t * 0.30
        out.append(dict(
            kind="maintenance", confidence=conf, expected_tonnes=lost,
            title="Pull forward preventive maintenance on low-availability fleet",
            detail={"days": None, "recovered_frac": 0.30,
                    "steps": ["Service units flagged by 7-day availability drop", "Schedule on the lowest-load shift",
                              "Hold spares for the top-3 failure modes"]}))
    return out

def redeploy_actions(db: Session, mines: list[Mine], risks: dict[str, RiskOut]) -> list[dict]:
    by_id = {m.id: m for m in mines}
    units_db = db.scalars(select(EquipmentUnit)).all()
    latest = {r[0]: r[1] for r in db.execute(
        select(EquipmentDaily.unit_code, EquipmentDaily.breakdown)
        .distinct(EquipmentDaily.unit_code)
        .order_by(EquipmentDaily.unit_code, EquipmentDaily.date.desc()))}
    units = [dict(id=u.code, home=by_id[u.home_mine_id].code, tpd=u.tpd)
             for u in units_db if not latest.get(u.code, False)]
    slots = {m.code: sum(1 for u in units_db if u.home_mine_id == m.id) for m in mines}
    wloss = {m.code: risks[m.code].signals["weather_pct"] / 100 for m in mines}
    res = redeploy(units, slots, wloss, horizon=7)
    if not res["moves"]:
        return []
    dest = max({mv["to"] for mv in res["moves"]}, key=lambda c: risks[c].expected_loss_t)
    dest_mine = next(m for m in mines if m.code == dest)
    frac = min(0.8, res["expected_tonnes"] / max(risks[dest].expected_loss_t, 1.0))
    return [dict(mine_id=dest_mine.id, kind="redeploy", confidence=_confidence(risks[dest]),
                 expected_tonnes=res["expected_tonnes"],
                 title=f"Redeploy {len(res['moves'])} healthy unit(s) to {dest_mine.name}",
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
```

### 10.9 Ingestion, weather job, scheduler

`app/services/db_utils.py`

```python
from sqlalchemy.dialects.postgresql import insert as pg_insert

def upsert(db, Model, rows: list[dict], keys: list[str], cols: list[str] | None = None):
    if not rows:
        return
    cols_ = cols or [c for c in rows[0] if c not in keys]
    for i in range(0, len(rows), 5000):
        stmt = pg_insert(Model).values(rows[i:i + 5000])
        upd = {c: stmt.excluded[c] for c in cols_}
        db.execute(stmt.on_conflict_do_update(index_elements=keys, set_=upd) if upd
                   else stmt.on_conflict_do_nothing())
    db.commit()
```

`app/services/weather_service.py`

```python
import datetime as dt
import httpx
from sqlalchemy import select
from app.core.config import settings
from app.core.db import SessionLocal
from app.models import Mine, WeatherDaily
from app.services import risk_service
from app.services.db_utils import upsert

def refresh_weather():
    today = dt.date.today()
    with SessionLocal() as db:
        for m in db.scalars(select(Mine)):
            r = httpx.get(settings.open_meteo_url, timeout=20, params={
                "latitude": m.lat, "longitude": m.lon, "daily": "precipitation_sum",
                "past_days": 7, "forecast_days": 14, "timezone": "Asia/Kolkata"}).json()["daily"]
            rows = [dict(mine_id=m.id, date=dt.date.fromisoformat(d), rain_mm=v or 0.0,
                         is_forecast=dt.date.fromisoformat(d) > today)
                    for d, v in zip(r["time"], r["precipitation_sum"])]
            upsert(db, WeatherDaily, rows, ["mine_id", "date"])
    risk_service.cache.clear()
```

`app/jobs/scheduler.py`

```python
import datetime as dt
from apscheduler.schedulers.background import BackgroundScheduler
from app.core.config import settings
from app.core.db import SessionLocal
from app.services.recommend_service import generate_all
from app.services.weather_service import refresh_weather

def score_job():
    try:
        with SessionLocal() as db:
            print("actions generated:", generate_all(db))
    except Exception as e:                                       # empty DB / no model yet
        print("score_job skipped:", e)

def start_scheduler() -> BackgroundScheduler:
    s = BackgroundScheduler(timezone="Asia/Kolkata")
    if settings.data_mode == "live":
        s.add_job(refresh_weather, "cron", hour=5, minute=30)
    s.add_job(score_job, "cron", hour=6)
    s.add_job(score_job, "date", run_date=dt.datetime.now() + dt.timedelta(seconds=10))   # warm start
    s.start()
    return s
```

### 10.10 Routers and app entrypoint

`app/api/v1/deps.py`, `mines.py`, `risk.py`, `reserves.py`

```python
# deps.py
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models import Mine

def get_mine(code: str, db: Session = Depends(get_db)) -> Mine:
    m = db.scalars(select(Mine).where(Mine.code == code)).first()
    if not m:
        raise HTTPException(404, f"unknown mine {code}")
    return m
```

```python
# mines.py
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models import Mine
from app.schemas import MineSummary
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
```

```python
# risk.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.v1.deps import get_mine
from app.core.db import get_db
from app.models import Mine
from app.schemas import RiskOut
from app.services.risk_service import compute_risk

router = APIRouter(prefix="/risk", tags=["risk"])

@router.get("/{code}", response_model=RiskOut)
def get_risk(horizon: int = Query(7, ge=1, le=14), mine: Mine = Depends(get_mine), db: Session = Depends(get_db)):
    return compute_risk(db, mine, horizon)
```

```python
# reserves.py
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
                      mean_grade=e.mean_grade, cutoff=e.cutoff, computed_on=e.computed_on)

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
```

`actions.py`

```python
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

@router.post("/refresh", dependencies=[Depends(require_key)])
def refresh(db: Session = Depends(get_db)):
    return {"actions": generate_all(db)}

@router.post("/{action_id}/simulate", response_model=RiskOut)
def simulate_action(action_id: int, horizon: int = 7, db: Session = Depends(get_db)):
    a = db.get(Action, action_id)
    if not a:
        raise HTTPException(404, "unknown action")
    return simulate(compute_risk(db, db.get(Mine, a.mine_id), horizon), a)
```

`ingest.py`

```python
import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models as M
from app.core.db import get_db
from app.core.security import require_key
from app.services import risk_service
from app.services.db_utils import upsert

router = APIRouter(prefix="/ingest", tags=["ingest"], dependencies=[Depends(require_key)])

SPECS = {   # kind: (Model, required CSV columns, conflict keys)
    "production": (M.ProductionDaily, ["mine_code", "date", "planned_t", "actual_t"], ["mine_id", "date"]),
    "weather":    (M.WeatherDaily, ["mine_code", "date", "rain_mm"], ["mine_id", "date"]),
    "blasts":     (M.BlastLog, ["mine_code", "date", "delayed"], ["mine_id", "date"]),
    "equipment":  (M.EquipmentDaily, ["mine_code", "unit_code", "date", "available_hours",
                                      "scheduled_hours", "breakdown"], ["mine_id", "unit_code", "date"]),
}

@router.post("/{kind}")
def ingest(kind: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if kind not in SPECS:
        raise HTTPException(404, f"kind must be one of {list(SPECS)}")
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
    risk_service.cache.clear()
    return {"kind": kind, "rows": len(rows), "date_min": str(df["date"].min()), "date_max": str(df["date"].max())}
```

`prospectivity.py`, `health.py`, `router.py`

```python
# prospectivity.py
from pathlib import Path
import rasterio
from fastapi import APIRouter, HTTPException
from rasterio.warp import transform_bounds
from app.core.config import settings

router = APIRouter(prefix="/prospectivity", tags=["prospectivity"])

@router.get("/meta")
def meta():
    if not Path(settings.cog_path).exists():
        raise HTTPException(404, "prospectivity COG not built yet (run scripts/predict_raster.py)")
    with rasterio.open(settings.cog_path) as src:
        b = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
    # TiTiler route differs slightly across versions; check http://localhost:8001/docs
    tiles = (f"{settings.titiler_public_url}/cog/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}.png"
             f"?url={settings.cog_path}&rescale=0,1&colormap_name=inferno")
    return {"tiles": tiles, "bounds": list(b)}
```

```python
# health.py
from pathlib import Path
from fastapi import APIRouter
from app.core.config import settings

router = APIRouter(tags=["health"])

@router.get("/health")
def health():
    return {"status": "ok", "data_mode": settings.data_mode,
            "model_loaded": (Path(settings.model_dir) / "shortfall.joblib").exists()}
```

```python
# router.py
from fastapi import APIRouter
from app.api.v1 import actions, health, ingest, mines, prospectivity, reserves, risk

api_router = APIRouter()
for r in (health.router, mines.router, risk.router, reserves.router,
          actions.router, prospectivity.router, ingest.router):
    api_router.include_router(r)
```

`app/main.py`

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app import models  # noqa: F401  (registers tables)
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.db import Base, engine
from app.jobs.scheduler import start_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    with engine.begin() as c:
        c.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    Base.metadata.create_all(engine)
    sched = start_scheduler()
    yield
    sched.shutdown(wait=False)

app = FastAPI(title="MOIL Manganese Copilot API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])
app.include_router(api_router, prefix="/api/v1")
```

### 10.11 Seed script (demo data with a scripted storm)

`scripts/seed_synthetic.py`

```python
import argparse, datetime as dt
import numpy as np, pandas as pd
from sqlalchemy import func, text
from app import models as M
from app.core.db import Base, SessionLocal, engine
from app.ml.synth import simulate

# PLACEHOLDERS: verify mine names, methods, coordinates and plan figures against MOIL annual reports
MINES = [("KDR", "Kandri", "opencast", 21.32, 79.30, 1500),
         ("MNS", "Mansar", "opencast", 21.30, 79.36, 1200),
         ("DBZ", "Dongri Buzurg", "opencast", 21.35, 79.60, 1000),
         ("BLG", "Balaghat", "underground", 21.80, 80.20, 900),
         ("CHK", "Chikla", "underground", 21.42, 79.68, 800)]

def seed_drillholes(db, mine, rng):
    cx, cy = db.execute(text("SELECT ST_X(p), ST_Y(p) FROM (SELECT ST_Transform(ST_SetSRID("
                             "ST_MakePoint(:lon, :lat), 4326), 32644) AS p) t"),
                        {"lon": mine.lon, "lat": mine.lat}).one()
    amp, top = rng.uniform(38, 50), 350.0
    for ix in range(-4, 4):
        for iy in range(-4, 4):
            x, y = cx + ix * 100, cy + iy * 100
            h = M.DrillHole(mine_id=mine.id, collar_z=top,
                            collar=func.ST_Transform(func.ST_SetSRID(func.ST_MakePoint(x, y), 32644), 4326))
            db.add(h); db.flush()
            for d0 in range(0, 120, 5):
                z = top - d0 - 2.5
                g = amp * np.exp(-((x - cx) / 350) ** 2 - ((y - cy) / 250) ** 2 - ((z - (top - 60)) / 18) ** 2)
                db.add(M.Assay(hole_id=h.id, from_m=d0, to_m=d0 + 5, mn_pct=float(np.clip(g + rng.normal(0, 1.5), 0.5, 55))))

def main(storm: bool):
    with engine.begin() as c:
        c.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    Base.metadata.drop_all(engine); Base.metadata.create_all(engine)         # demo reset
    today = dt.date.today()
    days = pd.date_range("2022-04-01", today + dt.timedelta(days=14))
    rng = np.random.default_rng(7)
    with SessionLocal() as db:
        for i, (code, name, method, lat, lon, plan) in enumerate(MINES):
            mine = M.Mine(code=code, name=name, method=method, lat=lat, lon=lon, plan_tpd=plan)
            db.add(mine); db.flush()
            d = simulate(days, plan, method == "opencast", seed=i)
            if storm:                                                        # scripted demo storm: D+3..D+5
                for k, mm in zip((3, 4, 5), (30, 55, 40)):
                    d.loc[d.date == pd.Timestamp(today + dt.timedelta(days=k)), "rain"] += mm
            hist = d[d.date <= pd.Timestamp(today)].reset_index(drop=True)
            pd.DataFrame({"mine_id": mine.id, "date": d.date.dt.date, "rain_mm": d.rain,
                          "is_forecast": d.date > pd.Timestamp(today)}).to_sql(
                "weather_daily", engine, if_exists="append", index=False, method="multi", chunksize=5000)
            pd.DataFrame({"mine_id": mine.id, "date": hist.date.dt.date,
                          "planned_t": hist.planned, "actual_t": hist.actual}).to_sql(
                "production_daily", engine, if_exists="append", index=False, method="multi", chunksize=5000)
            blast = hist[(hist.blast_delay == 1) | (rng.random(len(hist)) < 0.3)]
            pd.DataFrame({"mine_id": mine.id, "date": blast.date.dt.date,
                          "delayed": blast.blast_delay.astype(bool)}).to_sql(
                "blast_log", engine, if_exists="append", index=False, method="multi", chunksize=5000)
            for k in range(4):
                u = M.EquipmentUnit(code=f"{code}-D{k + 1}", type="dumper", home_mine_id=mine.id, tpd=plan / 4)
                db.add(u)
                av = np.clip(hist.avail + rng.normal(0, 0.03, len(hist)), 0.2, 1.0)
                if code == "BLG" and k == 1:
                    av.iloc[-1] = 0.3                                         # force a broken unit today (redeploy demo)
                pd.DataFrame({"mine_id": mine.id, "unit_code": u.code, "date": hist.date.dt.date,
                              "available_hours": 20 * av, "scheduled_hours": 20.0, "breakdown": av < 0.7}).to_sql(
                    "equipment_daily", engine, if_exists="append", index=False, method="multi", chunksize=5000)
            seed_drillholes(db, mine, rng)
            db.commit()
    print("seeded. next: python -m scripts.train_all")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--storm", action="store_true")
    main(ap.parse_args().storm)
```

Storm rain adds to future rows only, so it affects the forecast and the demo but not the training history.

### 10.12 Raster serving glue (prospectivity → COG → map)

`scripts/predict_raster.py`

```python
from pathlib import Path
import joblib, numpy as np, rasterio
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles

model = joblib.load("artifacts/prospectivity.joblib")                    # trained in Module A
paths = sorted(Path("data/features").glob("*.tif"))                     # co-registered, same grid, same order as FEATURES
arrs = [rasterio.open(p).read(1).astype("float32") for p in paths]
prof = rasterio.open(paths[0]).profile
X = np.stack([a.ravel() for a in arrs], axis=1)
prob = model.predict_proba(X)[:, 1].reshape(arrs[0].shape).astype("float32")
prob[np.isnan(arrs[0])] = -1
prof.update(count=1, dtype="float32", nodata=-1)
with rasterio.open("data/interim/prosp_raw.tif", "w", **prof) as dst:
    dst.write(prob, 1)
cog_translate("data/interim/prosp_raw.tif", "data/cogs/prospectivity.tif", cog_profiles.get("deflate"))
```

Export the feature rasters from GEE on one shared grid (same CRS, scale, extent) so the stack aligns.

### 10.13 Docker, env, Makefile, tests

`docker-compose.yml`

```yaml
services:
  db:
    image: postgis/postgis:16-3.4
    environment: { POSTGRES_USER: moil, POSTGRES_PASSWORD: moil, POSTGRES_DB: moil }
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U moil"], interval: 5s, retries: 10 }
  api:
    build: ./backend
    env_file: .env
    depends_on: { db: { condition: service_healthy } }
    volumes: ["./backend/artifacts:/app/artifacts", "./data/cogs:/data/cogs"]
    ports: ["8000:8000"]
  titiler:
    image: ghcr.io/developmentseed/titiler:latest
    volumes: ["./data/cogs:/data/cogs:ro"]
    ports: ["8001:8000"]
  web:
    build: ./web
    ports: ["5173:80"]
volumes: { pgdata: {} }
```

`backend/Dockerfile`

```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`.env.example`

```
DATABASE_URL=postgresql+psycopg://moil:moil@db:5432/moil
DATA_MODE=demo
API_KEY=change-me
TITILER_PUBLIC_URL=http://localhost:8001
CORS_ORIGINS=["http://localhost:5173"]
```

`Makefile`

```make
up:     ; docker compose up -d db
seed:   ; docker compose run --rm api python -m scripts.seed_synthetic --storm
train:  ; docker compose run --rm api python -m scripts.train_all
run:    ; docker compose up -d api titiler web
score:  ; curl -X POST localhost:8000/api/v1/actions/refresh -H "X-API-Key: change-me"
test:   ; docker compose run --rm api pytest -q
```

`tests/test_optimizer.py` and `tests/test_features.py`

```python
# test_optimizer.py
from app.ml.optimizer import redeploy

def test_spare_unit_moves_to_open_slot():
    units = [dict(id="a1", home="A", tpd=100), dict(id="b1", home="B", tpd=100), dict(id="b2", home="B", tpd=100)]
    res = redeploy(units, slots={"A": 2, "B": 1}, weather_loss={"A": 0.1, "B": 0.5}, horizon=7)
    assert len(res["moves"]) == 1 and res["moves"][0]["to"] == "A"
    assert res["expected_tonnes"] > 0
```

```python
# test_features.py
import pandas as pd
from app.ml.features import FEATS, build_features

def test_future_rows_use_persistence():
    n_known, n_fut = 30, 10
    df = pd.DataFrame({
        "date": pd.date_range("2026-01-01", periods=n_known + n_fut), "rain": 1.0,
        "avail": [0.9] * n_known + [None] * n_fut, "breakdown": [0] * n_known + [None] * n_fut,
        "blast_delay": [0] * n_known + [None] * n_fut, "planned": 1000.0,
        "actual": [900.0] * n_known + [None] * n_fut})
    f = build_features(df, True)
    assert set(FEATS) <= set(f.columns)
    assert f.loc[35, "avail_1"] == 0.9
```

### 10.14 API contract

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Status, `data_mode`, model loaded |
| GET | `/api/v1/mines` | Mine list with risk level, shortfall %, reserve P50 |
| GET | `/api/v1/risk/{code}?horizon=7` | Daily fan band, drivers, weather-vs-equipment split |
| GET | `/api/v1/reserves/{code}` | P10/P50/P90 tonnes, mean grade |
| POST | `/api/v1/reserves/{code}/recompute` | Re-run kriging (API key) |
| GET | `/api/v1/actions?mine=` | Open recommendations, ranked by expected tonnes |
| POST | `/api/v1/actions/{id}/simulate?horizon=7` | What-if forecast after applying the action |
| POST | `/api/v1/actions/refresh` | Regenerate actions (API key) |
| GET | `/api/v1/prospectivity/meta` | Tile URL template + bounds for the map |
| POST | `/api/v1/ingest/{production\|weather\|blasts\|equipment}` | CSV upload with validation and upsert (API key) |

FastAPI auto-docs at `http://localhost:8000/docs` double as your live API demo.

---

## 11. Frontend build (React + MapLibre + ECharts)

**Goal:** a control-room dashboard that tells one story in 10 seconds: *where the ore is, where output is at risk this week, what to do about it, and what it's worth.*

**Impact features (build these, they win demos):**

1. **What-if simulator:** "Simulate impact" on any action redraws the forecast with a green "after action" line and shows tonnes recovered.
2. **Weather vs equipment split:** counterfactual attribution bar, so managers see *why* output drops.
3. **Explainable drivers:** top SHAP drags in plain English.
4. **Map-first layout:** satellite basemap, prospectivity heat layer, mine markers colored by risk.
5. **Data adapter page:** drag-and-drop CSV upload with validation. Proves the tool works on MOIL's real data.
6. **Honesty badge** ("synthetic demo data") plus a one-click **Export brief** (print-to-PDF).

### 11.1 Setup

```bash
npm create vite@latest web -- --template react-ts && cd web
npm i maplibre-gl echarts echarts-for-react @tanstack/react-query zustand react-router-dom
npm i tailwindcss @tailwindcss/vite
```

`vite.config.ts`

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({ plugins: [react(), tailwindcss()] });
```

`src/index.css`

```css
@import "tailwindcss";
:root { color-scheme: dark; }
body { background: #020617; color: #f1f5f9; font-family: ui-sans-serif, system-ui, sans-serif; }
@media print { body { background: #fff; color: #000; } }
```

### 11.2 Data layer and state

`src/lib/api.ts`

```ts
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";
export const API_KEY = import.meta.env.VITE_API_KEY ?? "change-me";

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export type Level = "green" | "amber" | "red";
export interface BandPoint { date: string; planned: number; q10: number; q50: number; q90: number; rain_mm: number }
export interface Driver { feature: string; label: string; impact_pct: number }
export interface Risk {
  mine: string; issued_on: string; horizon_days: number; level: Level; p_shortfall: number;
  expected_shortfall_pct: number; expected_loss_t: number; band: BandPoint[]; drivers: Driver[];
  signals: Record<string, number>;
}
export interface Reserve { mine: string; p10_t: number; p50_t: number; p90_t: number; mean_grade: number; cutoff: number; computed_on: string }
export interface Action { id: number; mine: string; kind: string; title: string; detail: Record<string, unknown>; expected_tonnes: number; confidence: number; status: string }
export interface MineSummary { code: string; name: string; method: string; lat: number; lon: number; level: Level; expected_shortfall_pct: number; reserve_p50_t: number | null }

export const api = {
  health: () => j<{ status: string; data_mode: string; model_loaded: boolean }>("/health"),
  mines: () => j<MineSummary[]>("/mines"),
  risk: (mine: string, h = 7) => j<Risk>(`/risk/${mine}?horizon=${h}`),
  reserves: (mine: string) => j<Reserve>(`/reserves/${mine}`),
  actions: (mine?: string) => j<Action[]>(`/actions${mine ? `?mine=${mine}` : ""}`),
  simulate: (id: number, h = 7) => j<Risk>(`/actions/${id}/simulate?horizon=${h}`, { method: "POST" }),
  prospectivity: () => j<{ tiles: string; bounds: [number, number, number, number] }>("/prospectivity/meta"),
  ingest: (kind: string, file: File) => {
    const fd = new FormData(); fd.append("file", file);
    return j<{ kind: string; rows: number; date_min: string; date_max: string }>(
      `/ingest/${kind}`, { method: "POST", body: fd, headers: { "X-API-Key": API_KEY } });
  },
};
```

`src/lib/format.ts` and `src/store.ts`

```ts
// format.ts
export const fmtT = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)} Mt` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kt` : `${Math.round(n)} t`;
export const LEVEL_HEX = { green: "#22c55e", amber: "#f59e0b", red: "#ef4444" } as const;
```

```ts
// store.ts
import { create } from "zustand";
import type { Risk } from "./lib/api";

interface State {
  mine: string; horizon: 7 | 14; sim: Risk | null;
  setMine: (m: string) => void; setHorizon: (h: 7 | 14) => void; setSim: (r: Risk | null) => void;
}
export const useStore = create<State>((set) => ({
  mine: "", horizon: 7, sim: null,
  setMine: (mine) => set({ mine }), setHorizon: (horizon) => set({ horizon }), setSim: (sim) => set({ sim }),
}));
```

### 11.3 Components

`components/RiskBadge.tsx` and `components/Kpi.tsx`

```tsx
// RiskBadge.tsx
import type { Level } from "../lib/api";
const C: Record<Level, string> = {
  green: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  amber: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  red: "bg-red-500/15 text-red-300 ring-red-500/40",
};
export default function RiskBadge({ level }: { level: Level }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ring-1 ${C[level]}`}>{level}</span>;
}
```

```tsx
// Kpi.tsx
export default function Kpi({ label, value, sub, tone = "text-slate-100" }:
  { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
```

`components/FanChart.tsx` (plan vs expected with P10–P90 band, rain bars from the top, optional "after action" line)

```tsx
import ReactECharts from "echarts-for-react";
import type { BandPoint } from "../lib/api";

export default function FanChart({ band, after }: { band: BandPoint[]; after?: BandPoint[] }) {
  const axis = { axisLabel: { color: "#94a3b8" } };
  const option = {
    backgroundColor: "transparent",
    grid: { left: 52, right: 44, top: 32, bottom: 28 },
    legend: { top: 0, textStyle: { color: "#94a3b8" }, data: ["Plan", "Expected", "After action", "Rain (mm)"] },
    tooltip: {
      trigger: "axis",
      formatter: (p: any) => {
        const b = band[p[0].dataIndex];
        const a = after?.[p[0].dataIndex];
        return `${b.date}<br/>Plan ${b.planned.toFixed(0)} t<br/>Expected ${b.q50.toFixed(0)} t`
          + `<br/>Range ${b.q10.toFixed(0)}–${b.q90.toFixed(0)} t<br/>Rain ${b.rain_mm.toFixed(0)} mm`
          + (a ? `<br/><b style="color:#22c55e">After action ${a.q50.toFixed(0)} t</b>` : "");
      },
    },
    xAxis: { type: "category", data: band.map((b) => b.date.slice(5)), ...axis },
    yAxis: [
      { type: "value", name: "t/day", ...axis, splitLine: { lineStyle: { color: "#1e293b" } },
        min: (v: { min: number }) => Math.floor(v.min * 0.85) },
      { type: "value", inverse: true, max: (v: { max: number }) => Math.max(80, v.max * 2.2),
        ...axis, splitLine: { show: false } },
    ],
    series: [
      { name: "_base", type: "line", stack: "band", data: band.map((b) => b.q10), symbol: "none", lineStyle: { opacity: 0 } },
      { name: "_band", type: "line", stack: "band", data: band.map((b) => b.q90 - b.q10), symbol: "none",
        lineStyle: { opacity: 0 }, areaStyle: { color: "rgba(245,158,11,0.22)" } },
      { name: "Rain (mm)", type: "bar", yAxisIndex: 1, data: band.map((b) => b.rain_mm),
        itemStyle: { color: "rgba(56,189,248,0.45)" }, barWidth: "40%" },
      { name: "Plan", type: "line", data: band.map((b) => b.planned), symbol: "none",
        lineStyle: { type: "dashed", color: "#94a3b8" } },
      { name: "Expected", type: "line", smooth: true, data: band.map((b) => b.q50), symbol: "circle",
        lineStyle: { color: "#f59e0b", width: 3 }, itemStyle: { color: "#f59e0b" } },
      ...(after ? [{ name: "After action", type: "line", smooth: true, data: after.map((b) => b.q50),
        symbol: "circle", lineStyle: { color: "#22c55e", width: 3 }, itemStyle: { color: "#22c55e" } }] : []),
    ],
  };
  return <ReactECharts option={option} notMerge style={{ height: 320 }} />;
}
```

`components/MapView.tsx` (satellite basemap, prospectivity raster, risk-colored mines, fly-to)

```tsx
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MineSummary } from "../lib/api";
import { fmtT } from "../lib/format";

interface Props {
  mines: MineSummary[]; selected: string; onSelect: (code: string) => void;
  prospectivity?: { tiles: string; bounds: [number, number, number, number] }; showProsp: boolean;
}
const COLOR = ["match", ["get", "level"], "red", "#ef4444", "amber", "#f59e0b", "#22c55e"] as any;

export default function MapView({ mines, selected, onSelect, prospectivity, showProsp }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const minesRef = useRef(mines); minesRef.current = mines;

  useEffect(() => {                                            // create map once
    const m = new maplibregl.Map({
      container: el.current!, center: [79.8, 21.5], zoom: 7.4,
      style: { version: 8,
        sources: { sat: { type: "raster", tileSize: 256, attribution: "Imagery © Esri",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] } },
        layers: [{ id: "sat", type: "raster", source: "sat" }] },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.current = m;
    return () => m.remove();
  }, []);

  useEffect(() => {                                            // prospectivity raster
    const m = map.current; if (!m || !prospectivity) return;
    const apply = () => {
      if (!m.getSource("prosp")) {
        m.addSource("prosp", { type: "raster", tiles: [prospectivity.tiles], tileSize: 256, bounds: prospectivity.bounds });
        m.addLayer({ id: "prosp", type: "raster", source: "prosp", paint: { "raster-opacity": 0.65 } },
          m.getLayer("mines-halo") ? "mines-halo" : undefined);
      }
      m.setLayoutProperty("prosp", "visibility", showProsp ? "visible" : "none");
    };
    m.isStyleLoaded() ? apply() : m.once("load", apply);
  }, [prospectivity, showProsp]);

  useEffect(() => {                                            // mine markers
    const m = map.current; if (!m) return;
    const fc: any = { type: "FeatureCollection", features: mines.map((x) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [x.lon, x.lat] },
      properties: { code: x.code, name: x.name, level: x.level, pct: x.expected_shortfall_pct, res: x.reserve_p50_t } })) };
    const apply = () => {
      const src = m.getSource("mines") as maplibregl.GeoJSONSource | undefined;
      if (src) { src.setData(fc); return; }
      m.addSource("mines", { type: "geojson", data: fc });
      m.addLayer({ id: "mines-halo", type: "circle", source: "mines", paint: { "circle-radius": 20, "circle-color": COLOR, "circle-opacity": 0.28 } });
      m.addLayer({ id: "mines-dot", type: "circle", source: "mines",
        paint: { "circle-radius": 8, "circle-color": COLOR, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
      m.on("click", "mines-dot", (e) => {
        const p = e.features![0].properties as any;
        onSelect(p.code);
        new maplibregl.Popup({ closeButton: false }).setLngLat((e.features![0].geometry as any).coordinates)
          .setHTML(`<b>${p.name}</b><br/>Shortfall ${Number(p.pct).toFixed(1)}%${p.res ? `<br/>Reserve P50 ${fmtT(Number(p.res))}` : ""}`).addTo(m);
      });
      m.on("mouseenter", "mines-dot", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "mines-dot", () => (m.getCanvas().style.cursor = ""));
    };
    m.isStyleLoaded() ? apply() : m.once("load", apply);
  }, [mines, onSelect]);

  useEffect(() => {                                            // fly to + highlight selection
    const m = map.current, s = minesRef.current.find((x) => x.code === selected);
    if (!m || !s) return;
    m.flyTo({ center: [s.lon, s.lat], zoom: 9.5, duration: 900 });
    if (m.getLayer("mines-dot"))
      m.setPaintProperty("mines-dot", "circle-stroke-width", ["case", ["==", ["get", "code"], selected], 4, 1.5]);
  }, [selected]);

  return <div ref={el} className="h-[420px] w-full overflow-hidden rounded-2xl border border-slate-800" />;
}
```

`components/ActionCard.tsx`

```tsx
import { useMutation } from "@tanstack/react-query";
import { api, type Action, type Risk } from "../lib/api";
import { fmtT } from "../lib/format";

const ICON: Record<string, string> = { blast_advance: "💥", maintenance: "🔧", redeploy: "🚜" };

export default function ActionCard({ a, horizon = 7, onResult }:
  { a: Action; horizon?: number; onResult?: (r: Risk) => void }) {
  const sim = useMutation({ mutationFn: () => api.simulate(a.id, horizon), onSuccess: (r) => onResult?.(r) });
  const steps = (a.detail.steps as string[] | undefined) ?? [];
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-start gap-3">
        <span className="text-xl">{ICON[a.kind] ?? "⚙️"}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold leading-snug">{a.title}</h4>
            <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{a.mine}</span>
          </div>
          <p className="mt-1 text-sm text-emerald-300">+{fmtT(a.expected_tonnes)} expected recovery</p>
          {steps.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-400">{steps.map((s) => <li key={s}>{s}</li>)}</ul>
          )}
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 w-24 rounded bg-slate-800">
              <div className="h-1.5 rounded bg-sky-400" style={{ width: `${a.confidence * 100}%` }} />
            </div>
            <span className="text-xs text-slate-400">{Math.round(a.confidence * 100)}% confidence</span>
            {onResult && (
              <button onClick={() => sim.mutate()} disabled={sim.isPending}
                className="ml-auto rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 print:hidden">
                {sim.isPending ? "Simulating…" : "Simulate impact"}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
```

`components/Insights.tsx` (loss split + drivers)

```tsx
import type { Driver } from "../lib/api";

export function LossSplit({ weather, equipment }: { weather: number; equipment: number }) {
  const total = Math.max(weather + equipment, 0.01);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Why output drops</div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-800">
        <div className="bg-sky-400" style={{ width: `${(weather / total) * 100}%` }} />
        <div className="bg-amber-400" style={{ width: `${(equipment / total) * 100}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-400">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-400" />Weather {weather.toFixed(1)}%</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />Equipment {equipment.toFixed(1)}%</span>
      </div>
    </div>
  );
}

export function Drivers({ items }: { items: Driver[] }) {
  const max = Math.max(...items.map((d) => Math.abs(d.impact_pct)), 1);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Top drags on output</div>
      {items.length === 0 && <p className="text-sm text-slate-500">No significant risk drivers.</p>}
      {items.map((d) => (
        <div key={d.label} className="mb-2">
          <div className="flex justify-between text-sm"><span>{d.label}</span><span className="text-red-300">{d.impact_pct}%</span></div>
          <div className="h-1.5 rounded bg-slate-800"><div className="h-1.5 rounded bg-red-400" style={{ width: `${(Math.abs(d.impact_pct) / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
```

### 11.4 Pages

`pages/Overview.tsx` (the hero screen)

```tsx
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtT, LEVEL_HEX } from "../lib/format";
import { useStore } from "../store";
import ActionCard from "../components/ActionCard";
import FanChart from "../components/FanChart";
import { Drivers, LossSplit } from "../components/Insights";
import Kpi from "../components/Kpi";
import MapView from "../components/MapView";
import RiskBadge from "../components/RiskBadge";

export default function Overview() {
  const { mine, horizon, sim, setMine, setHorizon, setSim } = useStore();
  const [showProsp, setShowProsp] = useState(true);

  const mines = useQuery({ queryKey: ["mines"], queryFn: api.mines, refetchInterval: 60_000 });
  const risk = useQuery({ queryKey: ["risk", mine, horizon], queryFn: () => api.risk(mine, horizon), enabled: !!mine });
  const reserve = useQuery({ queryKey: ["reserve", mine], queryFn: () => api.reserves(mine), enabled: !!mine, retry: false });
  const actions = useQuery({ queryKey: ["actions", mine], queryFn: () => api.actions(mine), enabled: !!mine });
  const prosp = useQuery({ queryKey: ["prosp"], queryFn: api.prospectivity, retry: false });

  useEffect(() => { if (!mine && mines.data?.length) setMine(mines.data[0].code); }, [mine, mines.data, setMine]);
  useEffect(() => { setSim(null); }, [mine, horizon, setSim]);          // reset what-if on context change

  const r = sim ?? risk.data;
  const recovered = sim && risk.data ? risk.data.expected_loss_t - sim.expected_loss_t : 0;
  const redMines = mines.data?.filter((m) => m.level === "red") ?? [];

  return (
    <div className="space-y-4">
      {redMines.length > 0 && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          ⚠ High shortfall risk this week: <b>{redMines.map((m) => m.name).join(", ")}</b>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {mines.data?.map((m) => (
          <button key={m.code} onClick={() => setMine(m.code)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${mine === m.code ? "border-sky-400 bg-sky-400/10" : "border-slate-700 hover:border-slate-500"}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: LEVEL_HEX[m.level] }} />{m.name}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-sm text-slate-400">
            <input type="checkbox" checked={showProsp} onChange={(e) => setShowProsp(e.target.checked)} /> Prospectivity
          </label>
          {([7, 14] as const).map((h) => (
            <button key={h} onClick={() => setHorizon(h)}
              className={`rounded-lg px-3 py-1 text-sm ${horizon === h ? "bg-sky-500 text-slate-950" : "bg-slate-800 text-slate-300"}`}>{h}d</button>
          ))}
          <button onClick={() => window.print()} className="rounded-lg bg-slate-800 px-3 py-1 text-sm text-slate-300 hover:bg-slate-700">Export brief</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <section className="lg:col-span-7 print:hidden">
          {mines.data && <MapView mines={mines.data} selected={mine} onSelect={setMine} prospectivity={prosp.data} showProsp={showProsp} />}
        </section>
        <section className="space-y-3 lg:col-span-5">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{mines.data?.find((m) => m.code === mine)?.name ?? "…"}</h2>
            {r && <RiskBadge level={r.level} />}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Expected shortfall" value={r ? `${r.expected_shortfall_pct.toFixed(1)}%` : "…"}
                 sub={`next ${horizon} days`} tone={sim ? "text-emerald-300" : "text-amber-300"} />
            <Kpi label="Tonnes at risk" value={r ? fmtT(r.expected_loss_t) : "…"} sub="vs plan" />
            <Kpi label="P(shortfall > 10%)" value={risk.data ? `${Math.round(risk.data.p_shortfall * 100)}%` : "…"} />
            <Kpi label="Reserve P50" value={reserve.data ? fmtT(reserve.data.p50_t) : "n/a"}
                 sub={reserve.data ? `${fmtT(reserve.data.p10_t)} – ${fmtT(reserve.data.p90_t)}` : "no drill data"} />
          </div>
          {risk.data && <LossSplit weather={risk.data.signals.weather_pct} equipment={risk.data.signals.equipment_pct} />}
          {risk.data && <Drivers items={risk.data.drivers} />}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 lg:col-span-7">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Production forecast</h3>
            {sim && (
              <div className="flex items-center gap-2 text-sm text-emerald-300">
                What-if active · +{fmtT(recovered)} recovered
                <button onClick={() => setSim(null)} className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">Reset</button>
              </div>
            )}
          </div>
          {risk.data ? <FanChart band={risk.data.band} after={sim?.band} /> : <div className="h-80 animate-pulse rounded bg-slate-800/50" />}
        </section>
        <section className="space-y-3 lg:col-span-5">
          <h3 className="font-semibold">Recommended actions</h3>
          {actions.data?.length === 0 && <p className="text-sm text-slate-500">No action needed: forecast within plan.</p>}
          {actions.data?.map((a) => <ActionCard key={a.id} a={a} horizon={horizon} onResult={setSim} />)}
        </section>
      </div>
    </div>
  );
}
```

`pages/Reserves.tsx`

```tsx
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { api } from "../lib/api";
import { fmtT } from "../lib/format";

export default function Reserves() {
  const mines = useQuery({ queryKey: ["mines"], queryFn: api.mines });
  const rows = useQuery({
    queryKey: ["reserves-all", mines.data?.length], enabled: !!mines.data,
    queryFn: async () => (await Promise.all(mines.data!.map((m) => api.reserves(m.code).catch(() => null)))).filter(Boolean),
  });
  const d = rows.data ?? [];
  const ax = { axisLabel: { color: "#94a3b8" } };
  const option = {
    backgroundColor: "transparent", tooltip: { trigger: "axis" }, legend: { textStyle: { color: "#94a3b8" } },
    grid: { left: 60, right: 16, top: 36, bottom: 28 },
    xAxis: { type: "category", data: d.map((r) => r!.mine), ...ax },
    yAxis: { type: "value", name: "tonnes", ...ax, splitLine: { lineStyle: { color: "#1e293b" } } },
    series: [["P10 (pessimistic)", "p10_t", "#64748b"], ["P50", "p50_t", "#38bdf8"], ["P90 (optimistic)", "p90_t", "#22c55e"]]
      .map(([name, key, color]) => ({ name, type: "bar", itemStyle: { color }, data: d.map((r: any) => Math.round(r[key])) })),
  };
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Reserve estimates (kriging, approximate P10–P90)</h2>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4"><ReactECharts option={option} style={{ height: 360 }} /></div>
      <table className="w-full text-left text-sm">
        <thead className="text-slate-400"><tr><th>Mine</th><th>P10</th><th>P50</th><th>P90</th><th>Mean ore grade</th><th>Cut-off</th></tr></thead>
        <tbody>{d.map((r: any) => (
          <tr key={r.mine} className="border-t border-slate-800">
            <td className="py-2">{r.mine}</td><td>{fmtT(r.p10_t)}</td><td>{fmtT(r.p50_t)}</td><td>{fmtT(r.p90_t)}</td>
            <td>{r.mean_grade.toFixed(1)}% Mn</td><td>{r.cutoff}% Mn</td></tr>))}
        </tbody>
      </table>
    </div>
  );
}
```

`pages/Actions.tsx` and `pages/Ingest.tsx`

```tsx
// Actions.tsx
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import ActionCard from "../components/ActionCard";

export default function Actions() {
  const q = useQuery({ queryKey: ["actions", "all"], queryFn: () => api.actions() });
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">All recommended actions (ranked by expected tonnes)</h2>
      <div className="grid gap-3 md:grid-cols-2">{q.data?.map((a) => <ActionCard key={a.id} a={a} />)}</div>
    </div>
  );
}
```

```tsx
// Ingest.tsx  (the "works on MOIL's real data" proof)
import { useState } from "react";
import { api } from "../lib/api";

const KINDS = {
  production: "mine_code,date,planned_t,actual_t",
  weather: "mine_code,date,rain_mm",
  blasts: "mine_code,date,delayed",
  equipment: "mine_code,unit_code,date,available_hours,scheduled_hours,breakdown",
} as const;

export default function Ingest() {
  const [kind, setKind] = useState<keyof typeof KINDS>("production");
  const [msg, setMsg] = useState("");
  const upload = async (f?: File) => {
    if (!f) return;
    setMsg("Uploading…");
    try { const r = await api.ingest(kind, f); setMsg(`✓ ${r.rows} rows loaded (${r.date_min} → ${r.date_max}). Forecasts refreshed.`); }
    catch (e) { setMsg(`✗ ${(e as Error).message}`); }
  };
  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">Data adapter: bring your own MOIL data</h2>
      <select value={kind} onChange={(e) => setKind(e.target.value as any)} className="rounded bg-slate-800 px-3 py-2">
        {Object.keys(KINDS).map((k) => <option key={k}>{k}</option>)}
      </select>
      <p className="text-sm text-slate-400">Required columns: <code className="text-sky-300">{KINDS[kind]}</code></p>
      <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files[0]); }}
        className="flex h-40 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-slate-600 text-slate-400 hover:border-sky-400">
        Drop CSV here or click to choose
        <input type="file" accept=".csv" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </label>
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
```

### 11.5 App shell

`src/main.tsx` and `src/App.tsx`

```tsx
// main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })}>
      <BrowserRouter><App /></BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

```tsx
// App.tsx
import { NavLink, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./lib/api";
import Actions from "./pages/Actions";
import Ingest from "./pages/Ingest";
import Overview from "./pages/Overview";
import Reserves from "./pages/Reserves";

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm ${isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"}`;

export default function App() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 60_000 });
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-4">
      <header className="mb-4 flex items-center gap-3 print:hidden">
        <div className="text-lg font-bold">⛏ MOIL Manganese Copilot</div>
        <nav className="flex gap-1">
          <NavLink to="/" end className={link}>Command center</NavLink>
          <NavLink to="/reserves" className={link}>Reserves</NavLink>
          <NavLink to="/actions" className={link}>Actions</NavLink>
          <NavLink to="/ingest" className={link}>Data adapter</NavLink>
        </nav>
        {health.data?.data_mode === "demo" && (
          <span className="ml-auto rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/40">
            SYNTHETIC DEMO DATA
          </span>
        )}
      </header>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/reserves" element={<Reserves />} />
        <Route path="/actions" element={<Actions />} />
        <Route path="/ingest" element={<Ingest />} />
      </Routes>
    </div>
  );
}
```

`web/Dockerfile` and `web/nginx.conf`

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=http://localhost:8000/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  location / { try_files $uri /index.html; }   # SPA fallback
}
```

### 11.6 UX polish checklist

- **Loading and empty states:** skeleton blocks (already in the chart), friendly "no action needed" text.
- **Auto-refresh:** mines list polls every 60 s; risk/actions refetch on mine change.
- **Keyboard:** `j`/`k` to step through mines (one `keydown` listener in `Overview`).
- **Colour-blind safe:** risk is always colour *and* text (`RED`/`AMBER`/`GREEN` badge).
- **Mobile:** grids collapse under `lg`; map height fixed at 420 px.
- **Print:** `Export brief` hides nav and map (`print:hidden`) and prints KPIs, chart, actions as a one-page brief.
- **Error surfaces:** every `useQuery` error should render a small red inline message (wrap in a shared `<QueryState>` if time allows).

---

## 12. Run order (first working demo in ~30 minutes)

```bash
cp .env.example .env
make up                 # PostGIS
make seed               # synthetic history + 14-day forecast with a scripted storm + drill holes
make train              # trains shortfall.joblib, prints pinball loss + 10–90 coverage
make run                # api :8000, titiler :8001, web :5173
curl -X POST localhost:8000/api/v1/reserves/BLG/recompute -H "X-API-Key: change-me"   # repeat per mine
make score              # generate actions
# open http://localhost:5173
```

Checks: `/docs` loads; `GET /api/v1/mines` returns 5 mines; the storm mines show amber/red; the Kandri/Mansar/Dongri cards show a "blast advance" action; Balaghat shows a redeploy action (its broken unit is forced in the seed).

**Tuning to make the demo land:** if the redeploy action doesn't fire, lower `min_gain_t` or `transfer_loss` in `optimizer.redeploy`. If nothing is red, raise the storm rainfall in `seed_synthetic.py`.

---

## 13. Timeline (10 days; 36-hour cut below)

| Days | Data/ML track | Backend track | Frontend track |
|---|---|---|---|
| 1–2 | Bhukosh registration, GEE pipeline, synthetic generator | Repo, docker-compose, ORM models, seed script | Vite + Tailwind scaffold, API client, layout shell |
| 3–4 | Prospectivity features + model; shortfall training | `features.py`, `train_all.py`, risk service + endpoints | MapView (satellite + markers), KPI cards |
| 5–6 | Kriging on synthetic drill holes; COG raster export | Reserve service, recommender, optimizer, ingest | FanChart, Drivers, LossSplit |
| 7–8 | Backtests, calibration, SHAP sanity checks | Scheduler, actions API, simulate endpoint, tests | ActionCard + what-if, Reserves, Ingest page |
| 9 | Freeze models, numbers for slides | Hardening, `/docs`, error handling | Polish, print brief, responsive pass |
| 10 | Demo script, slides, fallback recording | Seed + reset scripts | Final bug-bash |

**36-hour cut:** seed data → train shortfall model → `/mines`, `/risk`, `/actions` → Overview page with map, KPIs, fan chart, simulate button. Cover reserves with a single pre-computed kriging result and skip the ingest page.

**Split by role:** (1) geospatial/space pipeline + prospectivity, (2) ML + optimizer + services, (3) API/DB/DevOps, (4) frontend.

---

## 14. Demo script (2 minutes)

1. **Open Command center.** Point at the SYNTHETIC DEMO DATA badge and say the data adapter is ready for MOIL's real CSVs.
2. **Map:** toggle the prospectivity layer over satellite imagery ("space tech finds where to drill").
3. **Click a mine:** reserve P10/P50/P90 ("drill data says how much").
4. **Read the red banner:** storm in 3 days; the fan chart shows rain bars and a widening band; the loss-split bar shows the drop is weather-driven.
5. **Click "Simulate impact"** on *Advance blasting and pre-stock ore*: the green line lifts and the header reads "+X t recovered". **This is the money shot.**
6. **Switch to Balaghat:** show the redeploy action (broken unit, spare capacity elsewhere).
7. **Open Data adapter, drop a CSV:** forecasts refresh live.
8. **End on Export brief.** The one-page PDF is what a shift manager would actually use.
