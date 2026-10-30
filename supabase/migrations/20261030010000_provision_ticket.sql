-- Fix: provisioning the reserved super-admin email.
--
-- Supabase Auth inserts the auth.users row first and writes app_metadata
-- afterwards, so the insert guard of 20261030000000_accounts.sql never saw
-- the "fq_provisioned" flag and refused the admin-created account too.
-- The provisioning script now opens a one-time ticket (service role only,
-- valid 10 minutes) right before creating the account; the guard accepts the
-- reserved email when a ticket is open and consumes it. A public signup can't
-- open a ticket, so it is still refused.
--
-- Safe to run twice. Run after 20261030000000_accounts.sql.

create table if not exists public.fq_provision_tickets (
  email       text primary key check (email = lower(email)),
  expires_at  timestamptz not null
);

alter table public.fq_provision_tickets enable row level security;

create or replace function public.fq_open_provision_ticket(p_email text)
returns jsonb
language plpgsql
as $$
begin
  if not exists (select 1 from public.fq_reserved_emails r where r.email = lower(p_email)) then
    return jsonb_build_object('ok', false, 'error', 'NOT_RESERVED');
  end if;
  insert into public.fq_provision_tickets (email, expires_at)
  values (lower(p_email), now() + interval '10 minutes')
  on conflict (email) do update set expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fq_auth_user_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null
     or not exists (select 1 from public.fq_reserved_emails r where r.email = lower(new.email))
     or coalesce(new.raw_app_meta_data->>'fq_provisioned', '') = 'true' then
    return new;
  end if;
  -- An open provisioning ticket (scripts/provision-super-admin.mjs): used once.
  delete from public.fq_provision_tickets t
   where t.email = lower(new.email) and t.expires_at > now();
  if found then
    return new;
  end if;
  raise exception 'EMAIL_RESERVED' using errcode = 'check_violation';
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.fq_provision_tickets from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.fq_provision_tickets to service_role;
  end if;
  execute 'revoke all on function public.fq_open_provision_ticket(text) from public';
  execute 'revoke all on function public.fq_auth_user_guard() from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.fq_open_provision_ticket(text) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.fq_open_provision_ticket(text) to service_role';
  end if;
end;
$$;

notify pgrst, 'reload schema';
