-- The staff-read-customers policy (migration 4) referenced orders directly,
-- but orders' "customers read own orders" policy references customers back —
-- infinite recursion (42P17) at query time. Route the check through a
-- security definer helper so orders is read without re-entering RLS.

drop policy "staff read customers of own orders" on customers;

create or replace function app_user_can_view_customer(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from orders o
    join staff_memberships sm on sm.restaurant_id = o.restaurant_id
    where o.customer_id = cid and sm.user_id = auth.uid()
  );
$$;

revoke execute on function app_user_can_view_customer(uuid) from public;
grant execute on function app_user_can_view_customer(uuid) to authenticated;

create policy "staff read customers of own orders" on customers
  for select to authenticated
  using (app_user_can_view_customer(id));
