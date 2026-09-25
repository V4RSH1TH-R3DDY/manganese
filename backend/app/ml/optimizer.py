import pulp as pl


def _solve(units, slots, value, allow_move, max_moves=None):
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
    if allow_move and max_moves is not None:
        # slots is a capacity cap, not a requirement, so without this the solver
        # happily evacuates a rained-out pit and permutes the whole fleet. Nobody
        # relocates seven dumpers for a three-day storm.
        prob += pl.lpSum(x[u["id"], m] for u in units for m in mines if m != u["home"]) <= max_moves

    for m in mines:
        prob += pl.lpSum(x[u["id"], m] for u in units) <= slots[m]
        # Transport constraint: dumpers >= excavators * 3
        dumper_expr = pl.lpSum(x[u["id"], m] for u in units if u.get("type", "dumper") == "dumper")
        excavator_expr = pl.lpSum(x[u["id"], m] for u in units if u.get("type", "") == "excavator")
        prob += dumper_expr >= excavator_expr * 3

    prob.solve(pl.PULP_CBC_CMD(msg=0))
    assign = {u["id"]: next((m for m in mines if (x[u["id"], m].value() or 0) > 0.5), None) for u in units}
    return assign, float(pl.value(prob.objective) or 0.0)


def redeploy(units, slots, weather_loss, equip_gap=None, horizon=7, transfer_loss=0.10,
             min_gain_t=100, max_moves=2):
    """units: [{id, home, tpd}] healthy only. slots: {mine: n units it needs}.
    weather_loss: {mine: 0..1} weather-only loss (equipment-neutral).
    equip_gap:    {mine: 0..1} share of output the mine is losing to missing or
                  broken equipment.

    Weather and equipment pull in opposite directions and must not be conflated:
    weather makes a unit *less* productive at a mine (you don't send a dumper
    into a storm), whereas an equipment gap means the mine has *unmet haulage
    demand*, so a marginal unit there is worth more. Valuing units on weather
    alone scores the obvious 'Balaghat is a dumper down' move at near zero.

    The gap bonus is linear, so it cancels for units already at home and only
    prices the unit that actually moves.
    """
    gap = equip_gap or {}

    def value(u, m):
        return (u["tpd"] * horizon * (1 - weather_loss[m]) * (1 + gap.get(m, 0.0))
                * (1 - (transfer_loss if m != u["home"] else 0.0)))

    _, base_obj = _solve(units, slots, value, allow_move=False)
    best, best_obj = _solve(units, slots, value, allow_move=True, max_moves=max_moves)
    gain = best_obj - base_obj
    if gain < min_gain_t:
        return {"moves": [], "expected_tonnes": 0.0}
    moves = [{"unit": u["id"], "from": u["home"], "to": best[u["id"]]}
             for u in units if best[u["id"]] not in (None, u["home"])]
    return {"moves": moves, "expected_tonnes": gain}
