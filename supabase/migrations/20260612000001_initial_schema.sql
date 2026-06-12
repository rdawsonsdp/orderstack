-- OrderStack initial schema
-- Conventions: all money is integer cents; all tenant-owned tables carry
-- restaurant_id (directly or via parent) and are protected by RLS (see 0002).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type restaurant_status as enum ('draft', 'onboarding', 'live', 'paused');

create type order_type as enum ('pickup', 'delivery');

create type order_status as enum (
  'pending_payment',
  'placed',
  'accepted',
  'preparing',
  'ready',
  'courier_assigned',
  'picked_up',
  'delivered',
  'completed',
  'rejected',
  'canceled',
  'refunded'
);

create type delivery_provider as enum ('uber', 'doordash');

create type staff_role as enum ('owner', 'manager', 'staff');

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table restaurants (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique check (slug ~ '^[a-z0-9](-?[a-z0-9])*$'),
  name               text not null,
  custom_domain      text unique,
  branding           jsonb not null default '{}',
  timezone           text not null default 'America/Chicago',
  stripe_account_id  text unique,
  charges_enabled    boolean not null default false,
  status             restaurant_status not null default 'draft',
  -- Diner-paid convenience fee, skimmed via Stripe application_fee_amount
  platform_fee_cents integer not null default 129 check (platform_fee_cents >= 0),
  plan               text not null default 'free',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table locations (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants (id) on delete cascade,
  name              text not null default 'Main',
  address_line1     text not null,
  address_line2     text,
  city              text not null,
  state             text not null,
  postal_code       text not null,
  lat               double precision,
  lng               double precision,
  phone             text,
  pickup_enabled    boolean not null default true,
  delivery_enabled  boolean not null default false,
  delivery_radius_m integer check (delivery_radius_m > 0),
  prep_time_min     integer not null default 20 check (prep_time_min >= 0),
  -- e.g. 0.10750 = Chicago 10.75% prepared-food rate; Stripe Tax is a later swap
  tax_rate          numeric(6, 5) not null default 0 check (tax_rate >= 0 and tax_rate < 1),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index locations_restaurant_id_idx on locations (restaurant_id);

create table business_hours (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday
  opens       time not null,
  closes      time not null
);

create index business_hours_location_id_idx on business_hours (location_id);

create table hour_overrides (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  date        date not null,
  closed      boolean not null default false,
  opens       time,
  closes      time,
  unique (location_id, date),
  check (closed or (opens is not null and closes is not null))
);

-- ---------------------------------------------------------------------------
-- Menu
-- ---------------------------------------------------------------------------

create table menus (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name          text not null default 'Main Menu',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index menus_restaurant_id_idx on menus (restaurant_id);

create table categories (
  id             uuid primary key default gen_random_uuid(),
  menu_id        uuid not null references menus (id) on delete cascade,
  name           text not null,
  sort           integer not null default 0,
  available_from time, -- null = all day; e.g. lunch-only categories
  available_to   time
);

create index categories_menu_id_idx on categories (menu_id);

create table items (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references categories (id) on delete cascade,
  name           text not null,
  description    text,
  price_cents    integer not null check (price_cents >= 0),
  image_path     text, -- Supabase Storage path
  sort           integer not null default 0,
  is_available   boolean not null default true,
  sold_out_until timestamptz, -- the "86" switch
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index items_category_id_idx on items (category_id);

create table modifier_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name          text not null,
  min_select    integer not null default 0 check (min_select >= 0),
  max_select    integer check (max_select >= 1), -- null = unlimited
  required      boolean not null default false,
  check (max_select is null or max_select >= min_select)
);

create index modifier_groups_restaurant_id_idx on modifier_groups (restaurant_id);

-- Modifier groups are reusable across items
create table item_modifier_groups (
  item_id           uuid not null references items (id) on delete cascade,
  modifier_group_id uuid not null references modifier_groups (id) on delete cascade,
  sort              integer not null default 0,
  primary key (item_id, modifier_group_id)
);

create table modifiers (
  id                uuid primary key default gen_random_uuid(),
  modifier_group_id uuid not null references modifier_groups (id) on delete cascade,
  name              text not null,
  price_delta_cents integer not null default 0,
  is_available      boolean not null default true,
  sort              integer not null default 0
);

create index modifiers_group_id_idx on modifiers (modifier_group_id);

-- ---------------------------------------------------------------------------
-- Customers & orders
-- ---------------------------------------------------------------------------

create table customers (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null, -- null = guest
  name         text not null,
  email        text not null,
  phone        text,
  created_at   timestamptz not null default now()
);

create index customers_email_idx on customers (email);

create table orders (
  id                       uuid primary key default gen_random_uuid(),
  -- Tracking-page access for guests: unguessable token, never listed
  public_token             uuid not null unique default gen_random_uuid(),
  order_number             bigint generated always as identity,
  restaurant_id            uuid not null references restaurants (id),
  location_id              uuid not null references locations (id),
  customer_id              uuid not null references customers (id),
  type                     order_type not null,
  status                   order_status not null default 'pending_payment',
  placed_at                timestamptz,
  scheduled_for            timestamptz, -- null = ASAP
  promised_at              timestamptz, -- set on accept ("ready in 20 min")
  delivery_address         jsonb,       -- required for delivery orders (app-enforced)
  subtotal_cents           integer not null check (subtotal_cents >= 0),
  tax_cents                integer not null check (tax_cents >= 0),
  tip_cents                integer not null default 0 check (tip_cents >= 0),
  delivery_fee_cents       integer not null default 0 check (delivery_fee_cents >= 0),
  platform_fee_cents       integer not null default 0 check (platform_fee_cents >= 0),
  total_cents              integer not null check (total_cents >= 0),
  stripe_payment_intent_id text unique,
  special_instructions     text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index orders_restaurant_status_idx on orders (restaurant_id, status, created_at desc);
create index orders_customer_id_idx on orders (customer_id);
create index orders_scheduled_for_idx on orders (scheduled_for) where scheduled_for is not null;

-- Lines snapshot name + price at purchase time: menus change, history doesn't.
create table order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references orders (id) on delete cascade,
  item_id              uuid references items (id) on delete set null,
  name_snapshot        text not null,
  price_snapshot_cents integer not null check (price_snapshot_cents >= 0),
  qty                  integer not null check (qty > 0),
  notes                text
);

create index order_items_order_id_idx on order_items (order_id);

create table order_item_modifiers (
  id                   uuid primary key default gen_random_uuid(),
  order_item_id        uuid not null references order_items (id) on delete cascade,
  modifier_id          uuid references modifiers (id) on delete set null,
  name_snapshot        text not null,
  price_snapshot_cents integer not null default 0
);

create index order_item_modifiers_order_item_id_idx on order_item_modifiers (order_item_id);

-- Append-only audit trail; the tablet UI and dispute resolution read from it.
create table order_events (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references orders (id) on delete cascade,
  status     order_status not null,
  actor      text not null default 'system', -- 'system' | 'staff:<uid>' | 'stripe' | 'uber'
  note       text,
  created_at timestamptz not null default now()
);

create index order_events_order_id_idx on order_events (order_id, created_at);

create table deliveries (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null unique references orders (id) on delete cascade,
  provider     delivery_provider not null,
  external_id  text,
  quote_cents  integer check (quote_cents >= 0),
  status       text not null default 'pending',
  courier_name text,
  tracking_url text,
  eta          timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table staff_memberships (
  user_id       uuid not null references auth.users (id) on delete cascade,
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  role          staff_role not null default 'staff',
  created_at    timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);

create index staff_memberships_restaurant_id_idx on staff_memberships (restaurant_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger restaurants_updated_at before update on restaurants
  for each row execute function set_updated_at();
create trigger locations_updated_at before update on locations
  for each row execute function set_updated_at();
create trigger menus_updated_at before update on menus
  for each row execute function set_updated_at();
create trigger items_updated_at before update on items
  for each row execute function set_updated_at();
create trigger orders_updated_at before update on orders
  for each row execute function set_updated_at();
create trigger deliveries_updated_at before update on deliveries
  for each row execute function set_updated_at();

-- Order state machine, enforced at the database so no code path can skip it.
-- Mirror of lib/orders/state-machine.ts — keep the two in sync.
create or replace function validate_order_transition()
returns trigger
language plpgsql
as $$
declare
  allowed boolean;
begin
  if old.status = new.status then
    return new;
  end if;

  allowed := case old.status
    when 'pending_payment'  then new.status in ('placed', 'canceled')
    when 'placed'           then new.status in ('accepted', 'rejected', 'canceled')
    when 'accepted'         then new.status in ('preparing', 'ready', 'canceled')
    when 'preparing'        then new.status in ('ready', 'canceled')
    when 'ready'            then new.status in ('completed', 'courier_assigned', 'canceled')
    when 'courier_assigned' then new.status in ('picked_up', 'canceled')
    when 'picked_up'        then new.status = 'delivered'
    when 'delivered'        then new.status = 'completed'
    when 'rejected'         then new.status = 'refunded'
    when 'canceled'         then new.status = 'refunded'
    when 'completed'        then new.status = 'refunded'
    else false
  end;

  if not allowed then
    raise exception 'invalid order status transition: % -> %', old.status, new.status;
  end if;

  if new.status = 'placed' and new.placed_at is null then
    new.placed_at := now();
  end if;

  return new;
end;
$$;

create trigger orders_validate_transition before update of status on orders
  for each row execute function validate_order_transition();

-- Every status change writes the audit trail automatically.
create or replace function log_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into order_events (order_id, status, actor)
    values (
      new.id,
      new.status,
      coalesce(nullif(current_setting('app.actor', true), ''), 'system')
    );
  end if;
  return new;
end;
$$;

create trigger orders_log_event after insert or update of status on orders
  for each row execute function log_order_event();

-- order_events is append-only: block mutation even for table owners' triggers.
create or replace function block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% on % is not allowed (append-only)', tg_op, tg_table_name;
end;
$$;

create trigger order_events_append_only before update or delete on order_events
  for each row execute function block_mutation();
