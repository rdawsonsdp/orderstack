-- Atomic coupon redemption counting. The previous read-then-write increment
-- at order creation could under-count concurrently and counted unpaid
-- (pending_payment) orders. Now: a single atomic UPDATE, called by the
-- payment webhook / mock confirm when an order actually becomes `placed`.

create or replace function increment_coupon_redemption(coupon uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update coupons
  set redemption_count = redemption_count + 1
  where id = coupon;
$$;

-- Server-side (service role) only — diners and staff never call this.
revoke execute on function increment_coupon_redemption(uuid) from public, anon, authenticated;
grant execute on function increment_coupon_redemption(uuid) to service_role;
