-- Staff can read the customer attached to their restaurant's orders (the
-- dashboard shows name/phone/email on order cards and the detail view).
-- Without this, the customers join returns null under staff RLS.

create policy "staff read customers of own orders" on customers
  for select to authenticated
  using (
    exists (
      select 1 from orders o
      where o.customer_id = customers.id
        and o.restaurant_id in (select app_user_restaurant_ids())
    )
  );
