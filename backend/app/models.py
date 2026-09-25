"""SQLAlchemy ORM. All daily tables share (mine_id, date) as their natural key."""

import datetime as dt


from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    String,
    UniqueConstraint,
    text,
)
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
    


class EquipmentUnit(Base):
    __tablename__ = "equipment_units"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(24), unique=True)
    type: Mapped[str] = mapped_column(String(24))                # dumper | excavator | drill
    home_mine_id: Mapped[int] = mapped_column(ForeignKey("mines.id"))
    tpd: Mapped[float] = mapped_column(Float)                    # tonnes/day capacity


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
    collar_lat: Mapped[float] = mapped_column(Float)
    collar_lon: Mapped[float] = mapped_column(Float)
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
    grade_hist_x: Mapped[list[float]] = mapped_column(JSON, default=list)
    grade_hist_y: Mapped[list[float]] = mapped_column(JSON, default=list)


class DataProvenance(Base):
    """Per-source record of where the data actually came from.

    Drives the honesty badge in the UI. A single DATA_MODE flag is not enough:
    weather can be live while ops data is still synthetic, and claiming
    otherwise is the "overclaiming" risk called out in the build plan.
    """

    __tablename__ = "data_provenance"
    source: Mapped[str] = mapped_column(String(24), primary_key=True)   # weather | production | equipment | blasts
    mode: Mapped[str] = mapped_column(String(16))                       # synthetic | live | uploaded
    detail: Mapped[str] = mapped_column(String(200), default="")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime)


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
