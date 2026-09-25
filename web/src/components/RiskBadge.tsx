import type { Level } from "../lib/api";

const C: Record<Level, string> = {
  green: "border-emerald-500/60 text-emerald-400",
  amber: "border-amber-500/60 text-amber-400",
  red: "border-red-500/60 text-red-400",
};

export default function RiskBadge({ level }: { level: Level }) {
  return (
    <span className={`border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.15em] ${C[level]}`}>
      {level}
    </span>
  );
}
