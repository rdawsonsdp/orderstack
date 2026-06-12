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
  // Independent record straight from Stripe — what the audit panel compares
  // our DB against so owners can trust the money trail.
  async getAudit({ intentId }) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const intent = await stripe.paymentIntents.retrieve(intentId, {
      expand: ["latest_charge"],
    });
    const charge = intent.latest_charge as Stripe.Charge | null;
    const pm = charge?.payment_method_details;
    const wallet = pm?.card?.wallet?.type; // apple_pay, google_pay, link…
    const methodLabel = wallet
      ? wallet.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : pm?.card
        ? `${(pm.card.brand ?? "Card").toUpperCase()} •••• ${pm.card.last4 ?? "????"}`
        : (pm?.type ?? "Unknown");
    return {
      provider: "stripe",
      status: intent.status,
      amountCents: intent.amount,
      methodLabel,
      paidAt: charge?.created ? new Date(charge.created * 1000).toISOString() : null,
      receiptUrl: charge?.receipt_url ?? null,
      isMock: false,
    };
  },
  async refund({ intentId }) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    try {
      // Phase 2 Connect: add reverse_transfer so the restaurant's share
      // claws back correctly on destination charges.
      await stripe.refunds.create({ payment_intent: intentId });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
};
