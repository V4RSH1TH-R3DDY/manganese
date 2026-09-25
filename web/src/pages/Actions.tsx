import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import ActionCard from "../components/ActionCard";
import { QueryError } from "../components/Insights";

export default function Actions() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["actions", "all"], queryFn: () => api.actions() });

  const refresh = useMutation({
    mutationFn: () => api.refreshActions(),
    onSuccess: (data) => {
      queryClient.setQueryData(["actions", "all"], data);
      queryClient.invalidateQueries({ queryKey: ["actions"] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium">
          All recommended actions <span className="text-neutral-500">(ranked by expected tonnes)</span>
        </h2>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="border border-neutral-700 px-3 py-1 text-xs font-medium uppercase tracking-[0.1em] text-neutral-300 hover:border-neutral-500 hover:text-white disabled:opacity-50"
        >
          {refresh.isPending ? "Optimizing…" : "Re-run Optimizer"}
        </button>
      </div>

      <QueryError error={q.error ?? refresh.error} what="actions" />
      <div className="grid gap-3 md:grid-cols-2">{q.data?.map((a) => <ActionCard key={a.id} a={a} />)}</div>
    </div>
  );
}
