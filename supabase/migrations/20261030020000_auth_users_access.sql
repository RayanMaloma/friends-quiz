-- Fix: the server RPCs that read auth.users.
--
-- On Supabase the service role has no SELECT on auth.users (it belongs to
-- supabase_auth_admin), so these functions failed with "permission denied for
-- table users" when PostgREST ran them as the service role. They now run as
-- their owner (security definer) with a fixed search_path. Execute stays
-- granted to the service role only (20261030000000_accounts.sql).
--
-- Safe to run twice. Run after 20261030000000_accounts.sql.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'fq_auth_profile(uuid)',
    'fq_set_super_admin(text)',
    'fq_admin_activity_overview()',
    'fq_admin_list_accounts(integer)',
    'fq_admin_list_activity_sessions(jsonb, integer)',
    'fq_admin_session_detail(uuid)'
  ] loop
    execute format('alter function public.%s security definer set search_path = public, pg_temp', fn);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
