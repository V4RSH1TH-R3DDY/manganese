import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { api, type Reserve } from "../lib/api";
import { fmtT } from "../lib/format";
import { QueryError } from "../components/Insights";

const AXIS = { axisLabel: { color: "#737373", fontSize: 11 }, axisLine: { lineStyle: { color: "#262626" } } };
const HEAD = "text-[10px] uppercase tracking-[0.15em] text-neutral-500";

export default function Reserves() {
  const queryClient = useQueryClient();
  const mines = useQuery({ queryKey: ["mines"], queryFn: api.mines });
  const [selectedMineCode, setSelectedMineCode] = useState<string | null>(null);
  const [cutoffVal, setCutoffVal] = useState<number>(25.0);

  const rows = useQuery({
    queryKey: ["reserves-all", mines.data?.length],
    enabled: !!mines.data,
    queryFn: async () => (await Promise.all(mines.data!.map((m) => api.reserves(m.code).catch(() => null)))).filter(Boolean) as Reserve[],
  });

  const recompute = useMutation({
    mutationFn: ({ code, cutoff }: { code: string; cutoff: number }) => api.recomputeReserve(code, cutoff),
    onSuccess: (updated) => {
      queryClient.setQueryData<Reserve[]>(["reserves-all", mines.data?.length], (old) =>
        old ? old.map((r) => (r.mine === updated.mine ? updated : r)) : [updated]
      );
      queryClient.invalidateQueries({ queryKey: ["mines"] });
    },
  });

  const d = rows.data ?? [];
  const activeCode = selectedMineCode ?? (d.length > 0 ? d[0].mine : null);
  const selectedMine = d.find((r) => r.mine === activeCode) ?? (d.length > 0 ? d[0] : null);

  useEffect(() => {
    if (selectedMine) {
      setCutoffVal(selectedMine.cutoff);
    }
  }, [selectedMine?.mine]);

  const option: any = {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", backgroundColor: "#0a0a0a", borderColor: "#404040", borderWidth: 1,
      textStyle: { color: "#e5e5e5", fontSize: 12 } },
    legend: { itemWidth: 10, itemHeight: 10, textStyle: { color: "#737373", fontSize: 11 } },
    grid: { left: 60, right: 16, top: 36, bottom: 28 },
    xAxis: { type: "category", data: d.map((r) => r.mine), ...AXIS },
    yAxis: { type: "value", name: "tonnes", nameTextStyle: { color: "#737373", fontSize: 11 }, ...AXIS,
      splitLine: { lineStyle: { color: "#1c1c1c" } } },
    series: [["P10 (pessimistic)", "p10_t", "#525252"], ["P50", "p50_t", "#38bdf8"], ["P90 (optimistic)", "p90_t", "#22c55e"]]
      .map(([name, key, color]) => ({ name, type: "bar", itemStyle: { color }, data: d.map((r: any) => Math.round(r[key])) })),
  };

  const onChartClick = (params: any) => {
    if (params && params.name) {
      setSelectedMineCode(params.name);
    }
  };

  const histOption: any = selectedMine ? {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", backgroundColor: "#0a0a0a", borderColor: "#404040", borderWidth: 1,
      textStyle: { color: "#e5e5e5", fontSize: 12 } },
    title: { text: `Grade distribution (${selectedMine.mine} @ ≥${selectedMine.cutoff}% Mn)`, textStyle: { color: "#737373", fontSize: 12, fontWeight: "normal" } },
    grid: { left: 60, right: 16, top: 36, bottom: 28 },
    xAxis: { type: "category", data: selectedMine.grade_hist_x.map((x: number) => x.toFixed(1) + "%"), ...AXIS, name: "Mn %",
      nameTextStyle: { color: "#737373", fontSize: 11 } },
    yAxis: { type: "value", name: "tonnes", nameTextStyle: { color: "#737373", fontSize: 11 }, ...AXIS,
      splitLine: { lineStyle: { color: "#1c1c1c" } } },
    series: [{ type: "bar", data: selectedMine.grade_hist_y, itemStyle: { color: "#8b5cf6" }, barWidth: "90%" }],
  } : {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium">Reserve estimates <span className="text-neutral-500">(3D Ordinary Kriging, approximate P10–P90)</span></h2>
        {selectedMine && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-400">Mine: <b className="text-neutral-200">{selectedMine.mine}</b></span>
            <label className="flex items-center gap-1.5 text-neutral-400">
              Cut-off:
              <input
                type="number"
                min="10"
                max="45"
                step="1"
                value={cutoffVal}
                onChange={(e) => setCutoffVal(parseFloat(e.target.value) || 25.0)}
                className="w-14 border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-center text-neutral-200"
              />
              % Mn
            </label>
            <button
              onClick={() => recompute.mutate({ code: selectedMine.mine, cutoff: cutoffVal })}
              disabled={recompute.isPending}
              className="border border-neutral-700 px-2.5 py-1 font-medium uppercase tracking-[0.1em] text-neutral-300 hover:border-neutral-500 hover:text-white disabled:opacity-50"
            >
              {recompute.isPending ? "Kriging…" : "Recompute 3D Kriging"}
            </button>
          </div>
        )}
      </div>

      <QueryError error={mines.error ?? rows.error ?? recompute.error} what="reserves" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border border-neutral-800 p-4">
          <ReactECharts
            option={option}
            style={{ height: 360 }}
            onEvents={{ click: onChartClick }}
          />
        </div>
        <div className="border border-neutral-800 p-4">
          <ReactECharts option={histOption} style={{ height: 360 }} />
        </div>
      </div>

      <table className="w-full text-left text-sm">
        <thead className={HEAD}>
          <tr className="border-b border-neutral-800">
            <th className="py-2 font-medium">Mine</th><th className="font-medium">P10</th><th className="font-medium">P50</th>
            <th className="font-medium">P90</th><th className="font-medium">Mean ore grade</th><th className="font-medium">Cut-off</th>
            <th className="text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody className="tabular-nums text-neutral-300">
          {d.map((r) => {
            const isSelected = r.mine === (selectedMine?.mine ?? "");
            return (
              <tr
                key={r.mine}
                onClick={() => setSelectedMineCode(r.mine)}
                className={`cursor-pointer border-b border-neutral-900 transition-colors ${
                  isSelected ? "bg-neutral-800/40 font-medium text-white" : "hover:bg-neutral-900/50"
                }`}
              >
                <td className="py-2.5 flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 ${isSelected ? "bg-sky-400" : "bg-neutral-600"}`} />
                  {r.mine}
                </td>
                <td>{fmtT(r.p10_t)}</td>
                <td>{fmtT(r.p50_t)}</td>
                <td>{fmtT(r.p90_t)}</td>
                <td>{r.mean_grade.toFixed(1)}% Mn</td>
                <td>{r.cutoff}% Mn</td>
                <td className="text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedMineCode(r.mine);
                      recompute.mutate({ code: r.mine, cutoff: r.cutoff });
                    }}
                    className="border border-neutral-800 px-2 py-0.5 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
                  >
                    Re-krige
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
