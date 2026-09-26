"""Precompute what the dashboard reads: kriged reserves for every mine, then ranked actions.

Runs against the database directly, so it does not need the API to be up.
Equivalent to POST /reserves/{code}/recompute for each mine + POST /actions/refresh.
"""

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import Mine
from app.services.recommend_service import generate_all
from app.services.reserve_service import estimate_reserve


def main():
    with SessionLocal() as db:
        for m in db.scalars(select(Mine).order_by(Mine.code)):
            r = estimate_reserve(db, m)
            print(f"  kriged {m.code}: " + (f"P50 {r.p50_t / 1e6:.2f} Mt" if r else "not enough assay data"))
        print(f"  actions generated: {generate_all(db)}")


if __name__ == "__main__":
    main()
