import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCents } from "@/lib/menu-types";
import { AutoRefresh } from "@/components/storefront/auto-refresh";
import type { OrderStatus } from "@/lib/orders/state-machine";

export const dynamic = "force-dynamic";

const STATUS_COPY: Partial<Record<OrderStatus, { title: string; detail: string }>> = {
  pending_payment: { title: "Finishing payment…", detail: "Hold tight." },
  placed: {
    title: "Order received",
    detail: "Waiting for the restaurant to confirm.",
  },
  accepted: { title: "Confirmed", detail: "The kitchen has your order." },
  preparing: { title: "Being prepared", detail: "Your food is on the stove." },
  ready: { title: "Ready for pickup!", detail: "Come on in." },
  completed: { title: "Picked up", detail: "Enjoy — thanks for ordering." },
  rejected: {
    title: "Order declined",
    detail: "The restaurant couldn't take this order. You will be refunded.",
  },
  canceled: { title: "Canceled", detail: "This order was canceled." },
  refunded: { title: "Refunded", detail: "Your payment was returned." },
};

/**
 * Guest order tracking — addressed by unguessable public_token (no login).
 * Reads via service role; RLS has no anon path to orders by design.
 */
export default async function TrackPage({
  params,
}: {
  params: Promise<{ tenant: string; token: string }>;
}) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select(
      `id, order_number, status, type, total_cents, placed_at, promised_at,
       special_instructions,
       restaurants (name, branding),
       locations (address_line1, address_line2, city, state, phone),
       order_items (id, name_snapshot, qty,
         order_item_modifiers (name_snapshot)),
       order_events (status, created_at)`
    )
    .eq("public_token", token)
    .single();

  if (!order) notFound();

  const restaurant = order.restaurants as unknown as {
    name: string;
    branding: { colors?: { primary?: string; accent?: string } } | null;
  };
  const location = order.locations as unknown as {
    address_line1: string;
    address_line2: string | null;
    city: string;
    state: string;
    phone: string | null;
  };
  const copy = STATUS_COPY[order.status as OrderStatus] ?? {
    title: order.status,
    detail: "",
  };
  const primary = restaurant.branding?.colors?.primary ?? "#111827";
  const live = !["completed", "rejected", "canceled", "refunded"].includes(
    order.status
  );

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      {live && <AutoRefresh intervalMs={8000} />}

      <p className="text-sm text-gray-500">
        {restaurant.name} · Order #{order.order_number}
      </p>
      <h1 className="mt-1 text-3xl font-bold" style={{ color: primary }}>
        {copy.title}
      </h1>
      <p className="mt-1 text-gray-600">{copy.detail}</p>

      <ol className="my-6 space-y-2 border-l-2 pl-4" style={{ borderColor: primary }}>
        {(order.order_events ?? [])
          .sort(
            (a: { created_at: string }, b: { created_at: string }) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          )
          .map((e: { status: string; created_at: string }, i: number) => (
            <li key={i} className="text-sm">
              <span className="font-medium">
                {STATUS_COPY[e.status as OrderStatus]?.title ?? e.status}
              </span>{" "}
              <span className="text-gray-500">
                {new Date(e.created_at).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </li>
          ))}
      </ol>

      <section className="rounded-lg border border-black/10 p-4">
        <h2 className="mb-2 font-semibold">Order details</h2>
        {(order.order_items ?? []).map(
          (item: {
            id: string;
            name_snapshot: string;
            qty: number;
            order_item_modifiers: { name_snapshot: string }[];
          }) => (
            <div key={item.id} className="mb-1 text-sm">
              {item.qty} × {item.name_snapshot}
              {item.order_item_modifiers.length > 0 && (
                <span className="text-gray-500">
                  {" "}
                  ({item.order_item_modifiers.map((m) => m.name_snapshot).join(", ")})
                </span>
              )}
            </div>
          )
        )}
        <p className="mt-2 border-t border-black/10 pt-2 text-sm font-semibold">
          Total {formatCents(order.total_cents)}
        </p>
      </section>

      <p className="mt-6 text-sm text-gray-600">
        Pickup: {location.address_line1}
        {location.address_line2 ? `, ${location.address_line2}` : ""},{" "}
        {location.city}, {location.state}
        {location.phone && (
          <>
            {" · "}
            <a href={`tel:${location.phone}`} className="underline">
              {location.phone}
            </a>
          </>
        )}
      </p>
    </main>
  );
}
