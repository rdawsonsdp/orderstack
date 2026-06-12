import "server-only";
import type Stripe from "stripe";

/**
 * Human-readable payment-method label for the owner-facing Payments tab and
 * order detail audit panel, derived from a charge's payment_method_details.
 *
 * Mirrors the label logic in lib/payments/stripe.ts getAudit() — keep the two
 * in sync (extracted here so the webhook doesn't depend on the provider file).
 *
 *   card wallet (apple_pay, google_pay, link…) → "Apple Pay" / "Google Pay"
 *   plain card                                 → "VISA •••• 4242"
 *   anything else                              → the payment method type
 */
export function paymentMethodLabelFromCharge(
  charge: Stripe.Charge | null | undefined
): string {
  const pm = charge?.payment_method_details;
  const wallet = pm?.card?.wallet?.type;
  if (wallet) {
    return wallet.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (pm?.card) {
    return `${(pm.card.brand ?? "Card").toUpperCase()} •••• ${pm.card.last4 ?? "????"}`;
  }
  return pm?.type ?? "Unknown";
}
