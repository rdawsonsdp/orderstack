import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const confirmSchema = z.object({
  intentId: z.string().startsWith("pi_mock_"),
});

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
  const { data: order } = await admin
    .from("orders")
    .select("id, status, public_token")
    .eq("stripe_payment_intent_id", body.intentId)
    .single();

  if (!order) {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }
  if (order.status !== "pending_payment") {
    // Idempotent like a real webhook: already-placed is success.
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

  return NextResponse.json({ ok: true, publicToken: order.public_token });
}
