import re

with open("backend/app/api/v1/reserves.py", "r") as f:
    text = f.read()

rep = """def _out(m: Mine, e) -> ReserveOut:
    return ReserveOut(mine=m.code, p10_t=e.p10_t, p50_t=e.p50_t, p90_t=e.p90_t,
                      mean_grade=e.mean_grade, cutoff=e.cutoff,
                      grade_hist_x=e.grade_hist_x or [], grade_hist_y=e.grade_hist_y or [],
                      computed_on=e.computed_on)"""

text = re.sub(r'def _out\(m: Mine, e\) -> ReserveOut:.*?computed_on=e\.computed_on\)', rep, text, flags=re.DOTALL)
with open("backend/app/api/v1/reserves.py", "w") as f:
    f.write(text)

