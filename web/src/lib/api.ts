const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";
export const API_KEY = import.meta.env.VITE_API_KEY ?? "change-me";

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export type Level = "green" | "amber" | "red";
export interface BandPoint { date: string; planned: number; q10: number; q50: number; q90: number; rain_mm: number }
export interface Driver { feature: string; label: string; impact_pct: number }
export interface Risk {
  mine: string; issued_on: string; horizon_days: number; level: Level; p_shortfall: number;
  expected_shortfall_pct: number; expected_loss_t: number; band: BandPoint[]; drivers: Driver[];
  signals: Record<string, number>;
}
export interface Reserve { mine: string; p10_t: number; p50_t: number; p90_t: number; mean_grade: number; cutoff: number; grade_hist_x: number[]; grade_hist_y: number[]; computed_on: string }
export interface Action { id: number; mine: string; kind: string; title: string; detail: Record<string, unknown>; expected_tonnes: number; confidence: number; status: string }
export interface MineSummary { code: string; name: string; method: string; lat: number; lon: number; level: Level; expected_shortfall_pct: number; reserve_p50_t: number | null }
export interface DrillHolePoint { id: number; mine_code: string; lat: number; lon: number; collar_z: number }

export interface Provenance { source: string; mode: "synthetic" | "live" | "uploaded" | "unknown"; detail: string; updated_at: string | null }
export interface Health {
  status: string; data_mode: string; model_loaded: boolean;
  provenance: Provenance[]; synthetic_sources: string[];
}

export const api = {
  health: () => j<Health>("/health"),
  mines: () => j<MineSummary[]>("/mines"),
  drillholes: () => j<DrillHolePoint[]>("/mines/drillholes"),
  risk: (mine: string, h = 7) => j<Risk>(`/risk/${mine}?horizon=${h}`),
  reserves: (mine: string) => j<Reserve>(`/reserves/${mine}`),
  recomputeReserve: (mine: string, cutoff = 25.0) =>
    j<Reserve>(`/reserves/${mine}/recompute?cutoff=${cutoff}`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY }
    }),
  actions: (mine?: string) => j<Action[]>(`/actions${mine ? `?mine=${mine}` : ""}`),
  refreshActions: () =>
    j<Action[]>("/actions/refresh", {
      method: "POST",
      headers: { "X-API-Key": API_KEY }
    }),
  simulate: (id: number, h = 7) => j<Risk>(`/actions/${id}/simulate?horizon=${h}`, { method: "POST" }),
  prospectivity: () => j<{ tiles: string; bounds: [number, number, number, number] }>("/prospectivity/meta"),
  ingest: (kind: string, file: File) => {
    const fd = new FormData(); fd.append("file", file);
    return j<{
      kind: string;
      rows: number;
      date_min: string;
      date_max: string;
      rows_holes?: number;
      rows_assays?: number;
    }>(`/ingest/${kind}`, { method: "POST", body: fd, headers: { "X-API-Key": API_KEY } });
  },
};
