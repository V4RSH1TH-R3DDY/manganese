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
    grade_hist_x: list[float]
    grade_hist_y: list[float]
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


class DrillHolePoint(BaseModel):
    id: int
    mine_code: str
    lat: float
    lon: float
    collar_z: float


class DepositPoint(BaseModel):
    dep_id: str
    site_name: str
    latitude: float
    longitude: float
    state: str
    dev_stat: str | None = None
    oper_type: str | None = None
    ore: str | None = None
    gangue: str | None = None
    host_rock: str | None = None


class IngestResponse(BaseModel):
    kind: str
    rows: int
    date_min: str
    date_max: str
    rows_holes: int | None = None
    rows_assays: int | None = None
