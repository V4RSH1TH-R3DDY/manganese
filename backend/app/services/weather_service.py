import datetime as dt
import logging

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal
from app.models import Mine, WeatherDaily
from app.services import risk_service
from app.services.db_utils import set_provenance, upsert

logger = logging.getLogger(__name__)


def fetch_archive(lat: float, lon: float, start: dt.date, end: dt.date) -> dict[dt.date, float]:
    """Real daily rainfall from the ERA5 reanalysis via Open-Meteo's archive API.

    Keyless and free. ERA5 lags ~5 days, so callers should stop `end` short of
    today and cover the tail with fetch_forecast().
    """
    try:
        r = httpx.get(settings.open_meteo_archive_url, timeout=30, params={
            "latitude": lat, "longitude": lon,
            "start_date": start.isoformat(), "end_date": end.isoformat(),
            "daily": "precipitation_sum", "timezone": "Asia/Kolkata"}).json().get("daily", {})
        times = r.get("time", [])
        precips = r.get("precipitation_sum", [])
        return {dt.date.fromisoformat(d): (v or 0.0) for d, v in zip(times, precips)}
    except Exception as e:
        logger.warning(f"Failed to fetch ERA5 archive weather for ({lat}, {lon}): {e}")
        return {}


def fetch_forecast(lat: float, lon: float, past_days: int = 7,
                   forecast_days: int = 14) -> dict[dt.date, float]:
    try:
        r = httpx.get(settings.open_meteo_url, timeout=15, params={
            "latitude": lat, "longitude": lon, "daily": "precipitation_sum",
            "past_days": past_days, "forecast_days": forecast_days,
            "timezone": "Asia/Kolkata"}).json().get("daily", {})
        times = r.get("time", [])
        precips = r.get("precipitation_sum", [])
        return {dt.date.fromisoformat(d): (v or 0.0) for d, v in zip(times, precips)}
    except Exception as e:
        logger.warning(f"Failed to fetch live Open-Meteo forecast for ({lat}, {lon}): {e}")
        return {}


def real_rain_series(lat: float, lon: float, days) -> list[float]:
    """Continuous real rainfall over `days`: ERA5 history spliced to the live
    forecast, with the forecast winning the overlap."""
    start, end = days[0].date(), days[-1].date()
    cutoff = dt.date.today() - dt.timedelta(days=7)
    series: dict[dt.date, float] = {}
    if start < cutoff:
        series.update(fetch_archive(lat, lon, start, min(cutoff, end)))
    series.update(fetch_forecast(lat, lon, past_days=7,
                                 forecast_days=max(1, (end - dt.date.today()).days)))
    return [series.get(d.date(), 0.0) for d in days]


def refresh_weather():
    today = dt.date.today()
    with SessionLocal() as db:
        success = False
        for m in db.scalars(select(Mine)):
            try:
                r = httpx.get(settings.open_meteo_url, timeout=15, params={
                    "latitude": m.lat, "longitude": m.lon, "daily": "precipitation_sum",
                    "past_days": 7, "forecast_days": 14, "timezone": "Asia/Kolkata"}).json().get("daily", {})
                times = r.get("time", [])
                precips = r.get("precipitation_sum", [])
                if times and precips:
                    rows = [dict(mine_id=m.id, date=dt.date.fromisoformat(d), rain_mm=v or 0.0,
                                 is_forecast=dt.date.fromisoformat(d) > today)
                            for d, v in zip(times, precips)]
                    upsert(db, WeatherDaily, rows, ["mine_id", "date"])
                    success = True
            except Exception as e:
                logger.warning(f"Could not refresh live weather for mine {m.code}: {e}")
        if success:
            set_provenance(db, "weather", "live",
                           f"Open-Meteo, refreshed {dt.datetime.now():%Y-%m-%d %H:%M}")
            risk_service.cache.clear()
