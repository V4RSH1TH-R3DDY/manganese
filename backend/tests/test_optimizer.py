from app.ml.optimizer import redeploy


def test_spare_unit_moves_to_open_slot():
    units = [dict(id="a1", home="A", tpd=100), dict(id="b1", home="B", tpd=100),
             dict(id="b2", home="B", tpd=100)]
    res = redeploy(units, slots={"A": 2, "B": 1}, weather_loss={"A": 0.1, "B": 0.5}, horizon=7)
    assert len(res["moves"]) == 1 and res["moves"][0]["to"] == "A"
    assert res["expected_tonnes"] > 0


def test_equipment_gap_makes_a_marginal_unit_worth_moving():
    """A mine that is short of haulage should attract a unit even when the
    weather differential alone is too small to clear min_gain_t."""
    units = [dict(id="a1", home="A", tpd=250), dict(id="a2", home="A", tpd=250),
             dict(id="b1", home="B", tpd=250)]
    slots = {"A": 2, "B": 2}                      # B has a free slot: a unit broke down
    wl = {"A": 0.18, "B": 0.07}

    assert redeploy(units, slots, wl, horizon=7)["moves"] == []          # weather alone: not worth it
    res = redeploy(units, slots, wl, equip_gap={"A": 0.0, "B": 0.13}, horizon=7)
    assert [m["to"] for m in res["moves"]] == ["B"]
    assert res["expected_tonnes"] > 100


def test_no_move_when_gain_is_small():
    units = [dict(id="a1", home="A", tpd=100), dict(id="b1", home="B", tpd=100)]
    res = redeploy(units, slots={"A": 2, "B": 2}, weather_loss={"A": 0.1, "B": 0.1}, horizon=7)
    assert res["moves"] == [] and res["expected_tonnes"] == 0.0
