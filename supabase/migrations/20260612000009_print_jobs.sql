-- Receipt printing. Two consumers:
--   1. Browser print (any printer): /dashboard/orders/[id]/print
--   2. Star CloudPRNT (kitchen thermal printer): the printer polls
--      /api/cloudprnt/{print_key} and drains this queue.

create table print_jobs (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  order_id      uuid not null references orders (id) on delete cascade,
  status        text not null default 'queued'
                check (status in ('queued', 'printing', 'done', 'failed')),
  created_at    timestamptz not null default now(),
  printed_at    timestamptz
);

create index print_jobs_queue_idx on print_jobs (restaurant_id, status, created_at);

alter table print_jobs enable row level security;

-- Staff can see their queue (dashboard status); writes are server-side only
-- (enqueued at payment landing, drained by the CloudPRNT endpoint).
create policy "staff read own print jobs" on print_jobs
  for select to authenticated
  using (restaurant_id in (select app_user_restaurant_ids()));

-- The printer authenticates by an unguessable key in its configured URL.
alter table locations add column print_key uuid not null default gen_random_uuid();
create unique index locations_print_key_idx on locations (print_key);
