"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCents, menuImageUrl } from "@/lib/menu-types";

export interface ManagedItem {
  id: string;
  name: string;
  price_cents: number;
  sort: number;
  is_available: boolean;
  sold_out_until: string | null;
  image_path: string | null;
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
 * The "86 board", grid edition: photo cards big enough to work on a kitchen
 * tablet. One tap pulls an item; photos upload straight from the card.
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
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight">Menu</h1>
        <p className="text-lg font-medium text-gray-500">{restaurantName}</p>
      </div>
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 p-4 text-lg font-semibold text-red-700">
          {error}
        </p>
      )}

      {categories.map((category) => (
        <section key={category.id} className="mb-10">
          <h2
            className="mb-4 border-l-8 pl-3 text-2xl font-black uppercase tracking-wide"
            style={{ borderColor: "var(--accent)" }}
          >
            {category.name}
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {category.items.map((orig) => (
              <ItemCard
                key={orig.id}
                item={items[orig.id]}
                onUpdate={update}
                endOfToday={endOfToday}
                onError={setError}
              />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

function ItemCard({
  item,
  onUpdate,
  endOfToday,
  onError,
}: {
  item: ManagedItem;
  onUpdate: (id: string, patch: Partial<ManagedItem>) => void;
  endOfToday: () => string;
  onError: (msg: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const out = soldOutNow(item);
  const imageUrl = menuImageUrl(item.image_path);

  async function uploadPhoto(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("itemId", item.id);
      form.append("file", file);
      const res = await fetch("/api/dashboard/items/photo", {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        onError(`Photo upload failed: ${body.error}`);
        return;
      }
      onUpdate(item.id, { image_path: body.path });
    } catch {
      onError("Photo upload failed: network error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <article
      className={`overflow-hidden rounded-2xl border-2 bg-white shadow transition ${
        out ? "border-red-200 opacity-80" : "border-black/10"
      }`}
    >
      <div className="relative aspect-[4/3] bg-gray-100">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={item.name}
            className={`h-full w-full object-cover ${out ? "grayscale" : ""}`}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-gray-400">
            <span className="text-5xl">🍽️</span>
            <span className="mt-1 text-sm font-semibold">No photo yet</span>
          </div>
        )}

        {out && (
          <span className="absolute left-3 top-3 rounded-lg bg-red-600 px-3 py-1 text-sm font-black uppercase text-white">
            {item.is_available ? "86'd today" : "Off menu"}
          </span>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadPhoto(file);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="absolute bottom-3 right-3 rounded-lg bg-black/65 px-3 py-2 text-sm font-bold text-white backdrop-blur-sm hover:bg-black/80 disabled:opacity-60"
        >
          {uploading ? "Uploading…" : imageUrl ? "📷 Change photo" : "📷 Add photo"}
        </button>
      </div>

      <div className="p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="text-xl font-bold leading-tight">{item.name}</h3>
          <span
            className="whitespace-nowrap text-xl font-black"
            style={{ color: "var(--accent)" }}
          >
            {formatCents(item.price_cents)}
          </span>
        </div>

        {out ? (
          <button
            onClick={() =>
              onUpdate(item.id, { is_available: true, sold_out_until: null })
            }
            className="w-full rounded-lg bg-green-600 py-3 text-lg font-black text-white hover:bg-green-700"
          >
            BRING BACK
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onUpdate(item.id, { sold_out_until: endOfToday() })}
              className="rounded-lg border-2 border-amber-400 py-3 text-base font-black text-amber-700 hover:bg-amber-50"
            >
              86 TODAY
            </button>
            <button
              onClick={() => onUpdate(item.id, { is_available: false })}
              className="rounded-lg border-2 border-red-300 py-3 text-base font-black text-red-600 hover:bg-red-50"
            >
              OFF MENU
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
