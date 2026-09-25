export default function Kpi({ label, value, sub, tone = "text-neutral-100" }:
  { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="border border-neutral-800 p-3">
      <div className="text-[10px] uppercase tracking-[0.15em] text-neutral-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}
