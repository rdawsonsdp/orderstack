"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
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

/** /api/orders/price response: PricedOrder plus current-open flag. */
type PricedResponse = PricedOrder & { orderingOpen?: boolean };

interface SlotsResponse {
  open: boolean;
  prepTimeMin: number;
  timezone: string;
  slots: string[]; // ISO timestamps, next 2 days, 15-min steps
}

const TIP_PRESETS = [0, 10, 15, 20] as const;
const COUPON_PATTERN = /^[A-Z0-9-]{3,24}$/;

// Stripe Elements is gated on the publishable key: without it the mock
// payment flow below runs exactly as before (no Stripe code paths execute).
const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

/** Tenant-aware base path: '/{slug}' in dev path routing, '' on a subdomain. */
function useTenantBase(slug: string): string {
  const pathname = usePathname();
  return pathname.startsWith(`/${slug}`) ? `/${slug}` : "";
}

/** "Today" / "Tomorrow" / weekday + local time, in the restaurant's timezone. */
function slotParts(iso: string, timeZone: string): { day: string; time: string } {
  const slot = new Date(iso);
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(d);
  const key = dayKey(slot);
  const day =
    key === dayKey(new Date())
      ? "Today"
      : key === dayKey(new Date(Date.now() + 86_400_000))
        ? "Tomorrow"
        : new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(slot);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(slot);
  return { day, time };
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
  const [priced, setPriced] = useState<PricedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // When: ASAP vs scheduled slot
  const [when, setWhen] = useState<"asap" | "later">("asap");
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [slotsInfo, setSlotsInfo] = useState<SlotsResponse | null>(null);

  // Promo code
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Set once Stripe Elements should take over payment (real keys only).
  const [payment, setPayment] = useState<{
    clientSecret: string;
    publicToken: string;
  } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setLines(JSON.parse(saved));
    } catch {
      /* corrupted cart — start fresh */
    }
    setLoaded(true);
  }, [storageKey]);

  const fetchSlots = useCallback(() => {
    fetch(`/api/orders/slots?locationId=${location.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((info: SlotsResponse | null) => {
        if (!info) return;
        setSlotsInfo(info);
        // Closed right now: ASAP isn't an option — force scheduling.
        if (!info.open) setWhen("later");
      })
      .catch(() => {
        /* slots are progressive enhancement; ASAP still works */
      });
  }, [location.id]);

  useEffect(fetchSlots, [fetchSlots]);

  // Default the schedule select to the first available slot.
  useEffect(() => {
    if (when === "later" && !scheduledFor && slotsInfo?.slots.length) {
      setScheduledFor(slotsInfo.slots[0]);
    }
  }, [when, scheduledFor, slotsInfo]);

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
      scheduledFor: when === "later" ? scheduledFor : null,
      couponCode: appliedCoupon,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        qty: l.qty,
        modifierIds: l.modifierIds,
        notes: l.notes,
      })),
    }),
    [location.id, tipCents, lines, when, scheduledFor, appliedCoupon]
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
          setCouponError(null);
        } else if (body.error === "COUPON_INVALID" || body.error === "COUPON_MIN") {
          // Drop the bad code so the next re-price restores totals.
          setCouponError(body.message ?? "That code isn't valid");
          setAppliedCoupon(null);
        } else {
          setError(body.message ?? "Could not price your order.");
        }
      })
      .catch(() => setError("Network error."));
  }, [cartPayload, lines.length]);

  function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!COUPON_PATTERN.test(code)) {
      setCouponError("Codes are 3–24 letters, numbers, or dashes.");
      return;
    }
    setCouponError(null);
    setAppliedCoupon(code);
  }

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
        if (body.error === "INVALID_SCHEDULE" || body.error === "RESTAURANT_CLOSED") {
          // Slot drifted out of range while the form was open — refresh.
          setScheduledFor(null);
          fetchSlots();
        }
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
        localStorage.removeItem(storageKey);
        router.push(`${base}/track/${body.publicToken}`);
        return;
      }

      if (stripePromise && body.payment.clientSecret) {
        // Real Stripe: Elements renders below and confirms the PaymentIntent;
        // the webhook (never the client) moves the order to `placed`.
        setPayment({
          clientSecret: body.payment.clientSecret,
          publicToken: body.publicToken,
        });
        setSubmitting(false);
        return;
      }

      setError("Stripe checkout not wired yet — keys pending.");
      setSubmitting(false);
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  const colors = restaurant.branding.colors ?? {};
  const closedNow = slotsInfo !== null && !slotsInfo.open;
  const whenValid =
    when === "asap" ? !closedNow : scheduledFor !== null;
  const canSubmit =
    !submitting &&
    payment === null &&
    priced !== null &&
    whenValid &&
    name.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(email);

  // Group slots by day for the <select> (optgroup label = Today/Tomorrow/weekday).
  const slotGroups = useMemo(() => {
    const groups = new Map<string, Array<{ iso: string; time: string }>>();
    for (const iso of slotsInfo?.slots ?? []) {
      const { day, time } = slotParts(iso, restaurant.timezone);
      const bucket = groups.get(day) ?? [];
      bucket.push({ iso, time });
      groups.set(day, bucket);
    }
    return [...groups.entries()];
  }, [slotsInfo, restaurant.timezone]);

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

      {!STRIPE_PK && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Test mode — payments are simulated until Stripe is connected. No card
          required, no money moves.
        </div>
      )}

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
        <h2 className="mb-2 font-semibold">When</h2>
        {closedNow && (
          <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            Closed right now — schedule a pickup time.
          </p>
        )}
        <div className="space-y-2 text-sm">
          <label
            className={`flex items-center gap-2 rounded-md border p-3 ${
              when === "asap" ? "border-(--accent) bg-(--accent)/5" : "border-black/15"
            } ${closedNow ? "opacity-50" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              name="when"
              checked={when === "asap"}
              disabled={closedNow}
              onChange={() => setWhen("asap")}
            />
            ASAP (~{slotsInfo?.prepTimeMin ?? location.prep_time_min} min)
          </label>
          <label
            className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 ${
              when === "later" ? "border-(--accent) bg-(--accent)/5" : "border-black/15"
            }`}
          >
            <input
              type="radio"
              name="when"
              checked={when === "later"}
              onChange={() => setWhen("later")}
            />
            Schedule for later
          </label>
          {when === "later" &&
            (slotsInfo && slotsInfo.slots.length === 0 ? (
              <p className="rounded bg-red-50 p-3 text-red-700">
                No pickup times available in the next two days.
              </p>
            ) : (
              <select
                value={scheduledFor ?? ""}
                onChange={(e) => setScheduledFor(e.target.value || null)}
                className="w-full rounded-md border border-black/15 p-3"
                aria-label="Pickup time"
              >
                <option value="" disabled>
                  {slotsInfo ? "Pick a time" : "Loading times…"}
                </option>
                {slotGroups.map(([day, slots]) => (
                  <optgroup key={day} label={day}>
                    {slots.map((s) => (
                      <option key={s.iso} value={s.iso}>
                        {day} {s.time}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ))}
        </div>
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

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Promo code</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-black/15 p-3 text-sm uppercase"
            placeholder="Code"
            value={couponInput}
            onChange={(e) => setCouponInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyCoupon();
            }}
          />
          <button
            onClick={applyCoupon}
            disabled={couponInput.trim().length === 0}
            className="rounded-md border border-black/15 px-4 text-sm font-medium disabled:opacity-40"
          >
            Apply
          </button>
        </div>
        {couponError && <p className="mt-2 text-sm text-red-700">{couponError}</p>}
        {appliedCoupon && priced && priced.discountCents > 0 && (
          <p className="mt-2 text-sm text-green-700">
            Code {appliedCoupon} applied.{" "}
            <button
              className="underline"
              onClick={() => {
                setAppliedCoupon(null);
                setCouponInput("");
              }}
            >
              Remove
            </button>
          </p>
        )}
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
          {priced.discountCents > 0 && (
            <div className="flex justify-between text-green-700">
              <dt>Discount{appliedCoupon ? ` (${appliedCoupon})` : ""}</dt>
              <dd>−{formatCents(priced.discountCents)}</dd>
            </div>
          )}
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

      {payment && stripePromise ? (
        <Elements
          stripe={stripePromise}
          options={{ clientSecret: payment.clientSecret }}
        >
          <StripePaymentForm
            totalCents={priced?.totalCents ?? 0}
            returnUrl={`${typeof window !== "undefined" ? window.location.origin : ""}${base}/track/${payment.publicToken}`}
            onSuccess={() => {
              localStorage.removeItem(storageKey);
              router.push(`${base}/track/${payment.publicToken}`);
            }}
          />
        </Elements>
      ) : (
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
      )}
    </main>
  );
}

/**
 * Stripe Elements payment step, shown only after the order is created with a
 * real PaymentIntent. The order moves to `placed` via the Stripe webhook; the
 * tracking page already renders the pending state until then.
 */
function StripePaymentForm({
  totalCents,
  returnUrl,
  onSuccess,
}: {
  totalCents: number;
  returnUrl: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  async function pay() {
    if (!stripe || !elements) return;
    setPaying(true);
    setPayError(null);
    const { error } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: returnUrl },
    });
    if (error) {
      setPayError(error.message ?? "Payment failed — please try again.");
      setPaying(false);
      return;
    }
    onSuccess();
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      {payError && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">{payError}</p>
      )}
      <button
        disabled={!stripe || !elements || paying}
        onClick={pay}
        className="w-full rounded-md px-4 py-3 font-semibold text-white disabled:opacity-40"
        style={{ background: "var(--accent)" }}
      >
        {paying ? "Processing…" : `Pay ${formatCents(totalCents)}`}
      </button>
    </div>
  );
}
