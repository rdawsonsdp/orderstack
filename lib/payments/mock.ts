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
};
