"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/menu-types";

export interface ManagedCoupon {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  min_subtotal_cents: number;
  starts_at: string | null;
  expires_at: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  active: boolean;
  created_at: string;
}

const CODE_RE = /^[A-Z0-9-]{3,24}$/;

type CouponStatus = "ACTIVE" | "EXPIRED" | "MAXED" | "OFF";

function couponStatus(c: ManagedCoupon): CouponStatus {
  if (!c.active) return "OFF";
  if (c.expires_at && new Date(c.expires_at) < new Date()) return "EXPIRED";
  if (c.max_redemptions !== null && c.redemption_count >= c.max_redemptions)
    return "MAXED";
  return "ACTIVE";
}

const STATUS_CHIP: Record<CouponStatus, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  EXPIRED: "bg-gray-200 text-gray-600",
  MAXED: "bg-amber-100 text-amber-800",
  OFF: "bg-red-100 text-red-700",
};

function describe(c: ManagedCoupon): string {
  const off = c.kind === "percent" ? `${c.value}% off` : `${formatCents(c.value)} off`;
  return c.min_subtotal_cents > 0
    ? `${off} · min ${formatCents(c.min_subtotal_cents)}`
    : off;
}

function windowLabel(c: ManagedCoupon): string | null {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  if (c.starts_at && c.expires_at)
    return `${fmt(c.starts_at)} – ${fmt(c.expires_at)}`;
  if (c.expires_at) return `Expires ${fmt(c.expires_at)}`;
  if (c.starts_at) return `Starts ${fmt(c.starts_at)}`;
  return null;
}

/** Translate raw Postgres errors into kitchen English. */
function friendlyDbError(message: string, code?: string): string {
  if (code === "23505" || message.includes("duplicate key"))
    return "You already have a coupon with that code.";
  if (code === "42501" || message.toLowerCase().includes("row-level security"))
    return "You don't have permission to do that.";
  return `Something went wrong: ${message}`;
}

/**
 * Coupon board: big bold codes the owner can read at a glance, one-tap
 * on/off, two-tap delete (same pattern as the order board's reject).
 */
export function CouponsManager({
  restaurantId,
  restaurantName,
  initialCoupons,
}: {
  restaurantId: string;
  restaurantName: string;
  initialCoupons: ManagedCoupon[];
}) {
  const [coupons, setCoupons] = useState<ManagedCoupon[]>(initialCoupons);
  const [error, setError] = useState<string | null>(null);

  async function setActive(coupon: ManagedCoupon, active: boolean) {
    setError(null);
    const prev = coupons;
    setCoupons((s) => s.map((c) => (c.id === coupon.id ? { ...c, active } : c)));
    const { error } = await createClient()
      .from("coupons")
      .update({ active })
      .eq("id", coupon.id);
    if (error) {
      setCoupons(prev);
      setError(friendlyDbError(error.message, error.code));
    }
  }

  async function remove(coupon: ManagedCoupon) {
    setError(null);
    const prev = coupons;
    setCoupons((s) => s.filter((c) => c.id !== coupon.id));
    const { error } = await createClient()
      .from("coupons")
      .delete()
      .eq("id", coupon.id);
    if (error) {
      setCoupons(prev);
      setError(friendlyDbError(error.message, error.code));
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight">Coupons</h1>
        <p className="text-lg font-medium text-gray-500">{restaurantName}</p>
      </div>
      <p className="mb-6 text-lg text-gray-600">
        Discount codes your customers type at checkout.
      </p>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 p-4 text-lg font-semibold text-red-700">
          {error}
        </p>
      )}

      <NewCouponForm
        restaurantId={restaurantId}
        onCreated={(c) => setCoupons((s) => [c, ...s])}
      />

      {coupons.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-black/15 bg-white p-12 text-center">
          <p className="text-2xl font-black text-gray-700">No coupons yet</p>
          <p className="mt-2 text-lg text-gray-500">
            Create your first code above — try 10% off to bring back regulars.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coupons.map((c) => (
            <CouponCard
              key={c.id}
              coupon={c}
              onSetActive={setActive}
              onDelete={remove}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function CouponCard({
  coupon,
  onSetActive,
  onDelete,
}: {
  coupon: ManagedCoupon;
  onSetActive: (c: ManagedCoupon, active: boolean) => void;
  onDelete: (c: ManagedCoupon) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = couponStatus(coupon);
  const win = windowLabel(coupon);

  return (
    <article
      className={`rounded-2xl border-2 bg-white p-5 shadow ${
        status === "ACTIVE" ? "border-black/10" : "border-black/10 opacity-80"
      }`}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <p
          className="break-all text-3xl font-black tracking-wide"
          style={{ color: "var(--accent)" }}
        >
          {coupon.code}
        </p>
        <span
          className={`whitespace-nowrap rounded-full px-3 py-1 text-sm font-bold ${STATUS_CHIP[status]}`}
        >
          {status}
        </span>
      </div>

      <p className="text-xl font-bold">{describe(coupon)}</p>
      <p className="mt-1 text-sm font-semibold text-gray-500">
        Used {coupon.redemption_count}
        {coupon.max_redemptions !== null && ` / ${coupon.max_redemptions}`}
        {coupon.max_redemptions !== null ? " times (max)" : " times"}
      </p>
      {win && <p className="text-sm font-semibold text-gray-500">{win}</p>}

      <div className="mt-4 flex gap-2">
        {coupon.active ? (
          <button
            onClick={() => onSetActive(coupon, false)}
            className="flex-1 rounded-lg border-2 border-amber-400 py-3 text-base font-black text-amber-700 hover:bg-amber-50"
          >
            DEACTIVATE
          </button>
        ) : (
          <button
            onClick={() => onSetActive(coupon, true)}
            className="flex-1 rounded-lg bg-green-600 py-3 text-base font-black text-white hover:bg-green-700"
          >
            REACTIVATE
          </button>
        )}
        <button
          onClick={() => {
            if (confirmDelete) onDelete(coupon);
            else {
              setConfirmDelete(true);
              setTimeout(() => setConfirmDelete(false), 4000);
            }
          }}
          className={`flex-1 rounded-lg border-2 py-3 text-base font-black ${
            confirmDelete
              ? "border-red-600 bg-red-600 text-white"
              : "border-red-300 text-red-600 hover:bg-red-50"
          }`}
        >
          {confirmDelete ? "SURE?" : "Delete"}
        </button>
      </div>
    </article>
  );
}

function NewCouponForm({
  restaurantId,
  onCreated,
}: {
  restaurantId: string;
  onCreated: (c: ManagedCoupon) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [minSubtotal, setMinSubtotal] = useState("");
  const [expires, setExpires] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");

  function reset() {
    setCode("");
    setKind("percent");
    setValue("");
    setMinSubtotal("");
    setExpires("");
    setMaxRedemptions("");
    setFormError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!CODE_RE.test(code)) {
      setFormError(
        "Code must be 3–24 characters: letters, numbers, and dashes only."
      );
      return;
    }

    let valueInt: number;
    if (kind === "percent") {
      valueInt = parseInt(value, 10);
      if (!Number.isInteger(valueInt) || valueInt < 1 || valueInt > 100) {
        setFormError("Percent must be a whole number from 1 to 100.");
        return;
      }
    } else {
      const dollars = parseFloat(value);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        setFormError("Enter a dollar amount greater than $0.");
        return;
      }
      valueInt = Math.round(dollars * 100);
    }

    let minCents = 0;
    if (minSubtotal.trim() !== "") {
      const dollars = parseFloat(minSubtotal);
      if (!Number.isFinite(dollars) || dollars < 0) {
        setFormError("Minimum order must be a dollar amount.");
        return;
      }
      minCents = Math.round(dollars * 100);
    }

    let maxRed: number | null = null;
    if (maxRedemptions.trim() !== "") {
      maxRed = parseInt(maxRedemptions, 10);
      if (!Number.isInteger(maxRed) || maxRed < 1) {
        setFormError("Max uses must be a whole number of at least 1.");
        return;
      }
    }

    // Expiry = end of the chosen day, owner's local clock.
    const expiresAt = expires
      ? new Date(`${expires}T23:59:59`).toISOString()
      : null;

    setSaving(true);
    const { data, error } = await createClient()
      .from("coupons")
      .insert({
        restaurant_id: restaurantId,
        code,
        kind,
        value: valueInt,
        min_subtotal_cents: minCents,
        expires_at: expiresAt,
        max_redemptions: maxRed,
      })
      .select(
        `id, code, kind, value, min_subtotal_cents, starts_at, expires_at,
         max_redemptions, redemption_count, active, created_at`
      )
      .single();
    setSaving(false);

    if (error) {
      setFormError(friendlyDbError(error.message, error.code));
      return;
    }
    onCreated(data as ManagedCoupon);
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-6 w-full rounded-2xl border-2 border-dashed border-black/20 bg-white py-5 text-xl font-black text-gray-700 hover:border-black/40 hover:bg-gray-50 sm:w-auto sm:px-10"
      >
        + NEW COUPON
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mb-6 rounded-2xl border-2 border-black/10 bg-white p-5 shadow"
    >
      <h2 className="mb-4 text-xl font-black uppercase tracking-wide">
        New coupon
      </h2>

      {formError && (
        <p className="mb-4 rounded-lg bg-red-50 p-3 text-base font-semibold text-red-700">
          {formError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="text-sm font-bold uppercase tracking-wide text-gray-500">
            Code
          </span>
          <input
            value={code}
            onChange={(e) =>
              setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))
            }
            placeholder="WELCOME10"
            required
            maxLength={24}
            className="mt-1 w-full rounded-lg border-2 border-black/15 px-3 py-2.5 text-lg font-black tracking-wide focus:border-black/40 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold uppercase tracking-wide text-gray-500">
            Type
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "percent" | "fixed")}
            className="mt-1 w-full rounded-lg border-2 border-black/15 bg-white px-3 py-2.5 text-lg font-bold focus:border-black/40 focus:outline-none"
          >
            <option value="percent">% off</option>
            <option value="fixed">$ off</option>
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-bold uppercase tracking-wide text-gray-500">
            {kind === "percent" ? "Percent off (1–100)" : "Dollars off"}
          </span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            placeholder={kind === "percent" ? "10" : "5.00"}
            required
            className="mt-1 w-full rounded-lg border-2 border-black/15 px-3 py-2.5 text-lg font-bold tabular-nums focus:border-black/40 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold uppercase tracking-wide text-gray-500">
            Min order $ (optional)
          </span>
          <input
            value={minSubtotal}
            onChange={(e) => setMinSubtotal(e.target.value)}
            inputMode="decimal"
            placeholder="20.00"
            className="mt-1 w-full rounded-lg border-2 border-black/15 px-3 py-2.5 text-lg font-bold tabular-nums focus:border-black/40 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold uppercase tracking-wide text-gray-500">
            Expires (optional)
          </span>
          <input
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className="mt-1 w-full rounded-lg border-2 border-black/15 px-3 py-2.5 text-lg font-bold focus:border-black/40 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold uppercase tracking-wide text-gray-500">
            Max uses (optional)
          </span>
          <input
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            inputMode="numeric"
            placeholder="100"
            className="mt-1 w-full rounded-lg border-2 border-black/15 px-3 py-2.5 text-lg font-bold tabular-nums focus:border-black/40 focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-[2] rounded-lg bg-green-600 py-3.5 text-lg font-black text-white hover:bg-green-700 disabled:opacity-60 sm:flex-none sm:px-10"
        >
          {saving ? "CREATING…" : "CREATE COUPON"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="rounded-lg px-6 py-3.5 text-lg font-bold text-gray-500 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
