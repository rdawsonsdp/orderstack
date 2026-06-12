import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cartSchema, priceOrder, PricingError } from "@/lib/pricing";
import { loadPricingContext } from "@/lib/pricing-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaymentProvider } from "@/lib/payments/provider";

const orderRequestSchema = z.object({
  cart: cartSchema,
  customer: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254),
    phone: z.string().trim().max(30).nullish(),
  }),
});

/**
 * POST /api/orders — create an order from a cart:
 * re-price server-side → insert customer + order + snapshotted lines
 * (pending_payment) → create payment intent. The order moves to `placed`
 * only via the payment webhook (or mock confirm), never from here.
 */
export async function POST(request: NextRequest) {
  let body;
  try {
    body = orderRequestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "INVALID_REQUEST", issues: err.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const { cart, customer } = body;

  const result = await loadPricingContext(cart);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  let priced;
  try {
    priced = priceOrder(cart, result.ctx);
  } catch (err) {
    if (err instanceof PricingError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 422 }
      );
    }
    throw err;
  }

  const admin = createAdminClient();

  const { data: customerRow, error: customerError } = await admin
    .from("customers")
    .insert({
      name: customer.name,
      email: customer.email,
      phone: customer.phone ?? null,
    })
    .select("id")
    .single();
  if (customerError || !customerRow) {
    return NextResponse.json({ error: "CUSTOMER_CREATE_FAILED" }, { status: 500 });
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      restaurant_id: result.location.restaurant_id,
      location_id: cart.locationId,
      customer_id: customerRow.id,
      type: cart.type,
      status: "pending_payment",
      scheduled_for: cart.scheduledFor ?? null,
      special_instructions: cart.specialInstructions ?? null,
      subtotal_cents: priced.subtotalCents,
      tax_cents: priced.taxCents,
      tip_cents: priced.tipCents,
      delivery_fee_cents: priced.deliveryFeeCents,
      platform_fee_cents: priced.platformFeeCents,
      total_cents: priced.totalCents,
    })
    .select("id, public_token, order_number")
    .single();
  if (orderError || !order) {
    return NextResponse.json({ error: "ORDER_CREATE_FAILED" }, { status: 500 });
  }

  for (const line of priced.lines) {
    const { data: orderItem, error: lineError } = await admin
      .from("order_items")
      .insert({
        order_id: order.id,
        item_id: line.itemId,
        name_snapshot: line.nameSnapshot,
        price_snapshot_cents: line.priceSnapshotCents,
        qty: line.qty,
        notes: line.notes,
      })
      .select("id")
      .single();
    if (lineError || !orderItem) {
      return NextResponse.json({ error: "ORDER_ITEMS_FAILED" }, { status: 500 });
    }
    if (line.modifiers.length > 0) {
      const { error: modError } = await admin.from("order_item_modifiers").insert(
        line.modifiers.map((m) => ({
          order_item_id: orderItem.id,
          modifier_id: m.modifierId,
          name_snapshot: m.nameSnapshot,
          price_snapshot_cents: m.priceSnapshotCents,
        }))
      );
      if (modError) {
        return NextResponse.json({ error: "ORDER_ITEMS_FAILED" }, { status: 500 });
      }
    }
  }

  const provider = await getPaymentProvider();
  const intent = await provider.createPaymentIntent({
    amountCents: priced.totalCents,
    orderId: order.id,
    customerEmail: customer.email,
  });

  const { error: intentError } = await admin
    .from("orders")
    .update({ stripe_payment_intent_id: intent.id })
    .eq("id", order.id);
  if (intentError) {
    return NextResponse.json({ error: "ORDER_UPDATE_FAILED" }, { status: 500 });
  }

  return NextResponse.json({
    orderId: order.id,
    orderNumber: order.order_number,
    publicToken: order.public_token,
    totals: priced,
    payment: {
      provider: provider.name,
      intentId: intent.id,
      clientSecret: intent.clientSecret,
      isMock: intent.isMock,
    },
  });
}
