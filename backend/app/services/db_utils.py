import datetime as dt

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models import DataProvenance


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


def set_provenance(db, source: str, mode: str, detail: str = ""):
    """Record where a data source came from: synthetic | live | uploaded.

    Plain get-or-create rather than a dialect-specific upsert, so this works on
    both SQLite (local dev) and PostGIS.
    """
    row = db.get(DataProvenance, source)
    if row is None:
        row = DataProvenance(source=source)
        db.add(row)
    row.mode, row.detail, row.updated_at = mode, detail[:200], dt.datetime.now()
    db.commit()
