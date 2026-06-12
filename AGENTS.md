<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# OrderStack

Multi-tenant restaurant online ordering platform (Menufy replacement).
Stack: Next.js 16 (App Router) on Vercel · Supabase (DB/Auth/Realtime/Storage) ·
Stripe Connect Express · Uber Direct (Phase 3) · Resend · Twilio.

## Non-negotiable conventions

- **All money is integer cents.** No floats, ever. Column names end in `_cents`.
- **Totals are computed server-side** by `lib/pricing.ts` from DB prices. The
  client cart is never trusted.
- **Order lines snapshot** name and price at purchase (`name_snapshot`,
  `price_snapshot_cents`) — menus change, history doesn't.
- **`order_events` is append-only** (DB trigger blocks update/delete). Status
  changes are auto-logged by trigger; set `app.actor` session var to attribute.
- **Order status transitions** are enforced by the `validate_order_transition`
  DB trigger AND mirrored in `lib/orders/state-machine.ts`. Change both together.
- **Stripe webhooks are the only thing that moves an order to `placed`** —
  never the client redirect.
- **Tenant isolation is RLS, not app code.** Every tenant-owned table has
  policies in `supabase/migrations/20260612000002_rls_policies.sql`. The
  service-role client (`lib/supabase/admin.ts`) is server-only.

## Decisions locked (June 2026)

- Fee model: **diner-paid platform fee**, default 129¢ (`restaurants.platform_fee_cents`).
- Tax: per-location `tax_rate` column (Chicago pilot 10.75%); Stripe Tax later.
- Guest checkout only at launch (`customers.auth_user_id` nullable).
- Seed/pilot restaurant: Dat Donut placeholder (`supabase/seed.sql`).

## Layout

- `app/(storefront)/[tenant]/` — diner-facing menu/cart/checkout/tracking
- `app/dashboard/` — restaurant staff (Realtime order tablet, menu manager)
- `app/admin/` — platform operator
- `app/api/webhooks/{stripe,uber}/` — webhook handlers (service role)
- `lib/` — tenant resolution, pricing engine, state machine, supabase clients
- `proxy.ts` — subdomain → /{slug} rewrite (Next 16 proxy, ex-middleware)
- `supabase/migrations/` — schema source of truth; `supabase/seed.sql` — dev data

## Tenant routing

`{slug}.orderstack.app` → rewritten to `/{slug}/...` by `proxy.ts`.
Dev/preview uses path routing directly: `localhost:3000/dat-donut`.
Custom domains are Phase 2 (Vercel domain API + `custom_domain` column).

## Local development

```sh
pnpm supabase start        # local stack (needs Docker)
pnpm supabase db reset     # apply migrations + seed.sql
cp .env.example .env.local # fill from `supabase status`
pnpm dev                   # localhost:3000/dat-donut
```

Migrations: `pnpm supabase migration new <name>` — never edit applied migrations.

## Order state machine

```
pending_payment → placed → accepted → preparing → ready →
   pickup:   completed
   delivery: courier_assigned → picked_up → delivered → completed
exits: rejected / canceled → refunded
```

## Money flow (Phase 2+)

PaymentIntent with `transfer_data.destination` = restaurant's Express account,
`application_fee_amount` = platform fee. Refunds use `reverse_transfer: true`.
Phase 1 Session 3 ships direct charges (no Connect) for the single pilot.
