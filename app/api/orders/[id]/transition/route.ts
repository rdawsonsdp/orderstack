import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ORDER_STATUSES,
  canTransition,
  type OrderStatus,
} from "@/lib/orders/state-machine";
import { getPaymentProvider } from "@/lib/payments/provider";
import {
  notifyDinerStatus,
  type OrderSummaryForNotice,
} from "@/lib/notifications";

const paramsSchema = z.object({ id: z.guid() });

const bodySchema = z.object({
  status: z.enum(ORDER_STATUSES),
  promisedAt: z.iso.datetime({ offset: true }).optional(),
});

/** Statuses the diner is told about (notifications swallow transport errors). */
const NOTIFY_STATUSES: readonly OrderStatus[] = [
  "accepted",
  "ready",
  "rejected",
  "refunded",
];

// supabase-js can't infer many-to-one join shapes without generated DB types
// (same pattern as lib/pricing-server.ts).
type OrderRow = {
  id: string;
  status: OrderStatus;
  restaurant_id: string;
  order_number: number;
  total_cents: number;
  public_token: string;
  scheduled_for: string | null;
  promised_at: string | null;
  stripe_payment_intent_id: string | null;
  customers: { name: string; email: string; phone: string | null } | null;
  restaurants: { name: string; slug: string } | null;
  order_items: { qty: number; name_snapshot: string }[];
};

/**
 * POST /api/orders/[id]/transition — staff moves an order through the state
 * machine. Auth = signed-in user with a staff_memberships row for the order's
 * restaurant. Writes go through the admin client with an optimistic
 * `.eq("status", current)` guard; the DB trigger is the final enforcement
 * layer and auto-logs order_events.
 *
 * Rejecting a paid order also refunds it: placed → rejected, then on a
 * successful provider refund, rejected → refunded in a second step.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "INVALID_ORDER_ID" }, { status: 400 });
  }
  const orderId = parsedParams.data.id;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "INVALID_REQUEST", issues: err.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const to = body.status;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: order } = (await admin
    .from("orders")
    .select(
      `id, status, restaurant_id, order_number, total_cents, public_token,
       scheduled_for, promised_at, stripe_payment_intent_id,
       customers (name, email, phone),
       restaurants (name, slug),
       order_items (qty, name_snapshot)`
    )
    .eq("id", orderId)
    .single()) as { data: OrderRow | null };
  if (!order) {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("staff_memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("restaurant_id", order.restaurant_id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const from = order.status;
  if (!canTransition(from, to)) {
    return NextResponse.json(
      {
        error: "INVALID_TRANSITION",
        message: `Can't move order #${order.order_number} from "${from}" to "${to}".`,
      },
      { status: 409 }
    );
  }

  // Optimistic guard: only update if the status is still what we loaded.
  // The DB trigger re-validates and auto-logs order_events.
  const update: { status: OrderStatus; promised_at?: string } = { status: to };
  if (body.promisedAt) update.promised_at = body.promisedAt;
  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update(update)
    .eq("id", order.id)
    .eq("status", from)
    .select("id");
  if (updateError) {
    return NextResponse.json(
      { error: "TRANSITION_FAILED", message: updateError.message },
      { status: 500 }
    );
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      {
        error: "STALE_STATUS",
        message: `Order #${order.order_number} changed status while you were looking — refresh and try again.`,
      },
      { status: 409 }
    );
  }

  let finalStatus: OrderStatus = to;
  let refunded = false;
  let refundError: string | undefined;

  // Reject flow: refund the payment, then mark refunded on success.
  if (to === "rejected" && order.stripe_payment_intent_id) {
    const provider = await getPaymentProvider();
    const refund = await provider.refund({
      intentId: order.stripe_payment_intent_id,
    });
    if (refund.ok) {
      const { data: refundedRows } = await admin
        .from("orders")
        .update({ status: "refunded" satisfies OrderStatus })
        .eq("id", order.id)
        .eq("status", "rejected")
        .select("id");
      if (refundedRows && refundedRows.length > 0) {
        finalStatus = "refunded";
        refunded = true;
      } else {
        refundError = "Refund succeeded but the order couldn't be marked refunded.";
      }
    } else {
      refundError = refund.error ?? "Refund failed — refund manually from the payment provider.";
    }
  }

  // Fire-and-forget diner notifications (they swallow transport errors).
  if (NOTIFY_STATUSES.includes(finalStatus) && order.customers?.email) {
    const summary: OrderSummaryForNotice = {
      orderNumber: order.order_number,
      restaurantName: order.restaurants?.name ?? "",
      totalCents: order.total_cents,
      trackingUrl: `${request.nextUrl.origin}/${order.restaurants?.slug}/track/${order.public_token}`,
      items: order.order_items.map((i) => ({ qty: i.qty, name: i.name_snapshot })),
      scheduledFor: order.scheduled_for,
    };
    await notifyDinerStatus(
      order.customers.phone,
      order.customers.email,
      summary,
      finalStatus,
      body.promisedAt ?? order.promised_at
    );
  }

  if (to === "rejected" && order.stripe_payment_intent_id) {
    return NextResponse.json({ status: finalStatus, refunded, refundError });
  }
  return NextResponse.json({ status: finalStatus });
}
