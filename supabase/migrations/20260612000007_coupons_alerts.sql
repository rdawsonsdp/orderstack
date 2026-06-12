-- Coupons/promos + restaurant alert contacts.

create table coupons (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants (id) on delete cascade,
  code               text not null check (code = upper(code) and length(code) between 3 and 24),
  kind               text not null check (kind in ('percent', 'fixed')),
  -- percent: 1-100; fixed: cents off
  value              integer not null check (value > 0),
  min_subtotal_cents integer not null default 0 check (min_subtotal_cents >= 0),
  starts_at          timestamptz,
  expires_at         timestamptz,
  max_redemptions    integer check (max_redemptions > 0),
  redemption_count   integer not null default 0 check (redemption_count >= 0),
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (restaurant_id, code),
  check (kind <> 'percent' or value <= 100)
);

create index coupons_restaurant_id_idx on coupons (restaurant_id);

alter table coupons enable row level security;

create policy "staff manage own coupons" on coupons
  for all to authenticated
  using (restaurant_id in (select app_user_restaurant_ids()))
  with check (restaurant_id in (select app_user_restaurant_ids()));
-- Diners never read coupons directly: codes are validated server-side
-- (service role) so the catalog isn't enumerable.

alter table orders
  add column coupon_id uuid references coupons (id),
  add column discount_cents integer not null default 0 check (discount_cents >= 0);

-- Where to ping the restaurant when an order lands (beyond the dashboard tab).
alter table locations
  add column alert_email text,
  add column alert_phone text;
