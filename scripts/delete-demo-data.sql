-- Removes the demo/test data before the A&C pilot goes live.
-- Run against the OrderStack project when Rob says go — NOT before
-- (the demo orders are intentionally on the board for walkthroughs).
--
--   Demo orders #7-11 + their customers, and the e2e test orders/customers.

begin;

delete from orders where id::text like '88888888%';
delete from customers where id::text like '77777777%';

-- E2E/test orders created during development (guest customers by email)
delete from orders where customer_id in (
  select id from customers
  where email in (
    'diner-e2e@example.com', 'rls-test@example.com',
    'sched@example.com', 'refund@example.com', 'x@example.com'
  )
);
delete from customers
where email in (
  'diner-e2e@example.com', 'rls-test@example.com',
  'sched@example.com', 'refund@example.com', 'x@example.com'
);

-- Reset coupon counters bumped by testing
update coupons set redemption_count = 0;

commit;
