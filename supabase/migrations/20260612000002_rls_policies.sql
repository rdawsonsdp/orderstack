-- Row Level Security: tenant isolation enforced in the database, not just app code.
--
-- Roles in practice:
--   anon           — diners browsing live restaurants' published menus. Orders are
--                    created server-side (service role) after price validation;
--                    anon never writes directly.
--   authenticated  — restaurant staff; access scoped via staff_memberships.
--   service_role   — server-only (webhooks, dispatch, checkout); bypasses RLS.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- security definer so policies on staff_memberships itself don't recurse.
create or replace function app_user_restaurant_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select restaurant_id from staff_memberships where user_id = auth.uid();
$$;

create or replace function app_user_is_owner(rid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from staff_memberships
    where user_id = auth.uid() and restaurant_id = rid and role = 'owner'
  );
$$;

revoke execute on function app_user_restaurant_ids() from anon;
revoke execute on function app_user_is_owner(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table restaurants          enable row level security;
alter table locations            enable row level security;
alter table business_hours       enable row level security;
alter table hour_overrides       enable row level security;
alter table menus                enable row level security;
alter table categories           enable row level security;
alter table items                enable row level security;
alter table modifier_groups      enable row level security;
alter table item_modifier_groups enable row level security;
alter table modifiers            enable row level security;
alter table customers            enable row level security;
alter table orders               enable row level security;
alter table order_items          enable row level security;
alter table order_item_modifiers enable row level security;
alter table order_events         enable row level security;
alter table deliveries           enable row level security;
alter table staff_memberships    enable row level security;

-- ---------------------------------------------------------------------------
-- restaurants
-- ---------------------------------------------------------------------------

create policy "public read live restaurants" on restaurants
  for select using (status = 'live');

create policy "staff read own restaurant" on restaurants
  for select to authenticated
  using (id in (select app_user_restaurant_ids()));

create policy "owners update own restaurant" on restaurants
  for update to authenticated
  using (app_user_is_owner(id))
  with check (app_user_is_owner(id));

-- ---------------------------------------------------------------------------
-- locations + hours
-- ---------------------------------------------------------------------------

create policy "public read live locations" on locations
  for select using (
    exists (select 1 from restaurants r where r.id = restaurant_id and r.status = 'live')
  );

create policy "staff manage own locations" on locations
  for all to authenticated
  using (restaurant_id in (select app_user_restaurant_ids()))
  with check (restaurant_id in (select app_user_restaurant_ids()));

create policy "public read live hours" on business_hours
  for select using (
    exists (
      select 1 from locations l
      join restaurants r on r.id = l.restaurant_id
      where l.id = location_id and r.status = 'live'
    )
  );

create policy "staff manage own hours" on business_hours
  for all to authenticated
  using (
    exists (
      select 1 from locations l
      where l.id = location_id
        and l.restaurant_id in (select app_user_restaurant_ids())
    )
  )
  with check (
    exists (
      select 1 from locations l
      where l.id = location_id
        and l.restaurant_id in (select app_user_restaurant_ids())
    )
  );

create policy "public read live hour overrides" on hour_overrides
  for select using (
    exists (
      select 1 from locations l
      join restaurants r on r.id = l.restaurant_id
      where l.id = location_id and r.status = 'live'
    )
  );

create policy "staff manage own hour overrides" on hour_overrides
  for all to authenticated
  using (
    exists (
      select 1 from locations l
      where l.id = location_id
        and l.restaurant_id in (select app_user_restaurant_ids())
    )
  )
  with check (
    exists (
      select 1 from locations l
      where l.id = location_id
        and l.restaurant_id in (select app_user_restaurant_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- menu tree (public reads only through a live restaurant + active menu)
-- ---------------------------------------------------------------------------

create policy "public read active menus" on menus
  for select using (
    active and exists (
      select 1 from restaurants r where r.id = restaurant_id and r.status = 'live'
    )
  );

create policy "staff manage own menus" on menus
  for all to authenticated
  using (restaurant_id in (select app_user_restaurant_ids()))
  with check (restaurant_id in (select app_user_restaurant_ids()));

create policy "public read categories" on categories
  for select using (
    exists (
      select 1 from menus m
      join restaurants r on r.id = m.restaurant_id
      where m.id = menu_id and m.active and r.status = 'live'
    )
  );

create policy "staff manage own categories" on categories
  for all to authenticated
  using (
    exists (
      select 1 from menus m
      where m.id = menu_id
        and m.restaurant_id in (select app_user_restaurant_ids())
    )
  )
  with check (
    exists (
      select 1 from menus m
      where m.id = menu_id
        and m.restaurant_id in (select app_user_restaurant_ids())
    )
  );

create policy "public read items" on items
  for select using (
    exists (
      select 1 from categories c
      join menus m on m.id = c.menu_id
      join restaurants r on r.id = m.restaurant_id
      where c.id = category_id and m.active and r.status = 'live'
    )
  );

create policy "staff manage own items" on items
  for all to authenticated
  using (
    exists (
      select 1 from categories c
      join menus m on m.id = c.menu_id
      where c.id = category_id
        and m.restaurant_id in (select app_user_restaurant_ids())
    )
  )
  with check (
    exists (
      select 1 from categories c
      join menus m on m.id = c.menu_id
      where c.id = category_id
        and m.restaurant_id in (select app_user_restaurant_ids())
    )
  );

create policy "public read modifier groups" on modifier_groups
  for select using (
    exists (select 1 from restaurants r where r.id = restaurant_id and r.status = 'live')
  );

create policy "staff manage own modifier groups" on modifier_groups
  for all to authenticated
  using (restaurant_id in (select app_user_restaurant_ids()))
  with check (restaurant_id in (select app_user_restaurant_ids()));

create policy "public read item modifier groups" on item_modifier_groups
  for select using (
    exists (
      select 1 from modifier_groups g
      join restaurants r on r.id = g.restaurant_id
      where g.id = modifier_group_id and r.status = 'live'
    )
  );

create policy "staff manage own item modifier groups" on item_modifier_groups
  for all to authenticated
  using (
    exists (
      select 1 from modifier_groups g
      where g.id = modifier_group_id
        and g.restaurant_id in (select app_user_restaurant_ids())
    )
  )
  with check (
    exists (
      select 1 from modifier_groups g
      where g.id = modifier_group_id
        and g.restaurant_id in (select app_user_restaurant_ids())
    )
  );

create policy "public read modifiers" on modifiers
  for select using (
    exists (
      select 1 from modifier_groups g
      join restaurants r on r.id = g.restaurant_id
      where g.id = modifier_group_id and r.status = 'live'
    )
  );

create policy "staff manage own modifiers" on modifiers
  for all to authenticated
  using (
    exists (
      select 1 from modifier_groups g
      where g.id = modifier_group_id
        and g.restaurant_id in (select app_user_restaurant_ids())
    )
  )
  with check (
    exists (
      select 1 from modifier_groups g
      where g.id = modifier_group_id
        and g.restaurant_id in (select app_user_restaurant_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- customers (no anon access; guests are created server-side)
-- ---------------------------------------------------------------------------

create policy "users read own customer record" on customers
  for select to authenticated
  using (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- orders & children
-- (diner-facing reads go through server routes using public_token; no anon RLS)
-- ---------------------------------------------------------------------------

create policy "staff read own orders" on orders
  for select to authenticated
  using (restaurant_id in (select app_user_restaurant_ids()));

create policy "staff update own orders" on orders
  for update to authenticated
  using (restaurant_id in (select app_user_restaurant_ids()))
  with check (restaurant_id in (select app_user_restaurant_ids()));

create policy "customers read own orders" on orders
  for select to authenticated
  using (
    customer_id in (select id from customers where auth_user_id = auth.uid())
  );

create policy "staff read own order items" on order_items
  for select to authenticated
  using (
    exists (
      select 1 from orders o
      where o.id = order_id
        and (
          o.restaurant_id in (select app_user_restaurant_ids())
          or o.customer_id in (select id from customers where auth_user_id = auth.uid())
        )
    )
  );

create policy "staff read own order item modifiers" on order_item_modifiers
  for select to authenticated
  using (
    exists (
      select 1 from order_items oi
      join orders o on o.id = oi.order_id
      where oi.id = order_item_id
        and (
          o.restaurant_id in (select app_user_restaurant_ids())
          or o.customer_id in (select id from customers where auth_user_id = auth.uid())
        )
    )
  );

create policy "staff read own order events" on order_events
  for select to authenticated
  using (
    exists (
      select 1 from orders o
      where o.id = order_id
        and o.restaurant_id in (select app_user_restaurant_ids())
    )
  );

create policy "staff read own deliveries" on deliveries
  for select to authenticated
  using (
    exists (
      select 1 from orders o
      where o.id = order_id
        and o.restaurant_id in (select app_user_restaurant_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- staff_memberships
-- ---------------------------------------------------------------------------

create policy "users read own memberships" on staff_memberships
  for select to authenticated
  using (user_id = auth.uid());

create policy "owners manage memberships" on staff_memberships
  for all to authenticated
  using (app_user_is_owner(restaurant_id))
  with check (app_user_is_owner(restaurant_id));

-- ---------------------------------------------------------------------------
-- Realtime: the order tablet subscribes to its restaurant's orders
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_events;
