import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtT, LEVEL_HEX } from "../lib/format";
import { useStore } from "../store";
import ActionCard from "../components/ActionCard";
import FanChart from "../components/FanChart";
import { Drivers, LossSplit, QueryError } from "../components/Insights";
import Kpi from "../components/Kpi";
import MapView, { type BasemapMode } from "../components/MapView";
import RiskBadge from "../components/RiskBadge";

const HEAD = "text-[10px] uppercase tracking-[0.15em] text-neutral-500";

export default function Overview() {
  const { mine, horizon, sim, setMine, setHorizon, setSim } = useStore();
  const [showProsp, setShowProsp] = useState(true);
  const [showDrillholes, setShowDrillholes] = useState(false);
  const [basemap, setBasemap] = useState<BasemapMode>("black");

  const mines = useQuery({ queryKey: ["mines"], queryFn: api.mines, refetchInterval: 60_000 });
  const drillholes = useQuery({ queryKey: ["drillholes"], queryFn: api.drillholes, retry: false });
  const risk = useQuery({ queryKey: ["risk", mine, horizon], queryFn: () => api.risk(mine, horizon), enabled: !!mine });
  const reserve = useQuery({ queryKey: ["reserve", mine], queryFn: () => api.reserves(mine), enabled: !!mine, retry: false });
  const actions = useQuery({ queryKey: ["actions", mine], queryFn: () => api.actions(mine), enabled: !!mine });
  const prosp = useQuery({ queryKey: ["prosp"], queryFn: api.prospectivity, retry: false });

  useEffect(() => { if (!mine && mines.data?.length) setMine(mines.data[0].code); }, [mine, mines.data, setMine]);
  useEffect(() => { setSim(null); }, [mine, horizon, setSim]);          // reset what-if on context change

  useEffect(() => {                                                     // j / k step through mines
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "j" && e.key !== "k") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(input|select|textarea)$/i.test(t.tagName))) return;
      const list = mines.data;
      if (!list?.length) return;
      const i = list.findIndex((m) => m.code === mine);
      const next = list[(Math.max(i, 0) + (e.key === "j" ? 1 : list.length - 1)) % list.length];
      setMine(next.code);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mine, mines.data, setMine]);

  const r = sim ?? risk.data;
  const recovered = sim && risk.data ? risk.data.expected_loss_t - sim.expected_loss_t : 0;
  const redMines = mines.data?.filter((m) => m.level === "red") ?? [];

  return (
    <div className="space-y-4">
      {redMines.length > 0 && (
        <div className="border border-red-500/40 bg-red-500/5 px-4 py-2 text-sm text-red-300">
          High shortfall risk this week: <b className="font-medium">{redMines.map((m) => m.name).join(", ")}</b>
        </div>
      )}

      <QueryError error={mines.error} what="mines" />

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {mines.data?.map((m) => (
          <button key={m.code} onClick={() => setMine(m.code)}
            className={`flex items-center gap-2 border px-3 py-1 text-sm ${mine === m.code
              ? "border-neutral-400 text-neutral-100" : "border-neutral-800 text-neutral-400 hover:border-neutral-600"}`}>
            <span className="h-1.5 w-1.5" style={{ background: LEVEL_HEX[m.level] }} />{m.name}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-neutral-400">
            <input type="checkbox" checked={showProsp} onChange={(e) => setShowProsp(e.target.checked)}
              className="accent-neutral-400" /> Prospectivity
          </label>
          <label className="flex items-center gap-1.5 text-sm text-neutral-400">
            <input type="checkbox" checked={showDrillholes} onChange={(e) => setShowDrillholes(e.target.checked)}
              className="accent-neutral-400" /> Drill holes
          </label>
          <div className="flex border border-neutral-800">
            <button
              onClick={() => setBasemap("black")}
              className={`px-2.5 py-1 text-xs transition-colors ${
                basemap === "black" ? "bg-neutral-800 text-white font-medium" : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              ⬛ Black
            </button>
            <button
              onClick={() => setBasemap("satellite")}
              className={`border-l border-neutral-800 px-2.5 py-1 text-xs transition-colors ${
                basemap === "satellite" ? "bg-neutral-800 text-white font-medium" : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              🛰 Satellite
            </button>
            <button
              onClick={() => setBasemap("streets")}
              className={`border-l border-neutral-800 px-2.5 py-1 text-xs transition-colors ${
                basemap === "streets" ? "bg-neutral-800 text-white font-medium" : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              🗺 Streets
            </button>
          </div>
          {([7, 14] as const).map((h) => (
            <button key={h} onClick={() => setHorizon(h)}
              className={`border px-3 py-1 text-sm ${horizon === h
                ? "border-neutral-400 text-neutral-100" : "border-neutral-800 text-neutral-400 hover:border-neutral-600"}`}>
              {h}d
            </button>
          ))}
          <button onClick={() => window.print()}
            className="border border-neutral-800 px-3 py-1 text-sm text-neutral-400 hover:border-neutral-600">
            Export brief
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <section className="lg:col-span-8 print:hidden">
          {mines.data && (
            <MapView
              mines={mines.data}
              selected={mine}
              onSelect={setMine}
              prospectivity={prosp.data}
              showProsp={showProsp}
              basemap={basemap}
              drillholes={drillholes.data}
              showDrillholes={showDrillholes}
            />
          )}
        </section>
        <section className="space-y-3 lg:col-span-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-medium">{mines.data?.find((m) => m.code === mine)?.name ?? "…"}</h2>
            {r && <RiskBadge level={r.level} />}
          </div>
          <QueryError error={risk.error} what="risk forecast" />
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Expected shortfall" value={r ? `${r.expected_shortfall_pct.toFixed(1)}%` : "…"}
                 sub={`next ${horizon} days`} tone={sim ? "text-emerald-400" : "text-amber-400"} />
            <Kpi label="Tonnes at risk" value={r ? fmtT(r.expected_loss_t) : "…"} sub="vs plan" />
            <Kpi label="P(shortfall > 10%)" value={risk.data ? `${Math.round(risk.data.p_shortfall * 100)}%` : "…"} />
            <Kpi label="Reserve P50" value={reserve.data ? fmtT(reserve.data.p50_t) : "n/a"}
                 sub={reserve.data ? `${fmtT(reserve.data.p10_t)} – ${fmtT(reserve.data.p90_t)}` : "no drill data"} />
          </div>
          {risk.data && <LossSplit weather={risk.data.signals.weather_pct} equipment={risk.data.signals.equipment_pct} />}
          {risk.data && <Drivers items={risk.data.drivers} />}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <section className="border border-neutral-800 p-4 lg:col-span-7">
          <div className="mb-2 flex items-center justify-between">
            <h3 className={HEAD}>Production forecast</h3>
            {sim && (
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                What-if active · +{fmtT(recovered)} recovered
                <button onClick={() => setSim(null)}
                  className="border border-neutral-700 px-2 py-0.5 text-neutral-400 hover:border-neutral-500">
                  Reset
                </button>
              </div>
            )}
          </div>
          {risk.data ? <FanChart band={risk.data.band} after={sim?.band} /> : <div className="h-80 animate-pulse bg-neutral-900" />}
        </section>
        <section className="space-y-3 lg:col-span-5">
          <h3 className={HEAD}>Recommended actions</h3>
          <QueryError error={actions.error} what="actions" />
          {actions.data?.length === 0 && <p className="text-sm text-neutral-500">No action needed: forecast within plan.</p>}
          {actions.data?.map((a) => <ActionCard key={a.id} a={a} horizon={horizon} onResult={setSim} />)}
        </section>
      </div>
    </div>
  );
}
