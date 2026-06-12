import { requireStaff } from "@/lib/dashboard";
import { formatCents } from "@/lib/menu-types";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

interface ReportOrder {
  id: string;
  paid_at: string;
  total_cents: number;
  tip_cents: number;
  customer_id: string | null;
}

interface ReportLine {
  order_id: string;
  item_id: string | null;
  name_snapshot: string;
  qty: number;
  price_snapshot_cents: number;
}

/** YYYY-MM-DD in the restaurant's timezone (en-CA gives ISO ordering). */
const dayKeyFmt = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

const dayLabelFmt = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });

const hourFmt = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  });

function hourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

/**
 * Owner-facing 30-day report card: what sold, when it sold, and whether
 * people come back. Pure CSS bars — readable from across the kitchen.
 */
export default async function ReportsPage() {
  const { supabase, restaurant } = await requireStaff();

  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const { data: orderRows } = await supabase
    .from("orders")
    .select("id, paid_at, total_cents, tip_cents, customer_id")
    .eq("restaurant_id", restaurant.id)
    .not("paid_at", "is", null)
    .gte("paid_at", since)
    .order("paid_at", { ascending: false });

  const orders = (orderRows ?? []) as ReportOrder[];

  // ---- Stat cards -----------------------------------------------------
  const gross = orders.reduce((s, o) => s + o.total_cents, 0);
  const tips = orders.reduce((s, o) => s + o.tip_cents, 0);
  const avg = orders.length > 0 ? Math.round(gross / orders.length) : 0;

  const byCustomer = new Map<string, number>();
  for (const o of orders) {
    if (o.customer_id) {
      byCustomer.set(o.customer_id, (byCustomer.get(o.customer_id) ?? 0) + 1);
    }
  }
  const repeaters = [...byCustomer.values()].filter((n) => n >= 2).length;
  const repeatRate =
    byCustomer.size > 0 ? Math.round((repeaters / byCustomer.size) * 100) : 0;

  // ---- Sales by day (last 14 days, restaurant-local) -------------------
  const tz = restaurant.timezone;
  const keyFmt = dayKeyFmt(tz);
  const labelFmt = dayLabelFmt(tz);
  const grossByDay = new Map<string, number>();
  for (const o of orders) {
    const key = keyFmt.format(new Date(o.paid_at));
    grossByDay.set(key, (grossByDay.get(key) ?? 0) + o.total_cents);
  }
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * DAY_MS);
    return {
      key: keyFmt.format(d),
      label: labelFmt.format(d),
      cents: grossByDay.get(keyFmt.format(d)) ?? 0,
    };
  });
  const maxDay = Math.max(1, ...days.map((d) => d.cents));

  // ---- Top items (order_items of the paid orders; RLS-scoped .in()) ----
  let lines: ReportLine[] = [];
  if (orders.length > 0) {
    const { data: lineRows } = await supabase
      .from("order_items")
      .select("order_id, item_id, name_snapshot, qty, price_snapshot_cents")
      .in(
        "order_id",
        orders.map((o) => o.id)
      );
    lines = (lineRows ?? []) as ReportLine[];
  }
  const itemAgg = new Map<string, { name: string; qty: number; gross: number }>();
  for (const l of lines) {
    const key = l.item_id ?? `snapshot:${l.name_snapshot}`;
    const cur = itemAgg.get(key) ?? { name: l.name_snapshot, qty: 0, gross: 0 };
    cur.qty += l.qty;
    cur.gross += l.qty * l.price_snapshot_cents;
    itemAgg.set(key, cur);
  }
  const topItems = [...itemAgg.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);
  const maxItemQty = Math.max(1, ...topItems.map((i) => i.qty));

  // ---- Busiest hours (restaurant-local) --------------------------------
  const hFmt = hourFmt(tz);
  const byHour = new Array<number>(24).fill(0);
  for (const o of orders) {
    const h = parseInt(hFmt.format(new Date(o.paid_at)), 10) % 24;
    byHour[h] += 1;
  }
  const hours = byHour
    .map((count, hour) => ({ hour, count }))
    .filter((b) => b.count > 0);
  const maxHour = Math.max(1, ...hours.map((b) => b.count));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight">Reports</h1>
        <p className="text-lg font-medium text-gray-500">{restaurant.name}</p>
      </div>
      <p className="mb-6 text-lg text-gray-600">
        Your last 30 days, in plain numbers.
      </p>

      {orders.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-black/15 bg-white p-12 text-center">
          <p className="text-2xl font-black text-gray-700">No paid orders yet</p>
          <p className="mt-2 text-lg text-gray-500">
            Once orders start coming in, your sales, top sellers, and busiest
            hours show up here.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Gross sales" value={formatCents(gross)} sub="last 30 days" accent />
            <StatCard label="Orders" value={String(orders.length)} sub="paid orders" />
            <StatCard label="Average order" value={formatCents(avg)} sub="per paid order" />
            <StatCard
              label="Repeat customers"
              value={`${repeatRate}%`}
              sub={`${repeaters} of ${byCustomer.size} ordered 2+ times`}
            />
            <StatCard label="Tips" value={formatCents(tips)} sub="total tips" />
          </div>

          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border-2 border-black/10 bg-white p-5">
              <h2 className="mb-4 text-xl font-black uppercase tracking-wide">
                Sales by day
              </h2>
              <div className="space-y-2">
                {days.map((d) => (
                  <div key={d.key} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm font-bold text-gray-500">
                      {d.label}
                    </span>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-gray-100">
                      <div
                        className="h-full rounded-md"
                        style={{
                          width: `${Math.round((d.cents / maxDay) * 100)}%`,
                          backgroundColor: "var(--accent)",
                          minWidth: d.cents > 0 ? "0.5rem" : 0,
                        }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-sm font-bold tabular-nums">
                      {d.cents > 0 ? formatCents(d.cents) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border-2 border-black/10 bg-white p-5">
              <h2 className="mb-4 text-xl font-black uppercase tracking-wide">
                Busiest hours
              </h2>
              <div className="space-y-2">
                {hours.map((b) => (
                  <div key={b.hour} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-sm font-bold text-gray-500">
                      {hourLabel(b.hour)}
                    </span>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-gray-100">
                      <div
                        className="h-full rounded-md bg-blue-600"
                        style={{
                          width: `${Math.round((b.count / maxHour) * 100)}%`,
                          minWidth: "0.5rem",
                        }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-sm font-bold tabular-nums">
                      {b.count} {b.count === 1 ? "order" : "orders"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-sm text-gray-500">
                When paid orders come in, restaurant local time.
              </p>
            </section>
          </div>

          <section className="rounded-2xl border-2 border-black/10 bg-white p-5">
            <h2 className="mb-4 text-xl font-black uppercase tracking-wide">
              Top items
            </h2>
            {topItems.length === 0 ? (
              <p className="py-6 text-center text-gray-400">No line items found.</p>
            ) : (
              <div className="space-y-2">
                {topItems.map((item, idx) => (
                  <div key={`${item.name}-${idx}`} className="flex items-center gap-3">
                    <span className="w-7 shrink-0 text-lg font-black text-gray-400">
                      {idx + 1}
                    </span>
                    <span className="w-44 shrink-0 truncate text-base font-bold sm:w-56">
                      {item.name}
                    </span>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-gray-100">
                      <div
                        className="h-full rounded-md"
                        style={{
                          width: `${Math.round((item.qty / maxItemQty) * 100)}%`,
                          backgroundColor: "var(--accent)",
                          minWidth: "0.5rem",
                        }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-sm font-black tabular-nums">
                      {item.qty} sold
                    </span>
                    <span className="hidden w-20 shrink-0 text-right text-sm font-bold tabular-nums text-gray-500 sm:block">
                      {formatCents(item.gross)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
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
