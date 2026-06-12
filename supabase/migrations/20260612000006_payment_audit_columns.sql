-- Payment transparency for owners: capture how/when an order was paid at
-- webhook time so the dashboard Payments tab reads instantly without
-- round-tripping Stripe per order. The live cross-check against the provider
-- happens on the order detail "Payment audit" panel.

alter table orders
  add column paid_at timestamptz,
  add column payment_method_label text, -- e.g. "Visa •••• 4242", "Apple Pay"
  add column receipt_url text;
