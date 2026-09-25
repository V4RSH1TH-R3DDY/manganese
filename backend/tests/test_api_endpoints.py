import io
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
AUTH = {"X-API-Key": "change-me"}


def test_health_endpoint():
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "provenance" in data
    assert "model_loaded" in data


def test_list_mines():
    res = client.get("/api/v1/mines")
    assert res.status_code == 200
    mines = res.json()
    assert len(mines) >= 1
    codes = [m["code"] for m in mines]
    assert "DBZ" in codes or "BLG" in codes


def test_list_drillholes():
    res = client.get("/api/v1/mines/drillholes")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_risk_forecast():
    res = client.get("/api/v1/risk/DBZ?horizon=7")
    assert res.status_code == 200
    data = res.json()
    assert data["mine"] == "DBZ"
    assert data["horizon_days"] == 7
    assert "p_shortfall" in data
    assert "expected_loss_t" in data
    assert len(data["band"]) == 7


def test_reserves_get_and_recompute():
    res = client.get("/api/v1/reserves/DBZ")
    assert res.status_code == 200
    data = res.json()
    assert data["mine"] == "DBZ"
    assert "p50_t" in data
    assert "mean_grade" in data

    # Test recompute
    rec = client.post("/api/v1/reserves/DBZ/recompute?cutoff=25.0", headers=AUTH)
    assert rec.status_code == 200
    rec_data = rec.json()
    assert rec_data["cutoff"] == 25.0


def test_actions_list_and_refresh():
    res = client.get("/api/v1/actions")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_prospectivity_meta_and_deposits():
    res = client.get("/api/v1/prospectivity/meta")
    assert res.status_code == 200
    data = res.json()
    assert "tiles" in data
    assert "bounds" in data

    res_dep = client.get("/api/v1/prospectivity/deposits")
    assert res_dep.status_code == 200
    deps = res_dep.json()
    assert len(deps) > 0
    assert "dep_id" in deps[0]
    assert "site_name" in deps[0]


def test_drillhole_csv_ingest_and_deduplication():
    csv_data = """mine_code,hole_code,lat,lon,collar_z,from_m,to_m,mn_pct,fe_pct
DBZ,PYTEST_DH_01,21.548,79.682,350.0,0,5,32.5,8.1
DBZ,PYTEST_DH_01,21.548,79.682,350.0,5,10,34.0,7.5
"""
    res1 = client.post(
        "/api/v1/ingest/drillholes",
        files={"file": ("dh.csv", io.BytesIO(csv_data.encode()), "text/csv")},
        headers=AUTH,
    )
    assert res1.status_code == 200
    d1 = res1.json()
    assert d1["rows_assays"] == 2

    # Re-upload the same hole should update/replace rather than double-insert
    res2 = client.post(
        "/api/v1/ingest/drillholes",
        files={"file": ("dh.csv", io.BytesIO(csv_data.encode()), "text/csv")},
        headers=AUTH,
    )
    assert res2.status_code == 200
    d2 = res2.json()
    assert d2["rows_holes"] == 0  # Hole already existed
    assert d2["rows_assays"] == 2  # Replaced existing assays cleanly
