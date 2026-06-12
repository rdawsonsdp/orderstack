"use client";

import { useState, useTransition } from "react";
import { updateRestaurantStatus } from "@/app/admin/actions";

/** Lifecycle buttons per current status; server action re-validates. */
const NEXT_MOVES: Record<string, { to: string; label: string }[]> = {
  draft: [{ to: "onboarding", label: "Start onboarding" }],
  onboarding: [{ to: "live", label: "Go live" }],
  live: [{ to: "paused", label: "Pause" }],
  paused: [{ to: "live", label: "Resume" }],
};

export function StatusActions({
  restaurantId,
  status,
}: {
  restaurantId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const moves = NEXT_MOVES[status] ?? [];
  if (moves.length === 0) return <span className="text-xs text-zinc-500">—</span>;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1.5">
        {moves.map((move) => (
          <button
            key={move.to}
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await updateRestaurantStatus(restaurantId, move.to);
                if (!res.ok) setError(res.error ?? "Failed.");
              });
            }}
            className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-zinc-500 hover:bg-zinc-700 disabled:opacity-50"
          >
            {pending ? "…" : move.label}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
