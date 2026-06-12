"use client";

import { useState, useTransition } from "react";
import { updateRestaurantFee } from "@/app/admin/actions";

/** Inline editor for restaurants.platform_fee_cents (integer cents). */
export function FeeEditor({
  restaurantId,
  feeCents,
}: {
  restaurantId: string;
  feeCents: number;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(feeCents));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(String(feeCents));
          setError(null);
          setEditing(true);
        }}
        className="group inline-flex items-center gap-1.5 tabular-nums text-zinc-200"
        title="Edit platform fee"
      >
        {(feeCents / 100).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        })}
        <span className="text-xs text-zinc-500 group-hover:text-zinc-300">
          edit
        </span>
      </button>
    );
  }

  const save = () => {
    const cents = Number(value);
    if (!/^\d+$/.test(value.trim()) || !Number.isInteger(cents) || cents < 0) {
      setError("Whole cents ≥ 0");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateRestaurantFee(restaurantId, cents);
      if (!res.ok) setError(res.error ?? "Failed.");
      else setEditing(false);
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-20 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs tabular-nums text-zinc-100 focus:border-zinc-400 focus:outline-none"
          aria-label="Platform fee in cents"
        />
        <span className="text-xs text-zinc-500">¢</span>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          className="px-1 text-xs text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
