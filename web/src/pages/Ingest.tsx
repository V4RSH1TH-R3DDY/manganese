import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  const [err, setErr] = useState("");
  const [downloading, setDownloading] = useState(false);

  const { data: records, refetch: refetchRecords, isLoading: loadingRecords } = useQuery({
    queryKey: ["records", kind],
    queryFn: () => api.records(kind),
  });

  const handleDownload = async () => {
    setDownloading(true);
    setErr("");
    try {
      await api.downloadTemplate(kind);
    } catch (e) {
      setErr(`Failed to download template: ${(e as Error).message}`);
    } finally {
      setDownloading(false);
    }
  };

  const upload = async (f?: File) => {
    if (!f) return;
    setMsg("Uploading…");
    setErr("");
    try {
      const r = await api.ingest(kind, f);
      if (kind === "drillholes") {
        setMsg(`✓ ${r.rows} assay intervals loaded (${r.rows_holes ?? "N/A"} drill holes). Model data ready.`);
      } else {
        setMsg(`✓ ${r.rows} rows loaded (${r.date_min} → ${r.date_max}). Forecasts refreshed.`);
      }
      refetchRecords();
    } catch (e) {
      const raw = (e as Error).message;
      let detail = raw;
      try {
        const jsonStart = raw.indexOf("{");
        if (jsonStart !== -1) {
          const parsed = JSON.parse(raw.slice(jsonStart));
          if (parsed.detail) detail = parsed.detail;
        }
      } catch {
        // Keep raw message if not json
      }
      setMsg("");
      setErr(`Upload failed (422): ${detail}`);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">
          Data adapter <span className="text-neutral-500">bring your own MOIL data</span>
        </h2>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-white transition-colors"
        >
          {downloading ? "Downloading…" : "📥 Download Sample CSV"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as any);
            setMsg("");
            setErr("");
          }}
          className="border border-neutral-800 bg-transparent px-3 py-2 text-sm text-neutral-200"
        >
          {Object.keys(KINDS).map((k) => (
            <option key={k} className="bg-neutral-900">
              {k}
            </option>
          ))}
        </select>
        <span className="text-xs text-neutral-400">
          Accepted mine identifiers: <span className="text-neutral-200">BLG (Balaghat), DBZ (Dongri Buzurg), KDR (Kandri), MNS (Mansar), CHK (Chikla)</span>
        </span>
      </div>

      <p className="text-sm text-neutral-500">
        Required columns: <code className="text-neutral-300">{KINDS[kind]}</code>
      </p>

      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          upload(e.dataTransfer.files[0]);
        }}
        className="flex h-36 cursor-pointer flex-col items-center justify-center border border-dashed border-neutral-700 text-sm text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors"
      >
        <span>Drop CSV here or click to choose</span>
        <span className="mt-1 text-xs text-neutral-500">Supports .csv with standard column names</span>
        <input type="file" accept=".csv" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </label>

      {msg && <p className="border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{msg}</p>}
      {err && <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}

      {/* Database Records Table Preview */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
          <h3 className="text-sm font-medium text-neutral-300">
            Latest Database Entries ({kind})
          </h3>
          <button
            onClick={() => refetchRecords()}
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            ↻ Refresh
          </button>
        </div>

        {loadingRecords ? (
          <p className="text-xs text-neutral-500 py-4">Loading entries…</p>
        ) : !records || records.length === 0 ? (
          <p className="text-xs text-neutral-500 py-4">No records found for {kind}.</p>
        ) : (
          <div className="overflow-x-auto border border-neutral-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-900/60 text-neutral-400 border-b border-neutral-800">
                <tr>
                  {Object.keys(records[0]).map((col) => (
                    <th key={col} className="px-3 py-2 font-medium tracking-wider uppercase text-[10px]">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {records.map((r, i) => (
                  <tr key={i} className="hover:bg-neutral-900/40 font-mono text-neutral-300">
                    {Object.entries(r).map(([k, val]) => (
                      <td key={k} className="px-3 py-2 whitespace-nowrap">
                        {typeof val === "boolean" ? (
                          <span className={val ? "text-amber-400 font-bold" : "text-neutral-500"}>
                            {String(val)}
                          </span>
                        ) : typeof val === "number" ? (
                          val.toLocaleString()
                        ) : (
                          String(val ?? "-")
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
