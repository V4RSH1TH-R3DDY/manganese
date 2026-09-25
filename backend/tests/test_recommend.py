"""Regression tests for portability bugs that only show up on SQLite."""

import datetime as dt

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.models import EquipmentDaily


@pytest.fixture()
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/t.db")
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as s:
        yield s


def test_latest_breakdown_flag_is_the_newest_row(db):
    """PostgreSQL DISTINCT ON is *silently ignored* by SQLite, which made the
    'latest breakdown per unit' lookup return each unit's oldest row. A unit
    that broke down today then looked healthy, no slot ever freed up, and the
    redeploy optimiser could never propose a move."""
    for day, broken in ((1, False), (2, False), (3, True)):        # broke down on the 3rd
        db.add(EquipmentDaily(mine_id=1, unit_code="BLG-D2", date=dt.date(2026, 9, day),
                              available_hours=20, scheduled_hours=20, breakdown=broken))
    db.commit()

    ranked = select(
        EquipmentDaily.unit_code,
        EquipmentDaily.breakdown,
        func.row_number().over(partition_by=EquipmentDaily.unit_code,
                               order_by=EquipmentDaily.date.desc()).label("rn"),
    ).subquery()
    latest = {r.unit_code: bool(r.breakdown) for r in db.execute(
        select(ranked.c.unit_code, ranked.c.breakdown).where(ranked.c.rn == 1))}

    assert latest["BLG-D2"] is True
