import type { Driver } from "../lib/api";

const HEAD = "text-[10px] uppercase tracking-[0.15em] text-neutral-500";

export function LossSplit({ weather, equipment }: { weather: number; equipment: number }) {
  const total = Math.max(weather + equipment, 0.01);
  return (
    <div className="border border-neutral-800 p-3">
      <div className={`mb-2 ${HEAD}`}>Why output drops</div>
      <div className="flex h-2 overflow-hidden bg-neutral-900">
        <div className="bg-sky-500" style={{ width: `${(weather / total) * 100}%` }} />
        <div className="bg-amber-500" style={{ width: `${(equipment / total) * 100}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-neutral-400">
        <span><i className="mr-1.5 inline-block h-2 w-2 bg-sky-500 align-middle" />Weather {weather.toFixed(1)}%</span>
        <span><i className="mr-1.5 inline-block h-2 w-2 bg-amber-500 align-middle" />Equipment {equipment.toFixed(1)}%</span>
      </div>
    </div>
  );
}

export function Drivers({ items }: { items: Driver[] }) {
  const max = Math.max(...items.map((d) => Math.abs(d.impact_pct)), 1);
  return (
    <div className="border border-neutral-800 p-3">
      <div className={`mb-2 ${HEAD}`}>Top drags on output</div>
      {items.length === 0 && <p className="text-sm text-neutral-500">No significant risk drivers.</p>}
      {items.map((d) => (
        <div key={d.label} className="mb-2 last:mb-0">
          <div className="flex justify-between text-sm">
            <span className="text-neutral-300">{d.label}</span>
            <span className="tabular-nums text-red-400">{d.impact_pct}%</span>
          </div>
          <div className="mt-1 h-1 bg-neutral-900">
            <div className="h-1 bg-red-500/70" style={{ width: `${(Math.abs(d.impact_pct) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Minimal inline error surface for failed queries. */
export function QueryError({ error, what }: { error: unknown; what: string }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <p className="border border-red-500/40 bg-red-500/5 px-3 py-1.5 text-xs text-red-400">
      Could not load {what}: {msg}
    </p>
  );
}
