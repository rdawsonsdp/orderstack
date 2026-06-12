"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  formatCents,
  menuImageUrl,
  type MenuItem,
  type MenuModifierGroup,
  type StorefrontData,
} from "@/lib/menu-types";
import type { PricedOrder } from "@/lib/pricing";

interface CartLine {
  key: string;
  itemId: string;
  name: string;
  qty: number;
  modifierIds: string[];
  modifierNames: string[];
  notes: string | null;
}

function isSoldOut(item: MenuItem): boolean {
  return (
    !item.is_available ||
    (item.sold_out_until !== null && new Date(item.sold_out_until) > new Date())
  );
}

function effectiveMin(group: MenuModifierGroup): number {
  return group.required ? Math.max(group.min_select, 1) : group.min_select;
}

export function Storefront({ data }: { data: StorefrontData }) {
  const { restaurant, location, categories } = data;
  const router = useRouter();
  const pathname = usePathname();
  // '/{slug}' in dev path routing, '' on a subdomain (proxy.ts rewrite)
  const base = pathname.startsWith(`/${restaurant.slug}`)
    ? `/${restaurant.slug}`
    : "";
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [priced, setPriced] = useState<PricedOrder | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const storageKey = `orderstack-cart-${restaurant.slug}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setLines(JSON.parse(saved));
    } catch {
      /* corrupted cart — start fresh */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(lines));
  }, [lines, storageKey]);

  // Server is the source of truth for money: re-price on every cart change.
  const priceAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (lines.length === 0) {
      setPriced(null);
      setPriceError(null);
      return;
    }
    priceAbort.current?.abort();
    const controller = new AbortController();
    priceAbort.current = controller;
    fetch("/api/orders/price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        locationId: location.id,
        type: "pickup",
        tipCents: 0,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          modifierIds: l.modifierIds,
          notes: l.notes,
        })),
      }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          setPriced(null);
          setPriceError(body.message ?? "Could not price your order.");
        } else {
          setPriced(body);
          setPriceError(null);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") setPriceError("Network error.");
      });
  }, [lines, location.id]);

  const addToCart = useCallback(
    (item: MenuItem, modifierIds: string[], modifierNames: string[], qty: number) => {
      setLines((prev) => [
        ...prev,
        {
          key: crypto.randomUUID(),
          itemId: item.id,
          name: item.name,
          qty,
          modifierIds,
          modifierNames,
          notes: null,
        },
      ]);
      setActiveItem(null);
      setCartOpen(true);
    },
    []
  );

  const itemCount = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty, 0),
    [lines]
  );

  const colors = restaurant.branding.colors ?? {};
  const primary = colors.primary ?? "#111827";

  return (
    <div
      className="min-h-screen"
      style={
        {
          background: colors.background ?? "#fff",
          "--brand": primary,
          "--accent": colors.accent ?? primary,
        } as React.CSSProperties
      }
    >
      <header
        className="sticky top-0 z-20 border-b border-black/10 px-4 py-3 text-white"
        style={{ background: primary }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            {restaurant.branding.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={restaurant.branding.logoUrl}
                alt={`${restaurant.name} logo`}
                className="h-11 w-11 rounded-full"
              />
            )}
            <div>
              <h1 className="text-lg font-bold">{restaurant.name}</h1>
              <p className="text-xs opacity-80">
                {location.address_line1}
                {location.address_line2 ? `, ${location.address_line2}` : ""} ·{" "}
                {location.city}, {location.state}
                {location.phone ? ` · ${location.phone}` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={() => setCartOpen(true)}
            className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25"
          >
            Cart ({itemCount})
          </button>
        </div>
      </header>

      <nav className="sticky top-[57px] z-10 overflow-x-auto border-b border-black/10 bg-white/90 px-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl gap-4">
          {categories.map((c) => (
            <a
              key={c.id}
              href={`#cat-${c.id}`}
              className="whitespace-nowrap py-3 text-sm font-medium text-gray-700 hover:text-(--brand)"
            >
              {c.name}
            </a>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-4 pb-32 pt-6">
        {categories.map((category) => (
          <section key={category.id} id={`cat-${category.id}`} className="mb-10">
            <h2 className="mb-4 text-2xl font-bold" style={{ color: primary }}>
              {category.name}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {category.items.map((item) => {
                const soldOut = isSoldOut(item);
                const imageUrl = menuImageUrl(item.image_path);
                return (
                  <button
                    key={item.id}
                    disabled={soldOut}
                    onClick={() => setActiveItem(item)}
                    className="flex items-stretch justify-between gap-3 overflow-hidden rounded-lg border border-black/10 bg-white text-left shadow-sm transition hover:shadow-md disabled:opacity-50"
                  >
                    <div className="flex-1 p-4">
                      <h3 className="font-semibold">{item.name}</h3>
                      {item.description && (
                        <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                          {item.description}
                        </p>
                      )}
                      <p className="mt-2 text-sm font-semibold text-(--accent)">
                        {formatCents(item.price_cents)}
                        {item.modifier_groups.some(
                          (g) => g.modifiers.some((m) => m.price_delta_cents > 0)
                        ) && "+"}
                        {soldOut && (
                          <span className="ml-2 rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500">
                            Sold out
                          </span>
                        )}
                      </p>
                    </div>
                    {imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl}
                        alt={item.name}
                        className="h-auto w-28 shrink-0 object-cover"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      {activeItem && (
        <ItemModal
          item={activeItem}
          onClose={() => setActiveItem(null)}
          onAdd={addToCart}
        />
      )}

      {cartOpen && (
        <CartDrawer
          lines={lines}
          priced={priced}
          priceError={priceError}
          platformFeeCents={restaurant.platform_fee_cents}
          onRemove={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
          onClose={() => setCartOpen(false)}
          onCheckout={() => router.push(`${base}/checkout`)}
        />
      )}
    </div>
  );
}

function ItemModal({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (item: MenuItem, modifierIds: string[], names: string[], qty: number) => void;
}) {
  const [qty, setQty] = useState(1);
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  const toggle = (group: MenuModifierGroup, modifierId: string) => {
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      if (current.includes(modifierId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== modifierId) };
      }
      // Single-select groups behave like radios
      if (group.max_select === 1) {
        return { ...prev, [group.id]: [modifierId] };
      }
      if (group.max_select !== null && current.length >= group.max_select) {
        return prev;
      }
      return { ...prev, [group.id]: [...current, modifierId] };
    });
  };

  const unmetGroups = item.modifier_groups.filter(
    (g) => (selected[g.id]?.length ?? 0) < effectiveMin(g)
  );

  const allModifiers = item.modifier_groups.flatMap((g) => g.modifiers);
  const chosenIds = Object.values(selected).flat();
  const unitCents =
    item.price_cents +
    chosenIds.reduce(
      (sum, id) =>
        sum + (allModifiers.find((m) => m.id === id)?.price_delta_cents ?? 0),
      0
    );

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between">
          <h3 className="text-xl font-bold">{item.name}</h3>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400">
            ×
          </button>
        </div>
        {menuImageUrl(item.image_path) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={menuImageUrl(item.image_path)!}
            alt={item.name}
            className="mb-3 max-h-56 w-full rounded-lg object-cover"
          />
        )}
        {item.description && (
          <p className="mb-4 text-sm text-gray-600">{item.description}</p>
        )}

        {item.modifier_groups.map((group) => (
          <fieldset key={group.id} className="mb-4">
            <legend className="mb-2 font-semibold">
              {group.name}{" "}
              <span className="text-xs font-normal text-gray-500">
                {effectiveMin(group) > 0
                  ? group.max_select === 1
                    ? "(choose 1)"
                    : `(choose ${effectiveMin(group)}${
                        group.max_select ? `–${group.max_select}` : "+"
                      })`
                  : group.max_select
                    ? `(up to ${group.max_select})`
                    : "(optional)"}
              </span>
            </legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {group.modifiers
                .filter((m) => m.is_available)
                .map((mod) => {
                  const checked = (selected[group.id] ?? []).includes(mod.id);
                  return (
                    <label
                      key={mod.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${
                        checked
                          ? "border-(--accent) bg-(--accent)/5"
                          : "border-black/10"
                      }`}
                    >
                      <input
                        type={group.max_select === 1 ? "radio" : "checkbox"}
                        name={group.id}
                        checked={checked}
                        onChange={() => toggle(group, mod.id)}
                      />
                      <span className="flex-1">{mod.name}</span>
                      {mod.price_delta_cents > 0 && (
                        <span className="text-gray-500">
                          +{formatCents(mod.price_delta_cents)}
                        </span>
                      )}
                    </label>
                  );
                })}
            </div>
          </fieldset>
        ))}

        <div className="mt-6 flex items-center gap-3">
          <div className="flex items-center rounded-md border border-black/15">
            <button
              className="px-3 py-2 text-lg"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
            >
              −
            </button>
            <span className="w-8 text-center font-medium">{qty}</span>
            <button className="px-3 py-2 text-lg" onClick={() => setQty((q) => q + 1)}>
              +
            </button>
          </div>
          <button
            disabled={unmetGroups.length > 0}
            onClick={() =>
              onAdd(
                item,
                chosenIds,
                chosenIds.map(
                  (id) => allModifiers.find((m) => m.id === id)?.name ?? ""
                ),
                qty
              )
            }
            className="flex-1 rounded-md px-4 py-3 font-semibold text-white disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {unmetGroups.length > 0
              ? `Choose ${unmetGroups[0].name}`
              : `Add to cart · ${formatCents(unitCents * qty)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function CartDrawer({
  lines,
  priced,
  priceError,
  platformFeeCents,
  onRemove,
  onClose,
  onCheckout,
}: {
  lines: CartLine[];
  priced: PricedOrder | null;
  priceError: string | null;
  platformFeeCents: number;
  onRemove: (key: string) => void;
  onClose: () => void;
  onCheckout: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/10 p-4">
          <h3 className="text-lg font-bold">Your order</h3>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {lines.length === 0 && (
            <p className="text-sm text-gray-500">Your cart is empty.</p>
          )}
          {lines.map((line) => (
            <div
              key={line.key}
              className="mb-3 flex items-start justify-between gap-2 rounded-md border border-black/10 p-3"
            >
              <div>
                <p className="font-medium">
                  {line.qty} × {line.name}
                </p>
                {line.modifierNames.length > 0 && (
                  <p className="text-xs text-gray-500">
                    {line.modifierNames.join(", ")}
                  </p>
                )}
              </div>
              <button
                onClick={() => onRemove(line.key)}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-black/10 p-4">
          {priceError && (
            <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700">
              {priceError}
            </p>
          )}
          {priced && (
            <dl className="mb-3 space-y-1 text-sm">
              <Row label="Subtotal" value={priced.subtotalCents} />
              <Row label="Tax" value={priced.taxCents} />
              <Row label="Service fee" value={platformFeeCents} />
              <div className="flex justify-between border-t border-black/10 pt-2 text-base font-bold">
                <dt>Total</dt>
                <dd>{formatCents(priced.totalCents)}</dd>
              </div>
            </dl>
          )}
          <button
            disabled={!priced}
            onClick={onCheckout}
            className="w-full rounded-md px-4 py-3 font-semibold text-white disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            Checkout {priced ? `· ${formatCents(priced.totalCents)}` : ""}
          </button>
          <p className="mt-2 text-center text-xs text-gray-400">
            Pickup only · test mode until Stripe is connected
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-600">{label}</dt>
      <dd>{formatCents(value)}</dd>
    </div>
  );
}
