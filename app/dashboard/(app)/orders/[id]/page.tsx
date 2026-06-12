import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/dashboard";
import { formatCents } from "@/lib/menu-types";
import type { OrderStatus } from "@/lib/orders/state-machine";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Partial<Record<OrderStatus, string>> = {
  placed: "bg-amber-100 text-amber-800",
  accepted: "bg-blue-100 text-blue-800",
  preparing: "bg-blue-100 text-blue-800",
  ready: "bg-green-100 text-green-800",
  completed: "bg-gray-200 text-gray-700",
  rejected: "bg-red-100 text-red-700",
  canceled: "bg-red-100 text-red-700",
  refunded: "bg-purple-100 text-purple-700",
};

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Full order record for staff — items, money, customer, audit trail. */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { supabase } = await requireStaff();

  // RLS scopes to this staff user's restaurant — a foreign order id 404s.
  const { data: order } = await supabase
    .from("orders")
    .select(
      `id, order_number, status, type, created_at, placed_at, promised_at,
       scheduled_for, special_instructions, stripe_payment_intent_id,
       subtotal_cents, tax_cents, tip_cents, delivery_fee_cents,
       platform_fee_cents, total_cents,
       customers (name, email, phone),
       order_items (id, name_snapshot, price_snapshot_cents, qty, notes,
         order_item_modifiers (name_snapshot, price_snapshot_cents)),
       order_events (status, actor, created_at)`
    )
    .eq("id", id)
    .single();

  if (!order) notFound();

  const customer = order.customers as unknown as {
    name: string;
    email: string;
    phone: string | null;
  } | null;
  const events = (
    (order.order_events ?? []) as { status: string; actor: string; created_at: string }[]
  ).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/dashboard" className="text-sm text-gray-500 hover:underline">
        ← Back to orders
      </Link>

      <header className="mb-6 mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Order #{order.order_number}</h1>
          <p className="text-sm text-gray-500">
            {order.type} · placed {fmtTime(order.placed_at ?? order.created_at)}
            {order.promised_at && <> · promised {fmtTime(order.promised_at)}</>}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            STATUS_STYLE[order.status as OrderStatus] ?? "bg-gray-100 text-gray-700"
          }`}
        >
          {order.status}
        </span>
      </header>

      <section className="mb-4 rounded-lg border border-black/10 bg-white p-4">
        <h2 className="mb-2 font-semibold">Customer</h2>
        <p className="text-sm">
          {customer?.name ?? "Guest"}
          {customer?.phone && (
            <>
              {" · "}
              <a href={`tel:${customer.phone}`} className="underline">
                {customer.phone}
              </a>
            </>
          )}
        </p>
        {customer?.email && <p className="text-sm text-gray-500">{customer.email}</p>}
      </section>

      <section className="mb-4 rounded-lg border border-black/10 bg-white p-4">
        <h2 className="mb-2 font-semibold">Items</h2>
        {(order.order_items ?? []).map(
          (item: {
            id: string;
            name_snapshot: string;
            price_snapshot_cents: number;
            qty: number;
            notes: string | null;
            order_item_modifiers: {
              name_snapshot: string;
              price_snapshot_cents: number;
            }[];
          }) => {
            const unit =
              item.price_snapshot_cents +
              item.order_item_modifiers.reduce(
                (s, m) => s + m.price_snapshot_cents,
                0
              );
            return (
              <div
                key={item.id}
                className="mb-2 border-b border-black/5 pb-2 text-sm last:mb-0 last:border-0 last:pb-0"
              >
                <div className="flex justify-between font-medium">
                  <span>
                    {item.qty} × {item.name_snapshot}
                  </span>
                  <span>{formatCents(unit * item.qty)}</span>
                </div>
                {item.order_item_modifiers.map((m, i) => (
                  <div key={i} className="flex justify-between text-gray-500">
                    <span className="pl-4">{m.name_snapshot}</span>
                    {m.price_snapshot_cents > 0 && (
                      <span>+{formatCents(m.price_snapshot_cents)}</span>
                    )}
                  </div>
                ))}
                {item.notes && (
                  <p className="pl-4 text-xs text-amber-700">“{item.notes}”</p>
                )}
              </div>
            );
          }
        )}
        {order.special_instructions && (
          <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
            “{order.special_instructions}”
          </p>
        )}
      </section>

      <section className="mb-4 rounded-lg border border-black/10 bg-white p-4">
        <h2 className="mb-2 font-semibold">Payment</h2>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-600">Subtotal</dt>
            <dd>{formatCents(order.subtotal_cents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Tax</dt>
            <dd>{formatCents(order.tax_cents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Tip</dt>
            <dd>{formatCents(order.tip_cents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Service fee (diner-paid)</dt>
            <dd>{formatCents(order.platform_fee_cents)}</dd>
          </div>
          {order.delivery_fee_cents > 0 && (
            <div className="flex justify-between">
              <dt className="text-gray-600">Delivery fee</dt>
              <dd>{formatCents(order.delivery_fee_cents)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-black/10 pt-2 font-bold">
            <dt>Total</dt>
            <dd>{formatCents(order.total_cents)}</dd>
          </div>
        </dl>
        {order.stripe_payment_intent_id && (
          <p className="mt-2 text-xs text-gray-400">
            {order.stripe_payment_intent_id.startsWith("pi_mock_")
              ? "Test payment (mock provider)"
              : "Stripe"}{" "}
            · {order.stripe_payment_intent_id}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-black/10 bg-white p-4">
        <h2 className="mb-2 font-semibold">Timeline</h2>
        <ol className="space-y-1 text-sm">
          {events.map((e, i) => (
            <li key={i} className="flex justify-between">
              <span className="font-medium">{e.status}</span>
              <span className="text-gray-500">
                {e.actor !== "system" && `${e.actor} · `}
                {fmtTime(e.created_at)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
