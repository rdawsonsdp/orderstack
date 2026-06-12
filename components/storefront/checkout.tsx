"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { formatCents, type StorefrontData } from "@/lib/menu-types";
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

const TIP_PRESETS = [0, 10, 15, 20] as const;

/** Tenant-aware base path: '/{slug}' in dev path routing, '' on a subdomain. */
function useTenantBase(slug: string): string {
  const pathname = usePathname();
  return pathname.startsWith(`/${slug}`) ? `/${slug}` : "";
}

export function Checkout({ data }: { data: StorefrontData }) {
  const { restaurant, location } = data;
  const router = useRouter();
  const base = useTenantBase(restaurant.slug);
  const storageKey = `orderstack-cart-${restaurant.slug}`;

  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tipPercent, setTipPercent] = useState<number>(15);
  const [priced, setPriced] = useState<PricedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setLines(JSON.parse(saved));
    } catch {
      /* corrupted cart — start fresh */
    }
    setLoaded(true);
  }, [storageKey]);

  const subtotalForTip = priced?.subtotalCents ?? 0;
  const tipCents = useMemo(
    () => Math.round((subtotalForTip * tipPercent) / 100),
    [subtotalForTip, tipPercent]
  );

  const cartPayload = useMemo(
    () => ({
      locationId: location.id,
      type: "pickup" as const,
      tipCents,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        qty: l.qty,
        modifierIds: l.modifierIds,
        notes: l.notes,
      })),
    }),
    [location.id, tipCents, lines]
  );

  useEffect(() => {
    if (lines.length === 0) return;
    fetch("/api/orders/price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cartPayload),
    })
      .then(async (res) => {
        const body = await res.json();
        if (res.ok) {
          setPriced(body);
          setError(null);
        } else {
          setError(body.message ?? "Could not price your order.");
        }
      })
      .catch(() => setError("Network error."));
  }, [cartPayload, lines.length]);

  async function placeOrder() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart: cartPayload,
          customer: { name, email, phone: phone || null },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? body.error ?? "Could not place your order.");
        setSubmitting(false);
        return;
      }

      if (body.payment.isMock) {
        // Test mode: confirm immediately (stands in for Stripe payment + webhook).
        const confirm = await fetch("/api/payments/mock/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intentId: body.payment.intentId }),
        });
        if (!confirm.ok) {
          setError("Test payment failed to confirm.");
          setSubmitting(false);
          return;
        }
      } else {
        // Real Stripe lands here: confirm the PaymentIntent with Stripe
        // Elements using body.payment.clientSecret, then the webhook places
        // the order.
        setError("Stripe checkout not wired yet — keys pending.");
        setSubmitting(false);
        return;
      }

      localStorage.removeItem(storageKey);
      router.push(`${base}/track/${body.publicToken}`);
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  const colors = restaurant.branding.colors ?? {};
  const canSubmit =
    !submitting && priced !== null && name.trim().length > 0 && /\S+@\S+\.\S+/.test(email);

  if (loaded && lines.length === 0) {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-bold">Your cart is empty</h1>
        <a href={`${base}/`} className="mt-4 inline-block text-(--accent) underline"
           style={{ "--accent": colors.accent ?? "#1d4ed8" } as React.CSSProperties}>
          Back to {restaurant.name}
        </a>
      </main>
    );
  }

  return (
    <main
      className="mx-auto max-w-lg px-4 py-8"
      style={
        {
          "--brand": colors.primary ?? "#111827",
          "--accent": colors.accent ?? colors.primary ?? "#111827",
        } as React.CSSProperties
      }
    >
      <h1 className="text-2xl font-bold" style={{ color: "var(--brand)" }}>
        Checkout — {restaurant.name}
      </h1>
      <p className="mb-6 mt-1 text-sm text-gray-600">
        Pickup at {location.address_line1}
        {location.address_line2 ? `, ${location.address_line2}` : ""} ·{" "}
        ready in about {location.prep_time_min} min
      </p>

      <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        Test mode — payments are simulated until Stripe is connected. No card
        required, no money moves.
      </div>

      <section className="mb-6 rounded-lg border border-black/10 p-4">
        <h2 className="mb-2 font-semibold">Your order</h2>
        {lines.map((line) => (
          <div key={line.key} className="mb-1 text-sm">
            {line.qty} × {line.name}
            {line.modifierNames.length > 0 && (
              <span className="text-gray-500"> ({line.modifierNames.join(", ")})</span>
            )}
          </div>
        ))}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Tip the kitchen</h2>
        <div className="flex gap-2">
          {TIP_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setTipPercent(p)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                tipPercent === p
                  ? "border-(--accent) bg-(--accent)/10"
                  : "border-black/15"
              }`}
            >
              {p === 0 ? "None" : `${p}%`}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-6 space-y-3">
        <h2 className="font-semibold">Your details</h2>
        <input
          className="w-full rounded-md border border-black/15 p-3 text-sm"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="w-full rounded-md border border-black/15 p-3 text-sm"
          placeholder="Email (for your receipt)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-md border border-black/15 p-3 text-sm"
          placeholder="Phone (optional)"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </section>

      {priced && (
        <dl className="mb-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-600">Subtotal</dt>
            <dd>{formatCents(priced.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Tax</dt>
            <dd>{formatCents(priced.taxCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Tip</dt>
            <dd>{formatCents(priced.tipCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Service fee</dt>
            <dd>{formatCents(priced.platformFeeCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-black/10 pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd>{formatCents(priced.totalCents)}</dd>
          </div>
        </dl>
      )}

      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      <button
        disabled={!canSubmit}
        onClick={placeOrder}
        className="w-full rounded-md px-4 py-3 font-semibold text-white disabled:opacity-40"
        style={{ background: "var(--accent)" }}
      >
        {submitting
          ? "Placing order…"
          : `Place order${priced ? ` · ${formatCents(priced.totalCents)}` : ""}`}
      </button>
    </main>
  );
}
