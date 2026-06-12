import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin";
import { StatusActions } from "@/components/admin/status-actions";
import { FeeEditor } from "@/components/admin/fee-editor";

export const dynamic = "force-dynamic";

type RestaurantRow = {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "onboarding" | "live" | "paused";
  platform_fee_cents: number;
  plan: string;
  created_at: string;
};

const STATUS_BADGE: Record<RestaurantRow["status"], string> = {
  draft: "bg-zinc-700/60 text-zinc-300 ring-zinc-600",
  onboarding: "bg-amber-500/15 text-amber-400 ring-amber-500/40",
  live: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/40",
  paused: "bg-red-500/15 text-red-400 ring-red-500/40",
};

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function AdminRestaurantsPage() {
  const { admin } = await requirePlatformAdmin();

  const [{ data: restaurants }, { data: paidOrders }] = await Promise.all([
    admin
      .from("restaurants")
      .select("id, slug, name, status, platform_fee_cents, plan, created_at")
      .order("created_at", { ascending: false }) as unknown as Promise<{
      data: RestaurantRow[] | null;
    }>,
    admin
      .from("orders")
      .select("restaurant_id, total_cents")
      .not("paid_at", "is", null) as unknown as Promise<{
      data: { restaurant_id: string; total_cents: number }[] | null;
    }>,
  ]);

  // Aggregate paid orders per restaurant in-process (operator scale: tens of
  // tenants, not thousands). Swap for a SQL view if this ever gets heavy.
  const revenue = new Map<string, { count: number; grossCents: number }>();
  for (const order of paidOrders ?? []) {
    const entry = revenue.get(order.restaurant_id) ?? { count: 0, grossCents: 0 };
    entry.count += 1;
    entry.grossCents += order.total_cents;
    revenue.set(order.restaurant_id, entry);
  }

  const rows = restaurants ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Restaurants</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {rows.length} tenant{rows.length === 1 ? "" : "s"} on the platform
          </p>
        </div>
        <Link
          href="/admin/new"
          className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white"
        >
          + Onboard restaurant
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900 text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">Restaurant</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Platform fee</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 text-right font-medium">Paid orders</th>
              <th className="px-4 py-3 text-right font-medium">Gross paid</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-zinc-500">
                  No restaurants yet.{" "}
                  <Link href="/admin/new" className="text-zinc-300 underline">
                    Onboard the first one.
                  </Link>
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const rev = revenue.get(r.id) ?? { count: 0, grossCents: 0 };
              return (
                <tr key={r.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-100">{r.name}</div>
                    <Link
                      href={`/${r.slug}`}
                      target="_blank"
                      className="font-mono text-xs text-zinc-400 hover:text-zinc-200 hover:underline"
                    >
                      /{r.slug} ↗
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <FeeEditor
                      restaurantId={r.id}
                      feeCents={r.platform_fee_cents}
                    />
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{r.plan}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                    {rev.count}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                    {usd(rev.grossCents)}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {new Date(r.created_at).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <StatusActions restaurantId={r.id} status={r.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
