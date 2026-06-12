import "server-only";
import Stripe from "stripe";
import type { PaymentProvider } from "./provider";

/**
 * Real Stripe provider — selected automatically once STRIPE_SECRET_KEY is set.
 * Phase 1: direct charge on the platform account. Phase 2 switches to Connect
 * destination charges (transfer_data.destination + application_fee_amount).
 *
 * Webhook: app/api/webhooks/stripe handles payment_intent.succeeded → placed.
 */
export const stripeProvider: PaymentProvider = {
  name: "stripe",
  async createPaymentIntent({ amountCents, orderId, customerEmail }) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      receipt_email: customerEmail,
      metadata: { order_id: orderId },
      automatic_payment_methods: { enabled: true },
    });
    return {
      id: intent.id,
      clientSecret: intent.client_secret!,
      isMock: false,
    };
  },
};
