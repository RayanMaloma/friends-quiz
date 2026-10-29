-- Accounts, roles, the public game catalog, session ownership and activity.
--
-- * Identity = Supabase Auth (auth.users). Passwords live only there (hashed by
--   Supabase); no application table stores a password or a token.
-- * Every account gets a profile with the role 'user'. The only other role,
--   'super_admin', can't be chosen at signup or self-assigned: it is granted by
--   fq_set_super_admin(), callable by the service role only (the provisioning
--   script, scripts/provision-super-admin.mjs). At most one super admin exists.
-- * The designated super-admin email is reserved: a public signup with it is
--   refused by the database, so nobody can register it before the owner
--   provisions it (only an admin-created user, flagged in app_metadata — which
--   users can't set themselves — may use it).
-- * Catalog: built-in games (fq_catalog) and authored games (games.visibility)
--   are 'public' (any signed-in user may open a room) or 'private' (super
--   admin / dashboard only). Defaults: Mafia + «اخترع إجابتك» public, the
--   Ahaji question set private, every authored game private.
-- * Sessions remember who created them (owner_id) and which catalog entry
--   (game_key). Start / completion / cancellation are recorded by triggers on
--   game_sessions, so the activity log can't miss a transition whatever code
--   path caused it, and each one is written once (dedupe_key).
-- * The Next.js server still does everything with the service role. RLS
--   policies below are defense in depth for a client holding a user JWT
--   (the anon key is public): users read only their own profile and the
--   non-secret columns of their own sessions; private games and every
--   live match state stay unreadable.
--
-- Safe to run twice. Run after 20261029000000_invent.sql.

-- ---------------------------------------------------------------------------
-- Version
-- ---------------------------------------------------------------------------

create or replace function public.fq_schema_version()
returns integer
language sql
immutable
as $$ select 7 $$;

-- ---------------------------------------------------------------------------
-- Profiles and roles
-- ---------------------------------------------------------------------------

create table if not exists public.fq_profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'user' check (role in ('user', 'super_admin')),
  created_at  timestamptz not null default now()
);

-- A single super admin.
create unique index if not exists fq_profiles_one_super_admin
  on public.fq_profiles (role) where role = 'super_admin';

create table if not exists public.fq_reserved_emails (
  email text primary key check (email = lower(email))
);

insert into public.fq_reserved_emails (email)
values ('rayanomaireeni@gmail.com')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Catalog visibility
-- ---------------------------------------------------------------------------

create table if not exists public.fq_catalog (
  key         text primary key check (key in ('mafia', 'invent', 'invent_ahaji')),
  visibility  text not null check (visibility in ('public', 'private')),
  updated_at  timestamptz not null default now()
);

insert into public.fq_catalog (key, visibility)
values ('mafia', 'public'), ('invent', 'public'), ('invent_ahaji', 'private')
on conflict do nothing;

alter table public.games
  add column if not exists visibility text not null default 'private';
alter table public.games drop constraint if exists games_visibility_check;
alter table public.games add constraint games_visibility_check check (visibility in ('public', 'private'));

-- ---------------------------------------------------------------------------
-- Sessions: owner, catalog key, lifecycle timestamps
-- ---------------------------------------------------------------------------

alter table public.game_sessions add column if not exists owner_id uuid references auth.users (id) on delete set null;
alter table public.game_sessions add column if not exists game_key text;
alter table public.game_sessions add column if not exists started_at timestamptz;
alter table public.game_sessions add column if not exists completed_at timestamptz;
alter table public.game_sessions add column if not exists end_reason text;
alter table public.game_sessions drop constraint if exists game_sessions_end_reason_check;
alter table public.game_sessions add constraint game_sessions_end_reason_check
  check (end_reason is null or end_reason in ('completed', 'cancelled', 'expired'));

create index if not exists game_sessions_owner_idx on public.game_sessions (owner_id, created_at desc);
create index if not exists game_sessions_created_idx on public.game_sessions (created_at desc);

-- Which catalog entry a session belongs to. Invent rooms created before this
-- migration all played the Ahaji questions; new public rooms say 'custom'.
create or replace function public.fq_session_game_key(p_config jsonb, p_game_id uuid)
returns text
language sql
immutable
as $$
  select case coalesce(p_config->>'kind', 'quiz')
           when 'mafia' then 'mafia'
           when 'invent' then case when p_config->>'questionSet' = 'custom' then 'invent' else 'invent_ahaji' end
           else p_game_id::text
         end
$$;

update public.game_sessions
   set game_key = public.fq_session_game_key(config, game_id)
 where game_key is null;

-- Best effort for rooms that already ended (no history before this migration).
update public.game_sessions
   set end_reason = 'cancelled'
 where status = 'FINISHED' and end_reason is null and completed_at is null;

-- ---------------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------------

create table if not exists public.fq_activity (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in (
                'user_registered', 'user_login',
                'session_created', 'session_started', 'session_completed', 'session_cancelled'
              )),
  user_id     uuid references auth.users (id) on delete set null,
  session_id  uuid references public.game_sessions (id) on delete set null,
  game_key    text,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  -- One row per (session, transition) / registration, whatever retries happen.
  dedupe_key  text unique
);

create index if not exists fq_activity_created_idx on public.fq_activity (created_at desc);
create index if not exists fq_activity_session_idx on public.fq_activity (session_id);
create index if not exists fq_activity_user_idx on public.fq_activity (user_id);

create or replace function public.fq_log_activity(
  p_kind text, p_user_id uuid, p_session_id uuid, p_game_key text, p_data jsonb, p_dedupe text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fq_activity (kind, user_id, session_id, game_key, data, dedupe_key)
  values (p_kind, p_user_id, p_session_id, p_game_key, coalesce(p_data, '{}'::jsonb), p_dedupe)
  on conflict (dedupe_key) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- auth.users triggers: profile on signup, reserved email guard
-- ---------------------------------------------------------------------------

create or replace function public.fq_auth_user_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null
     and exists (select 1 from public.fq_reserved_emails r where r.email = lower(new.email))
     and coalesce(new.raw_app_meta_data->>'fq_provisioned', '') <> 'true' then
    raise exception 'EMAIL_RESERVED' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.fq_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Always 'user': nothing a client sends can change that.
  insert into public.fq_profiles (id, role) values (new.id, 'user') on conflict (id) do nothing;
  perform public.fq_log_activity('user_registered', new.id, null, null, '{}'::jsonb, 'user_registered:' || new.id);
  return new;
end;
$$;

drop trigger if exists fq_auth_user_guard_trg on auth.users;
create trigger fq_auth_user_guard_trg
  before insert or update of email on auth.users
  for each row execute function public.fq_auth_user_guard();

drop trigger if exists fq_auth_user_created_trg on auth.users;
create trigger fq_auth_user_created_trg
  after insert on auth.users
  for each row execute function public.fq_auth_user_created();

-- Accounts that existed before this migration.
insert into public.fq_profiles (id, role)
select u.id, 'user' from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- game_sessions triggers: catalog key + lifecycle activity
-- ---------------------------------------------------------------------------

-- True once a match of this session has reached its natural end.
create or replace function public.fq_session_is_complete(p_kind text, p_status text, p_match jsonb, p_index integer, p_total integer)
returns boolean
language sql
immutable
as $$
  select case p_kind
           when 'quiz' then p_status = 'FINISHED' and p_total > 0 and p_index >= p_total - 1
           when 'invent' then p_match #>> '{game,phase}' = 'final'
                              and coalesce((p_match #>> '{game,endedEarly}')::boolean, false) = false
           else jsonb_typeof(p_match->'winner') = 'object'
         end
$$;

create or replace function public.fq_sessions_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.game_key := coalesce(new.game_key, public.fq_session_game_key(new.config, new.game_id));
  return new;
end;
$$;

create or replace function public.fq_sessions_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fq_log_activity(
    'session_created', new.owner_id, new.id, new.game_key,
    jsonb_build_object('code', new.code, 'kind', coalesce(new.config->>'kind', 'quiz')),
    'session_created:' || new.id
  );
  return new;
end;
$$;

create or replace function public.fq_sessions_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind    text := coalesce(new.config->>'kind', 'quiz');
  v_players integer;
begin
  if new.status = old.status and new.match is not distinct from old.match
     and new.current_index = old.current_index then
    return new;
  end if;
  select count(*) into v_players from public.game_players p where p.session_id = new.id;

  if new.started_at is null and old.status = 'LOBBY' and new.status not in ('LOBBY', 'FINISHED') then
    new.started_at := now();
    perform public.fq_log_activity('session_started', new.owner_id, new.id, new.game_key,
      jsonb_build_object('players', v_players), 'session_started:' || new.id);
  end if;

  if new.completed_at is null
     and public.fq_session_is_complete(v_kind, new.status, new.match, new.current_index, new.total_questions) then
    new.completed_at := now();
    new.started_at := coalesce(new.started_at, now());
    perform public.fq_log_activity('session_completed', new.owner_id, new.id, new.game_key,
      jsonb_build_object('players', v_players), 'session_completed:' || new.id);
  end if;

  if new.status = 'FINISHED' and old.status <> 'FINISHED' then
    if new.completed_at is not null then
      new.end_reason := 'completed';
    else
      -- Rooms closed because their code was reused after 12h idle are 'expired'.
      new.end_reason := coalesce(new.end_reason,
        case when old.updated_at < now() - interval '12 hours' then 'expired' else 'cancelled' end);
      perform public.fq_log_activity('session_cancelled', new.owner_id, new.id, new.game_key,
        jsonb_build_object('players', v_players, 'reason', new.end_reason), 'session_cancelled:' || new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists fq_sessions_before_insert_trg on public.game_sessions;
create trigger fq_sessions_before_insert_trg
  before insert on public.game_sessions
  for each row execute function public.fq_sessions_before_insert();

drop trigger if exists fq_sessions_after_insert_trg on public.game_sessions;
create trigger fq_sessions_after_insert_trg
  after insert on public.game_sessions
  for each row execute function public.fq_sessions_after_insert();

drop trigger if exists fq_sessions_before_update_trg on public.game_sessions;
create trigger fq_sessions_before_update_trg
  before update on public.game_sessions
  for each row execute function public.fq_sessions_before_update();

-- An admin ending a room from the dashboard is a cancellation.
create or replace function public.fq_admin_end_session(p_id uuid)
returns jsonb
language plpgsql
as $$
begin
  update public.game_sessions
     set status = 'FINISHED', updated_at = now(), finished_at = coalesce(finished_at, now()),
         end_reason = coalesce(end_reason, 'cancelled')
   where id = p_id and status <> 'FINISHED';
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Server RPCs: accounts
-- ---------------------------------------------------------------------------

-- The role of a signed-in account (creates the profile if it is missing).
create or replace function public.fq_auth_profile(p_user_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_role text;
begin
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  insert into public.fq_profiles (id, role) values (p_user_id, 'user') on conflict (id) do nothing;
  select role into v_role from public.fq_profiles where id = p_user_id;
  return jsonb_build_object('ok', true, 'role', v_role);
end;
$$;

create or replace function public.fq_log_login(p_user_id uuid)
returns jsonb
language plpgsql
as $$
begin
  perform public.fq_log_activity('user_login', p_user_id, null, null, '{}'::jsonb, null);
  return jsonb_build_object('ok', true);
end;
$$;

-- Provisioning only (service role): makes this account the one super admin.
create or replace function public.fq_set_super_admin(p_email text)
returns jsonb
language plpgsql
as $$
declare
  v_id uuid;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(p_email);
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  insert into public.fq_profiles (id, role) values (v_id, 'user') on conflict (id) do nothing;
  update public.fq_profiles set role = 'user' where role = 'super_admin' and id <> v_id;
  update public.fq_profiles set role = 'super_admin' where id = v_id;
  return jsonb_build_object('ok', true, 'user_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Server RPCs: catalog
-- ---------------------------------------------------------------------------

create or replace function public.fq_catalog_list()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ok', true,
    'builtin', coalesce((select jsonb_object_agg(c.key, c.visibility) from public.fq_catalog c), '{}'::jsonb),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ga.id,
               'kind', ga.kind,
               'status', ga.status,
               'visibility', ga.visibility,
               'title', ga.doc->>'title',
               'emoji', ga.doc->>'emoji',
               'accent', ga.doc->>'accent',
               'cover', ga.doc->'cover',
               'question_count', (
                 select count(*) from jsonb_array_elements(coalesce(ga.doc->'questions', '[]'::jsonb)) q
                  where coalesce((q->>'enabled')::boolean, true)
               ),
               'people_count', jsonb_array_length(coalesce(ga.doc->'people', '[]'::jsonb)),
               'min_players', ga.doc #> '{config,mechanics,minPlayers}',
               'max_players', ga.doc #> '{config,mechanics,maxPlayers}',
               'updated_at', ga.updated_at
             ) order by ga.updated_at desc)
        from public.games ga
       where ga.status <> 'archived'
    ), '[]'::jsonb)
  )
$$;

-- p_key: a built-in key ('mafia', 'invent', 'invent_ahaji') or a game id.
create or replace function public.fq_admin_set_visibility(p_key text, p_visibility text)
returns jsonb
language plpgsql
as $$
begin
  if p_visibility not in ('public', 'private') then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  if p_key in ('mafia', 'invent', 'invent_ahaji') then
    update public.fq_catalog set visibility = p_visibility, updated_at = now() where key = p_key;
    return jsonb_build_object('ok', true);
  end if;
  if p_key !~ '^[0-9a-f-]{36}$' then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  update public.games set visibility = p_visibility where id = p_key::uuid;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Server RPCs: session ownership
-- ---------------------------------------------------------------------------

-- Right after a room is created: records who created it (once).
create or replace function public.fq_claim_session(p_session_id uuid, p_owner_id uuid)
returns jsonb
language plpgsql
as $$
begin
  update public.game_sessions set owner_id = p_owner_id where id = p_session_id and owner_id is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  update public.fq_activity set user_id = p_owner_id
   where session_id = p_session_id and kind = 'session_created' and user_id is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- An account's own rooms that are still open (most recent first).
create or replace function public.fq_my_sessions(p_owner_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('ok', true, 'sessions', coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb))
    from (
      select jsonb_build_object(
               'id', s.id, 'code', s.code, 'kind', s.kind, 'game_key', s.game_key,
               'title', s.config->>'title', 'emoji', s.config->>'emoji', 'status', s.status,
               'player_count', (select count(*) from public.game_players p where p.session_id = s.id),
               'created_at', s.created_at
             ) as x
        from public.game_sessions s
       where s.owner_id = p_owner_id and s.status <> 'FINISHED'
         and s.updated_at > now() - interval '12 hours'
       order by s.created_at desc
       limit 10
    ) t
$$;

-- The owner takes the host role back on this device: a new host token
-- replaces the old one (the previous screen loses control).
create or replace function public.fq_owner_resume(p_session_id uuid, p_owner_id uuid, p_host_token_hash text)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found or v_session.owner_id is distinct from p_owner_id then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;
  if v_session.status = 'FINISHED' then
    return jsonb_build_object('ok', false, 'error', 'GAME_OVER');
  end if;
  update public.game_sessions set host_token_hash = p_host_token_hash where id = p_session_id;
  return jsonb_build_object('ok', true, 'kind', v_session.kind, 'code', v_session.code);
end;
$$;

-- ---------------------------------------------------------------------------
-- Server RPCs: activity dashboard (super admin)
-- ---------------------------------------------------------------------------

create or replace function public.fq_session_state(p_status text, p_completed timestamptz, p_updated timestamptz)
returns text
language sql
stable
as $$
  select case
           when p_completed is not null then 'completed'
           when p_status = 'FINISHED' then 'cancelled'
           when p_updated < now() - interval '12 hours' then 'expired'
           when p_status = 'LOBBY' then 'lobby'
           else 'playing'
         end
$$;

create or replace function public.fq_admin_activity_overview()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ok', true,
    'users', (select count(*) from auth.users),
    'sessions', (select count(*) from public.game_sessions),
    'active', (select count(*) from public.game_sessions s
                where public.fq_session_state(s.status, s.completed_at, s.updated_at) in ('lobby', 'playing')),
    'completed', (select count(*) from public.game_sessions s where s.completed_at is not null)
  )
$$;

create or replace function public.fq_admin_list_accounts(p_limit integer)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('ok', true, 'accounts', coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb))
    from (
      select jsonb_build_object(
               'id', u.id,
               'email', u.email,
               'role', coalesce(pr.role, 'user'),
               'created_at', u.created_at,
               'last_sign_in_at', u.last_sign_in_at,
               'session_count', (select count(*) from public.game_sessions s where s.owner_id = u.id)
             ) as x
        from auth.users u
        left join public.fq_profiles pr on pr.id = u.id
       order by u.created_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 1000))
    ) t
$$;

-- p_filters: { game_key?, state?, from?, to?, owner? (account id, or 'none') }
create or replace function public.fq_admin_list_activity_sessions(p_filters jsonb, p_limit integer)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('ok', true, 'sessions', coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb))
    from (
      select jsonb_build_object(
               'id', s.id,
               'code', s.code,
               'kind', s.kind,
               'game_key', s.game_key,
               'title', s.config->>'title',
               'emoji', s.config->>'emoji',
               'state', public.fq_session_state(s.status, s.completed_at, s.updated_at),
               'owner_id', s.owner_id,
               'owner_email', u.email,
               'player_count', (select count(*) from public.game_players p where p.session_id = s.id),
               'created_at', s.created_at,
               'started_at', s.started_at,
               'ended_at', coalesce(s.finished_at, s.completed_at)
             ) as x
        from public.game_sessions s
        left join auth.users u on u.id = s.owner_id
       where (coalesce(p_filters->>'game_key', '') = '' or s.game_key = p_filters->>'game_key')
         and (coalesce(p_filters->>'state', '') = ''
              or public.fq_session_state(s.status, s.completed_at, s.updated_at) = p_filters->>'state')
         and (coalesce(p_filters->>'from', '') = '' or s.created_at >= (p_filters->>'from')::timestamptz)
         and (coalesce(p_filters->>'to', '') = '' or s.created_at < (p_filters->>'to')::timestamptz)
         and (coalesce(p_filters->>'owner', '') = ''
              or (p_filters->>'owner' = 'none' and s.owner_id is null)
              or s.owner_id::text = p_filters->>'owner')
       order by s.created_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 1000))
    ) t
$$;

create or replace function public.fq_admin_session_detail(p_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  return jsonb_build_object(
    'ok', true,
    'session', jsonb_build_object(
      'id', v_session.id,
      'code', v_session.code,
      'kind', v_session.kind,
      'game_key', v_session.game_key,
      'game_id', v_session.game_id,
      'config', v_session.config,
      'match', v_session.match,
      'status', v_session.status,
      'state', public.fq_session_state(v_session.status, v_session.completed_at, v_session.updated_at),
      'end_reason', v_session.end_reason,
      'current_index', v_session.current_index,
      'total_questions', v_session.total_questions,
      'owner_email', (select u.email from auth.users u where u.id = v_session.owner_id),
      'created_at', v_session.created_at,
      'started_at', v_session.started_at,
      'completed_at', v_session.completed_at,
      'finished_at', v_session.finished_at
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.display_name, 'active', p.token_hash is not null, 'joined_at', p.joined_at)
                       order by p.joined_at)
        from public.game_players p where p.session_id = p_id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('kind', a.kind, 'at', a.created_at, 'data', a.data) order by a.created_at)
        from public.fq_activity a where a.session_id = p_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Retention: drops activity rows older than p_days (default 365). Sessions
-- themselves are removed from the dashboard (fq_admin_delete_session).
create or replace function public.fq_purge_activity(p_days integer)
returns jsonb
language plpgsql
as $$
declare
  v_count integer;
begin
  delete from public.fq_activity where created_at < now() - make_interval(days => greatest(30, coalesce(p_days, 365)));
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security (defense in depth for clients holding a user JWT)
-- ---------------------------------------------------------------------------

alter table public.fq_profiles        enable row level security;
alter table public.fq_reserved_emails enable row level security;
alter table public.fq_catalog         enable row level security;
alter table public.fq_activity        enable row level security;

create or replace function public.fq_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.fq_profiles p where p.id = auth.uid() and p.role = 'super_admin')
$$;

drop policy if exists fq_profiles_read on public.fq_profiles;
drop policy if exists fq_catalog_read on public.fq_catalog;
drop policy if exists fq_activity_read on public.fq_activity;
drop policy if exists fq_games_read on public.games;
drop policy if exists fq_sessions_read on public.game_sessions;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    -- Own profile (role included, so the app can't be fooled about it); the super admin sees all.
    execute 'create policy fq_profiles_read on public.fq_profiles for select to authenticated
             using (id = auth.uid() or public.fq_is_super_admin())';
    execute 'create policy fq_catalog_read on public.fq_catalog for select to authenticated
             using (visibility = ''public'' or public.fq_is_super_admin())';
    execute 'create policy fq_activity_read on public.fq_activity for select to authenticated
             using (public.fq_is_super_admin())';
    execute 'create policy fq_games_read on public.games for select to authenticated
             using ((visibility = ''public'' and status = ''published'') or public.fq_is_super_admin())';
    execute 'create policy fq_sessions_read on public.game_sessions for select to authenticated
             using (owner_id = auth.uid() or public.fq_is_super_admin())';

    revoke all on public.fq_profiles, public.fq_reserved_emails, public.fq_catalog, public.fq_activity
      from anon, authenticated;
    -- Read-only, and never a write: roles can't be self-assigned.
    grant select on public.fq_profiles, public.fq_catalog, public.fq_activity to authenticated;
    grant select (id, kind, status, visibility, doc, created_at, updated_at) on public.games to authenticated;
    -- Never host_token_hash, config (answer keys) or match (every secret).
    grant select (id, code, kind, game_key, status, owner_id, created_at, started_at, completed_at, finished_at, end_reason)
      on public.game_sessions to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.fq_profiles, public.fq_reserved_emails, public.fq_catalog, public.fq_activity to service_role;
  end if;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'fq_schema_version()',
    'fq_session_game_key(jsonb, uuid)',
    'fq_log_activity(text, uuid, uuid, text, jsonb, text)',
    'fq_auth_user_guard()',
    'fq_auth_user_created()',
    'fq_session_is_complete(text, text, jsonb, integer, integer)',
    'fq_sessions_before_insert()',
    'fq_sessions_after_insert()',
    'fq_sessions_before_update()',
    'fq_admin_end_session(uuid)',
    'fq_auth_profile(uuid)',
    'fq_log_login(uuid)',
    'fq_set_super_admin(text)',
    'fq_catalog_list()',
    'fq_admin_set_visibility(text, text)',
    'fq_claim_session(uuid, uuid)',
    'fq_my_sessions(uuid)',
    'fq_owner_resume(uuid, uuid, text)',
    'fq_session_state(text, timestamptz, timestamptz)',
    'fq_admin_activity_overview()',
    'fq_admin_list_accounts(integer)',
    'fq_admin_list_activity_sessions(jsonb, integer)',
    'fq_admin_session_detail(uuid)',
    'fq_purge_activity(integer)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function public.%s from anon, authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
  end loop;
  -- Used inside the policies above.
  execute 'revoke all on function public.fq_is_super_admin() from public';
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.fq_is_super_admin() to authenticated, service_role';
  end if;
end;
$$;

notify pgrst, 'reload schema';
