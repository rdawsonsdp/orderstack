import "server-only";

/**
 * Payment provider abstraction. Stripe is the real implementation (Phase 1
 * Session 3+); the mock stands in until keys are configured. Selection is by
 * env: STRIPE_SECRET_KEY present → stripe, else mock.
 *
 * Invariant regardless of provider: an order only moves to `placed` via the
 * provider's webhook/confirm endpoint — never the client redirect.
 */

export interface PaymentIntentResult {
  /** Provider intent id, stored on orders.stripe_payment_intent_id */
  id: string;
  /** Secret the client uses to confirm payment (Stripe Elements); mock: token */
  clientSecret: string;
  /** True when this is the mock provider (UI shows test-mode banner) */
  isMock: boolean;
}

export interface PaymentProvider {
  name: "stripe" | "mock";
  createPaymentIntent(params: {
    amountCents: number;
    orderId: string;
    customerEmail: string;
  }): Promise<PaymentIntentResult>;
}

export async function getPaymentProvider(): Promise<PaymentProvider> {
  if (process.env.STRIPE_SECRET_KEY) {
    const { stripeProvider } = await import("./stripe");
    return stripeProvider;
  }
  const { mockProvider } = await import("./mock");
  return mockProvider;
}
