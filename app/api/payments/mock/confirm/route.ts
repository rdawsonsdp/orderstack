import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  notifyDinerOrderPlaced,
  notifyOwnerNewOrder,
  type OrderSummaryForNotice,
} from "@/lib/notifications";

const confirmSchema = z.object({
  intentId: z.string().startsWith("pi_mock_"),
});

// supabase-js can't infer many-to-one join shapes without generated DB types
// (same pattern as lib/pricing-server.ts).
type ConfirmOrderRow = {
  id: string;
  status: string;
  public_token: string;
  order_number: number;
  total_cents: number;
  scheduled_for: string | null;
  customers: { email: string; phone: string | null } | null;
  restaurants: { name: string; slug: string } | null;
  locations: { alert_email: string | null; alert_phone: string | null } | null;
  order_items: { qty: number; name_snapshot: string }[];
};

/**
 * POST /api/payments/mock/confirm — stand-in for the Stripe webhook while
 * STRIPE_SECRET_KEY is unset. Plays the same role: the ONLY code path that
 * moves an order pending_payment → placed. Disabled the moment real Stripe
 * is configured (app/api/webhooks/stripe takes over).
 */
export async function POST(request: NextRequest) {
  if (process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "MOCK_DISABLED" }, { status: 404 });
  }

  let body;
  try {
    body = confirmSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: order } = (await admin
    .from("orders")
    .select(
      `id, status, public_token, order_number, total_cents, scheduled_for,
       customers (email, phone),
       restaurants (name, slug),
       locations (alert_email, alert_phone),
       order_items (qty, name_snapshot)`
    )
    .eq("stripe_payment_intent_id", body.intentId)
    .single()) as { data: ConfirmOrderRow | null };

  if (!order) {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }
  if (order.status !== "pending_payment") {
    // Idempotent like a real webhook: already-placed is success (and the
    // first call already sent the notifications).
    return NextResponse.json({ ok: true, publicToken: order.public_token });
  }

  // Record payment facts exactly as the Stripe webhook will: paid time and
  // method label feed the owner-facing Payments tab and audit panel.
  const { error } = await admin
    .from("orders")
    .update({
      status: "placed",
      paid_at: new Date().toISOString(),
      payment_method_label: "Test card •••• 4242 (simulated)",
    })
    .eq("id", order.id)
    .eq("status", "pending_payment");
  if (error) {
    return NextResponse.json({ error: "TRANSITION_FAILED" }, { status: 500 });
  }

  // Notify diner + owner. Senders swallow transport errors, so a failed
  // notification never changes the response.
  const summary: OrderSummaryForNotice = {
    orderNumber: order.order_number,
    restaurantName: order.restaurants?.name ?? "",
    totalCents: order.total_cents,
    trackingUrl: `${request.nextUrl.origin}/${order.restaurants?.slug}/track/${order.public_token}`,
    items: order.order_items.map((i) => ({ qty: i.qty, name: i.name_snapshot })),
    scheduledFor: order.scheduled_for,
  };
  await Promise.all([
    order.customers?.email
      ? notifyDinerOrderPlaced(order.customers.email, order.customers.phone, summary)
      : Promise.resolve(),
    notifyOwnerNewOrder(
      order.locations?.alert_email ?? null,
      order.locations?.alert_phone ?? null,
      summary
    ),
  ]);

  return NextResponse.json({ ok: true, publicToken: order.public_token });
}
