import { NavLink, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Health } from "./lib/api";
import Actions from "./pages/Actions";
import Ingest from "./pages/Ingest";
import Overview from "./pages/Overview";
import Reserves from "./pages/Reserves";

const link = ({ isActive }: { isActive: boolean }) =>
  `border px-3 py-1 text-sm ${isActive
    ? "border-neutral-400 text-neutral-100"
    : "border-transparent text-neutral-500 hover:text-neutral-200"}`;

/**
 * Honesty badge. Reports provenance per source rather than from a single
 * DATA_MODE flag: weather can be real while the ops data is still synthetic,
 * and a badge that hides in that case overclaims.
 *
 * Modes are grouped rather than flattened, so real-but-overlaid data
 * ("scenario") is not lumped in with fully synthetic data. Describing real
 * ERA5 rainfall as "synthetic" under-claims just as badly as the reverse
 * over-claimed.
 */
function ProvenanceBadge({ health }: { health?: Health }) {
  if (!health) return null;
  const flagged = health.synthetic_sources;
  const tooltip = health.provenance
    .map((p) => `${p.source}: ${p.mode}${p.detail ? ` — ${p.detail}` : ""}`)
    .join("\n");

  if (flagged.length === 0) {
    return (
      <span title={tooltip}
        className="ml-auto shrink-0 whitespace-nowrap border border-emerald-500/60 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.15em] text-emerald-400">
        Live data
      </span>
    );
  }

  const byMode = new Map<string, string[]>();
  for (const p of health.provenance) {
    if (!flagged.includes(p.source)) continue;
    byMode.set(p.mode, [...(byMode.get(p.mode) ?? []), p.source]);
  }
  const allSynthetic = byMode.size === 1 && byMode.has("synthetic")
    && flagged.length === health.provenance.length;
  // Collapse the three ops feeds to one label when they share a mode, otherwise
  // the badge is long enough to wrap the header.
  const OPS = ["production", "equipment", "blasts"];
  const label = (srcs: string[]) =>
    OPS.every((o) => srcs.includes(o))
      ? ["ops", ...srcs.filter((s) => !OPS.includes(s))].join(", ")
      : srcs.join(", ");
  const text = allSynthetic
    ? "Synthetic demo data"
    : [...byMode].map(([mode, srcs]) => `${mode}: ${label(srcs)}`).join(" · ");

  return (
    <span title={tooltip}
      className="ml-auto shrink-0 whitespace-nowrap border border-amber-500/60 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.15em] text-amber-400">
      {text}
    </span>
  );
}

export default function App() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 60_000 });
  return (
    <div className="w-full px-0 py-4">
      <header className="mb-4 flex items-center gap-4 border-b border-neutral-800 px-4 pb-3 print:hidden">
        <div className="shrink-0 text-sm font-medium uppercase tracking-[0.2em] text-neutral-100">
          MOIL Manganese Copilot
        </div>
        <nav className="flex gap-1">
          <NavLink to="/" end className={link}>Command center</NavLink>
          <NavLink to="/reserves" className={link}>Reserves</NavLink>
          <NavLink to="/actions" className={link}>Actions</NavLink>
          <NavLink to="/ingest" className={link}>Data adapter</NavLink>
        </nav>
        <ProvenanceBadge health={health.data} />
      </header>
      <main className="w-full px-4">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/reserves" element={<Reserves />} />
          <Route path="/actions" element={<Actions />} />
          <Route path="/ingest" element={<Ingest />} />
        </Routes>
      </main>
    </div>
  );
}
