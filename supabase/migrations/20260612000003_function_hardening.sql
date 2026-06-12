-- Function hardening, per Supabase security advisors:
-- 1. Pin search_path on trigger functions (mutable search_path lint).
-- 2. Strip the default PUBLIC execute grant so internal functions aren't
--    callable through PostgREST /rpc. RLS policies still work: authenticated
--    keeps execute on the two helpers its policies evaluate.

alter function set_updated_at() set search_path = public;
alter function validate_order_transition() set search_path = public;
alter function block_mutation() set search_path = public;

-- Trigger functions are invoked by the system, never via RPC.
revoke execute on function set_updated_at() from public, anon, authenticated;
revoke execute on function validate_order_transition() from public, anon, authenticated;
revoke execute on function block_mutation() from public, anon, authenticated;
revoke execute on function log_order_event() from public, anon, authenticated;

-- RLS helpers: only authenticated policies reference them.
revoke execute on function app_user_restaurant_ids() from public;
revoke execute on function app_user_is_owner(uuid) from public;
grant execute on function app_user_restaurant_ids() to authenticated;
grant execute on function app_user_is_owner(uuid) to authenticated;
