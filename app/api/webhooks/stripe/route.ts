import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  notifyDinerOrderPlaced,
  notifyOwnerNewOrder,
  type OrderSummaryForNotice,
} from "@/lib/notifications";
import { paymentMethodLabelFromCharge } from "@/lib/payments/stripe-labels";

/**
 * POST /api/webhooks/stripe — the ONLY code path that moves a real-money
 * order pending_payment → placed (AGENTS.md invariant; the client redirect
 * never does). Until STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET are set this
 * endpoint answers 503 and the mock confirm route stands in.
 *
 * Raw body: App Router route handlers hand us the unparsed body via
 * `request.text()` natively — no bodyParser config needed (that was a
 * pages/api concern). Signature verification requires the exact raw bytes.
 *
 * Handled events:
 *   payment_intent.succeeded     → placed + paid_at/method label/receipt,
 *                                  then diner + owner notifications
 *   charge.refunded              → rejected|canceled|completed → refunded
 *   payment_intent.payment_failed→ log only (diner can retry; the order
 *                                  stays pending_payment, invisible to kitchen)
 * Everything is idempotent — Stripe retries and duplicates are expected.
 *
 * Phase 2 (Connect destination charges) TODO: refunds will arrive with
 * reverse_transfer / transfer_reversal data and events may carry an
 * `account` field — revisit charge.refunded handling then.
 */
export async function POST(request: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return NextResponse.json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 503 });
  }

  const stripe = new Stripe(secretKey);
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature ?? "", webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", (err as Error).message);
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
  }

  switch (event.type) {
    case "payment_intent.succeeded":
      return handlePaymentSucceeded(stripe, event.data.object, request);
    case "charge.refunded":
      return handleChargeRefunded(event.data.object);
    case "payment_intent.payment_failed":
      return handlePaymentFailed(event.data.object);
    default:
      // Acknowledge everything else so Stripe doesn't retry events we ignore.
      return NextResponse.json({ received: true });
  }
}

/**
 * Embedded many-to-one joins come back as a single object at runtime, but the
 * untyped supabase client infers them as arrays — accept either shape.
 */
function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

async function handlePaymentSucceeded(
  stripe: Stripe,
  intent: Stripe.PaymentIntent,
  request: NextRequest
) {
  const admin = createAdminClient();

  const { data: order, error: fetchError } = await admin
    .from("orders")
    .select(
      `id, status, order_number, public_token, total_cents, scheduled_for, coupon_id, restaurant_id,
       customers ( name, email, phone ),
       restaurants ( name, slug ),
       locations ( alert_email, alert_phone ),
       order_items ( qty, name_snapshot )`
    )
    .eq("stripe_payment_intent_id", intent.id)
    .maybeSingle();

  if (fetchError) {
    console.error("[stripe-webhook] order lookup failed:", fetchError.message);
    return NextResponse.json({ error: "LOOKUP_FAILED" }, { status: 500 });
  }
  if (!order) {
    // Not one of ours (e.g. another product on the same Stripe account).
    return NextResponse.json({ received: true });
  }
  if (order.status !== "pending_payment") {
    // Already placed (or further along) — duplicate delivery, success.
    return NextResponse.json({ received: true });
  }

  // Payment facts come from the charge. The webhook payload usually carries
  // latest_charge as a bare id, so fall back to retrieving it expanded.
  let charge: Stripe.Charge | null = null;
  if (intent.latest_charge && typeof intent.latest_charge === "object") {
    charge = intent.latest_charge;
  } else {
    try {
      const full = await stripe.paymentIntents.retrieve(intent.id, {
        expand: ["latest_charge"],
      });
      charge = (full.latest_charge as Stripe.Charge | null) ?? null;
    } catch (err) {
      // Label/receipt are nice-to-have; never block the placed transition.
      console.error(
        "[stripe-webhook] charge retrieve failed for",
        intent.id,
        (err as Error).message
      );
    }
  }

  // Guarded update: the status filter makes concurrent duplicate deliveries
  // a no-op (only one wins the pending_payment row).
  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update({
      status: "placed",
      paid_at: new Date().toISOString(),
      payment_method_label: paymentMethodLabelFromCharge(charge),
      receipt_url: charge?.receipt_url ?? null,
    })
    .eq("id", order.id)
    .eq("status", "pending_payment")
    .select("id");

  if (updateError) {
    console.error("[stripe-webhook] placed transition failed:", updateError.message);
    return NextResponse.json({ error: "TRANSITION_FAILED" }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    // A concurrent delivery beat us to it — it owns the notifications.
    return NextResponse.json({ received: true });
  }

  // Payment landed — count the coupon redemption atomically.
  if (order.coupon_id) {
    await admin.rpc("increment_coupon_redemption", { coupon: order.coupon_id });
  }

  // Queue the kitchen ticket for the CloudPRNT printer (no-op without one).
  await admin
    .from("print_jobs")
    .insert({ restaurant_id: order.restaurant_id, order_id: order.id });

  // Notifications are best-effort: a failed send must never fail the webhook
  // (the order is already placed; Stripe retrying would double-notify).
  try {
    const customer = one<{ name: string; email: string; phone: string | null }>(
      order.customers
    );
    const restaurant = one<{ name: string; slug: string }>(order.restaurants);
    const location = one<{ alert_email: string | null; alert_phone: string | null }>(
      order.locations
    );
    const items = (order.order_items ?? []) as Array<{
      qty: number;
      name_snapshot: string;
    }>;

    const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? request.nextUrl.origin;
    const summary: OrderSummaryForNotice = {
      orderNumber: order.order_number,
      restaurantName: restaurant?.name ?? "Your restaurant",
      totalCents: order.total_cents,
      trackingUrl: `${appOrigin}/${restaurant?.slug}/track/${order.public_token}`,
      items: items.map((i) => ({ qty: i.qty, name: i.name_snapshot })),
      scheduledFor: order.scheduled_for,
    };

    if (customer?.email) {
      await notifyDinerOrderPlaced(customer.email, customer.phone ?? null, summary);
    }
    await notifyOwnerNewOrder(
      location?.alert_email ?? null,
      location?.alert_phone ?? null,
      summary
    );
  } catch (err) {
    console.error("[stripe-webhook] notifications failed:", (err as Error).message);
  }

  return NextResponse.json({ received: true });
}

/** Statuses the DB trigger allows to move to refunded. */
const REFUNDABLE_STATUSES = ["rejected", "canceled", "completed"];

async function handleChargeRefunded(charge: Stripe.Charge) {
  const intentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!intentId) {
    return NextResponse.json({ received: true });
  }

  const admin = createAdminClient();
  const { data: order, error: fetchError } = await admin
    .from("orders")
    .select("id, status, order_number")
    .eq("stripe_payment_intent_id", intentId)
    .maybeSingle();

  if (fetchError) {
    console.error("[stripe-webhook] refund lookup failed:", fetchError.message);
    return NextResponse.json({ error: "LOOKUP_FAILED" }, { status: 500 });
  }
  if (!order || !REFUNDABLE_STATUSES.includes(order.status)) {
    // Unknown intent, already refunded, or a status the trigger won't move
    // from (e.g. refund landed before reject) — acknowledge and move on.
    return NextResponse.json({ received: true });
  }

  const { error: updateError } = await admin
    .from("orders")
    .update({ status: "refunded" })
    .eq("id", order.id)
    .in("status", REFUNDABLE_STATUSES);

  if (updateError) {
    console.error(
      `[stripe-webhook] refunded transition failed for order #${order.order_number}:`,
      updateError.message
    );
    return NextResponse.json({ error: "TRANSITION_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handlePaymentFailed(intent: Stripe.PaymentIntent) {
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("order_number")
    .eq("stripe_payment_intent_id", intent.id)
    .maybeSingle();

  // No status change: the diner can retry on the same intent, and orders
  // stuck in pending_payment are invisible to the kitchen anyway.
  console.error(
    `[stripe-webhook] payment failed for order #${order?.order_number ?? "unknown"}` +
      ` (intent ${intent.id}): ${intent.last_payment_error?.message ?? "no error detail"}`
  );
  return NextResponse.json({ received: true });
}
