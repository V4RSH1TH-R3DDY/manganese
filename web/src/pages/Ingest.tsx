import { useState } from "react";
import { api } from "../lib/api";

const KINDS = {
  production: "mine_code,date,planned_t,actual_t",
  weather: "mine_code,date,rain_mm",
  blasts: "mine_code,date,delayed",
  equipment: "mine_code,unit_code,date,available_hours,scheduled_hours,breakdown",
  drillholes: "mine_code,hole_code,lat,lon,collar_z,from_m,to_m,mn_pct,fe_pct",
} as const;

export default function Ingest() {
  const [kind, setKind] = useState<keyof typeof KINDS>("production");
  const [msg, setMsg] = useState("");
  const upload = async (f?: File) => {
    if (!f) return;
    setMsg("Uploading…");
    try {
      const r = await api.ingest(kind, f);
      if (kind === "drillholes") {
        setMsg(`${r.rows} assay intervals loaded (${r.rows_holes ?? "N/A"} drill holes). Model data ready.`);
      } else {
        setMsg(`${r.rows} rows loaded (${r.date_min} → ${r.date_max}). Forecasts refreshed.`);
      }
    } catch (e) {
      setMsg(`Failed: ${(e as Error).message}`);
    }
  };
  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-base font-medium">Data adapter <span className="text-neutral-500">bring your own MOIL data</span></h2>

      <select value={kind} onChange={(e) => setKind(e.target.value as any)}
        className="border border-neutral-800 bg-transparent px-3 py-2 text-sm text-neutral-200">
        {Object.keys(KINDS).map((k) => <option key={k} className="bg-neutral-900">{k}</option>)}
      </select>

      <p className="text-sm text-neutral-500">
        Required columns: <code className="text-neutral-300">{KINDS[kind]}</code>
      </p>

      <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files[0]); }}
        className="flex h-40 cursor-pointer items-center justify-center border border-dashed border-neutral-700 text-sm text-neutral-500 hover:border-neutral-500 hover:text-neutral-300">
        Drop CSV here or click to choose
        <input type="file" accept=".csv" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </label>

      {msg && <p className="border border-neutral-800 px-3 py-2 text-sm text-neutral-300">{msg}</p>}
    </div>
  );
}
