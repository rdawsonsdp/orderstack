/**
 * Offline smoke test: applies migrations + seed against PGlite (WASM Postgres)
 * and exercises the order state machine triggers. Supabase-managed pieces
 * (auth schema, roles, realtime publication) are shimmed below.
 *
 *   node scripts/verify-db.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const db = new PGlite();
let failures = 0;

async function exec(label, sql) {
  try {
    await db.exec(sql);
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${label}: ${err.message}`);
  }
}

async function expectError(label, sql, pattern) {
  try {
    await db.exec(sql);
    failures++;
    console.error(`  FAIL  ${label}: expected error, none raised`);
  } catch (err) {
    if (pattern.test(err.message)) {
      console.log(`  ok    ${label}`);
    } else {
      failures++;
      console.error(`  FAIL  ${label}: wrong error: ${err.message}`);
    }
  }
}

async function expectRows(label, sql, predicate) {
  const { rows } = await db.query(sql);
  if (predicate(rows)) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}: got ${JSON.stringify(rows)}`);
  }
}

console.log("Shimming Supabase-managed objects…");
await exec(
  "auth schema + roles + publication shim",
  `create schema auth;
   create table auth.users (id uuid primary key default gen_random_uuid(), email text);
   create function auth.uid() returns uuid language sql stable
     as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
   create role anon nologin;
   create role authenticated nologin;
   create role service_role nologin;
   create publication supabase_realtime;`
);

console.log("Applying migrations…");
const dir = path.resolve("supabase/migrations");
for (const file of (await readdir(dir)).sort()) {
  let sql = await readFile(path.join(dir, file), "utf8");
  // pgcrypto isn't bundled in PGlite; gen_random_uuid() is PG core anyway.
  sql = sql.replace(/create extension if not exists pgcrypto;/g, "");
  await exec(file, sql);
}

console.log("Applying seed…");
await exec("seed.sql", await readFile("supabase/seed.sql", "utf8"));

console.log("Sanity checks…");
await expectRows(
  "19 public tables created",
  `select count(*)::int as n from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE'`,
  (r) => r[0].n === 19
);
await expectRows(
  "seed: 19 items, 11 modifiers",
  `select (select count(*)::int from items) as items,
          (select count(*)::int from modifiers) as mods`,
  (r) => r[0].items === 19 && r[0].mods === 11
);
await expectRows(
  "all tables have RLS enabled",
  `select count(*)::int as n from pg_tables
   where schemaname = 'public' and not rowsecurity`,
  (r) => r[0].n === 0
);

console.log("Order state machine…");
await exec(
  "create guest customer + pending order",
  `insert into customers (id, name, email)
     values ('99999999-0000-0000-0000-000000000001', 'Test Guest', 'guest@example.com');
   insert into orders (id, restaurant_id, location_id, customer_id, type,
                       subtotal_cents, tax_cents, platform_fee_cents, total_cents)
     values ('99999999-0000-0000-0000-000000000002',
             '11111111-1111-1111-1111-111111111111',
             '22222222-2222-2222-2222-222222222222',
             '99999999-0000-0000-0000-000000000001',
             'pickup', 2200, 237, 129, 2566);`
);
await expectRows(
  "insert auto-logged to order_events",
  `select count(*)::int as n from order_events
   where order_id = '99999999-0000-0000-0000-000000000002' and status = 'pending_payment'`,
  (r) => r[0].n === 1
);
await expectError(
  "pending_payment -> accepted rejected by trigger",
  `update orders set status = 'accepted'
   where id = '99999999-0000-0000-0000-000000000002'`,
  /invalid order status transition/
);
await exec(
  "pending_payment -> placed allowed",
  `update orders set status = 'placed'
   where id = '99999999-0000-0000-0000-000000000002'`
);
await expectRows(
  "placed_at stamped + event logged",
  `select (select placed_at is not null from orders
            where id = '99999999-0000-0000-0000-000000000002') as stamped,
          (select count(*)::int from order_events
            where order_id = '99999999-0000-0000-0000-000000000002') as events`,
  (r) => r[0].stamped === true && r[0].events === 2
);
await expectError(
  "order_events is append-only",
  `update order_events set actor = 'tampered'`,
  /append-only/
);
await expectError(
  "placed -> preparing (skipping accepted) rejected",
  `update orders set status = 'preparing'
   where id = '99999999-0000-0000-0000-000000000002'`,
  /invalid order status transition/
);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
