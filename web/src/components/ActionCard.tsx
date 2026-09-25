import { useMutation } from "@tanstack/react-query";
import { api, type Action, type Risk } from "../lib/api";
import { fmtT } from "../lib/format";

const KIND: Record<string, string> = {
  blast_advance: "Blast", maintenance: "Maintenance", redeploy: "Redeploy",
};

export default function ActionCard({ a, horizon = 7, onResult }:
  { a: Action; horizon?: number; onResult?: (r: Risk) => void }) {
  const sim = useMutation({ mutationFn: () => api.simulate(a.id, horizon), onSuccess: (r) => onResult?.(r) });
  const steps = (a.detail.steps as string[] | undefined) ?? [];
  return (
    <article className="border border-neutral-800 p-4">
      <div className="flex items-center gap-2">
        <span className="border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.15em] text-neutral-400">
          {KIND[a.kind] ?? a.kind}
        </span>
        <span className="ml-auto text-[10px] uppercase tracking-[0.15em] text-neutral-500">{a.mine}</span>
      </div>

      <h4 className="mt-2 font-medium leading-snug text-neutral-100">{a.title}</h4>
      <p className="mt-1 text-sm tabular-nums text-emerald-400">+{fmtT(a.expected_tonnes)} expected recovery</p>

      {steps.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-neutral-400">
          {steps.map((s) => (
            <li key={s} className="flex gap-2">
              <span className="mt-2 h-px w-2 shrink-0 bg-neutral-600" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-3">
        <div className="h-1 w-20 bg-neutral-900">
          <div className="h-1 bg-neutral-400" style={{ width: `${a.confidence * 100}%` }} />
        </div>
        <span className="text-xs tabular-nums text-neutral-500">{Math.round(a.confidence * 100)}% confidence</span>
        {onResult && (
          <button onClick={() => sim.mutate()} disabled={sim.isPending}
            className="ml-auto border border-emerald-500/60 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.1em] text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 print:hidden">
            {sim.isPending ? "Simulating…" : "Simulate impact"}
          </button>
        )}
      </div>

      {sim.isError && (
        <p className="mt-2 text-xs text-red-400">Simulation failed: {(sim.error as Error).message}</p>
      )}
    </article>
  );
}
