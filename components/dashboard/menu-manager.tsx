"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/menu-types";

export interface ManagedItem {
  id: string;
  name: string;
  price_cents: number;
  sort: number;
  is_available: boolean;
  sold_out_until: string | null;
}

interface Category {
  id: string;
  name: string;
  items: ManagedItem[];
}

function soldOutNow(item: ManagedItem): boolean {
  return (
    !item.is_available ||
    (item.sold_out_until !== null && new Date(item.sold_out_until) > new Date())
  );
}

/**
 * The "86 board": one tap takes an item off the storefront.
 * "86 today" sets sold_out_until to local midnight (auto-returns tomorrow);
 * "Off menu" flips is_available until it's manually turned back on.
 */
export function MenuManager({
  restaurantName,
  categories,
}: {
  restaurantName: string;
  categories: Category[];
}) {
  const [items, setItems] = useState<Record<string, ManagedItem>>(
    Object.fromEntries(categories.flatMap((c) => c.items.map((i) => [i.id, i])))
  );
  const [error, setError] = useState<string | null>(null);

  async function update(itemId: string, patch: Partial<ManagedItem>) {
    setError(null);
    const prev = items[itemId];
    setItems((s) => ({ ...s, [itemId]: { ...s[itemId], ...patch } }));
    const { error } = await createClient()
      .from("items")
      .update(patch)
      .eq("id", itemId);
    if (error) {
      setItems((s) => ({ ...s, [itemId]: prev }));
      setError(error.message);
    }
  }

  function endOfToday(): string {
    const d = new Date();
    d.setHours(23, 59, 59, 0);
    return d.toISOString();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-1 text-xl font-bold">{restaurantName} — menu</h1>
      <p className="mb-6 text-sm text-gray-500">
        86 an item to pull it off the storefront instantly.
      </p>
      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {categories.map((category) => (
        <section key={category.id} className="mb-6">
          <h2 className="mb-2 font-semibold text-gray-700">{category.name}</h2>
          <div className="overflow-hidden rounded-lg border border-black/10 bg-white">
            {category.items.map((orig) => {
              const item = items[orig.id];
              const out = soldOutNow(item);
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-3 last:border-0"
                >
                  <div>
                    <p className={`font-medium ${out ? "text-gray-400 line-through" : ""}`}>
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatCents(item.price_cents)}
                      {!item.is_available && " · off menu"}
                      {item.is_available &&
                        item.sold_out_until &&
                        new Date(item.sold_out_until) > new Date() &&
                        " · 86'd today"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {out ? (
                      <button
                        onClick={() =>
                          update(item.id, { is_available: true, sold_out_until: null })
                        }
                        className="rounded bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                      >
                        Bring back
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() =>
                            update(item.id, { sold_out_until: endOfToday() })
                          }
                          className="rounded border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                        >
                          86 today
                        </button>
                        <button
                          onClick={() => update(item.id, { is_available: false })}
                          className="rounded border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          Off menu
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
