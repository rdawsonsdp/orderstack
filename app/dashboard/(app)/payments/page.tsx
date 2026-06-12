import Link from "next/link";
import { requireStaff } from "@/lib/dashboard";
import { formatCents } from "@/lib/menu-types";

export const dynamic = "force-dynamic";

interface PaidOrder {
  id: string;
  order_number: number;
  status: string;
  paid_at: string | null;
  placed_at: string | null;
  payment_method_label: string | null;
  subtotal_cents: number;
  tax_cents: number;
  tip_cents: number;
  platform_fee_cents: number;
  total_cents: number;
  customers: { name: string } | null;
}

/** What lands in the restaurant's pocket: everything the diner paid except
 *  the diner-paid platform fee (tax stays with the restaurant to remit). */
function netCents(o: PaidOrder): number {
  return o.total_cents - o.platform_fee_cents;
}

/** Next business day at least `days` out — Stripe's standard rolling schedule. */
function estimatePayoutDate(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}

/**
 * Owner-facing money transparency: every paid order, how it was paid, and
 * when the money lands. The point is confidence — order → paid → payout,
 * nothing hidden.
 */
export default async function PaymentsPage() {
  const { supabase, restaurant } = await requireStaff();
  const testMode = !process.env.STRIPE_SECRET_KEY;

  const { data } = await supabase
    .from("orders")
    .select(
      `id, order_number, status, paid_at, placed_at, payment_method_label,
       subtotal_cents, tax_cents, tip_cents, platform_fee_cents, total_cents,
       customers (name)`
    )
    .eq("restaurant_id", restaurant.id)
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: false })
    .limit(100);

  const paid = (data ?? []) as unknown as PaidOrder[];
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));

  const todays = paid.filter((o) => new Date(o.paid_at!) >= startOfDay);
  const week = paid.filter((o) => new Date(o.paid_at!) >= startOfWeek);
  const todayNet = todays.reduce((s, o) => s + netCents(o), 0);
  const weekNet = week.reduce((s, o) => s + netCents(o), 0);
  // Standard new-account schedule: funds settle ~2 business days after charge.
  const pendingPayout = paid
    .filter((o) => new Date(o.paid_at!) > estimatePayoutDate(new Date(now), -2))
    .reduce((s, o) => s + netCents(o), 0);
  const nextPayout = estimatePayoutDate(now, 1);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight">Payments</h1>
        <p className="text-lg font-medium text-gray-500">{restaurant.name}</p>
      </div>
      <p className="mb-6 text-lg text-gray-600">
        Every order, every dollar, and when it lands in your bank.
      </p>

      {testMode && (
        <div className="mb-6 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-base font-semibold text-amber-800">
          Test mode — Stripe isn&apos;t connected yet. Payments below are
          simulated. Once Stripe is live, this page shows your real charges,
          payout schedule, and bank transfer dates straight from Stripe.
        </div>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Today" value={formatCents(todayNet)} sub={`${todays.length} paid orders`} />
        <StatCard label="This week" value={formatCents(weekNet)} sub={`${week.length} paid orders`} />
        <StatCard
          label="On its way to you"
          value={formatCents(pendingPayout)}
          sub="charged, not yet paid out"
          accent
        />
        <StatCard
          label="Next payout (est.)"
          value={nextPayout.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
          sub={testMode ? "estimate — live date with Stripe" : "per your Stripe schedule"}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-sm font-bold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Paid</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3 text-right">Diner paid</th>
              <th className="px-4 py-3 text-right">Fee</th>
              <th className="px-4 py-3 text-right">You keep</th>
              <th className="px-4 py-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="text-base">
            {paid.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No paid orders yet.
                </td>
              </tr>
            )}
            {paid.map((o) => (
              <tr key={o.id} className="border-t border-black/5 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/orders/${o.id}`}
                    className="font-bold hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    #{o.order_number}
                  </Link>{" "}
                  <span className="text-gray-500">{o.customers?.name ?? "Guest"}</span>
                </td>
                <td className="px-4 py-3 tabular-nums text-gray-600">
                  {new Date(o.paid_at!).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-3">{o.payment_method_label ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCents(o.total_cents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                  −{formatCents(o.platform_fee_cents)}
                </td>
                <td className="px-4 py-3 text-right font-bold tabular-nums">
                  {formatCents(netCents(o))}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-bold text-green-800">
                    PAID ✓
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm text-gray-500">
        &quot;You keep&quot; = everything the diner paid minus the diner-paid
        service fee. Sales tax is included in your payout for you to remit.
        Tap any order for its full payment audit.
      </p>
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border-2 p-5 ${
        accent ? "border-green-300 bg-green-50" : "border-black/10 bg-white"
      }`}
    >
      <p className="text-sm font-bold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-black tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-gray-500">{sub}</p>
    </div>
  );
}
