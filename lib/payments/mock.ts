import "server-only";
import { randomUUID } from "node:crypto";
import type { PaymentProvider } from "./provider";

/**
 * Mock payment provider — active while STRIPE_SECRET_KEY is unset.
 * createPaymentIntent issues a fake intent id; the client then "pays" by
 * calling /api/payments/mock/confirm, which plays the role of the Stripe
 * webhook (the only path that moves an order to `placed`). No money moves.
 */
export const mockProvider: PaymentProvider = {
  name: "mock",
  async createPaymentIntent({ amountCents, orderId }) {
    void amountCents;
    void orderId;
    const id = `pi_mock_${randomUUID().replaceAll("-", "")}`;
    return { id, clientSecret: `${id}_secret`, isMock: true };
  },
  // Simulated audit: echoes what our DB recorded at confirm time so the
  // audit panel renders; the real independent check arrives with Stripe.
  async getAudit({ intentId }) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data: order } = await createAdminClient()
      .from("orders")
      .select("total_cents, paid_at, payment_method_label, status")
      .eq("stripe_payment_intent_id", intentId)
      .single();
    if (!order) return null;
    const paid = order.paid_at !== null;
    return {
      provider: "mock",
      status: paid ? "succeeded" : "requires_payment",
      amountCents: order.total_cents,
      methodLabel: order.payment_method_label ?? "Test payment",
      paidAt: order.paid_at,
      receiptUrl: null,
      isMock: true,
    };
  },
  async refund({ intentId }) {
    // No money moved, nothing to reverse — succeed so the order flow
    // (rejected → refunded) behaves exactly as it will with Stripe.
    void intentId;
    return { ok: true };
  },
};
