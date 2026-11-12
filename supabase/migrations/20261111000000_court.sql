-- «المحكمة» rooms (built-in courtroom party game, played on the host screen + phones).
--
-- * A room is a game_sessions row whose config has "kind": "court" (the
--   generated `kind` column picks it up). Not tied to a game in `games`: the
--   cases and the rules are fixed in code (lib/court).
-- * Same model as the other built-ins: the live state is one JSON document
--   (`match`) owned by the Next.js server and saved with the `match_version`
--   optimistic lock, so two jurors voting at the same instant never write on
--   top of the same state and a case is scored once. In the lobby `match`
--   holds the host's settings (`{ v, court, settings, played, game: null }`).
-- * Presence: every phone request stamps `fq_player_presence` (outside the
--   match lock, throttled to one write per 2 s). The server reads it to pause
--   the hearing while a key role's phone is away. Rows go with their player.
-- * Same security model: RLS on, no policies, service role only. The truth,
--   the secrets and the ballots live inside `match` and never reach a browser
--   except through the server's per-device views.
-- * Catalog: a new built-in key 'court' (public), filed by fq_session_game_key,
--   and counted as completed when its match reaches the final results.
--
-- Safe to run twice. Run after 20261102000000_draw.sql.

create or replace function public.fq_schema_version()
returns integer
language sql
immutable
as $$ select 9 $$;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

alter table public.fq_catalog drop constraint if exists fq_catalog_key_check;
alter table public.fq_catalog add constraint fq_catalog_key_check
  check (key in ('mafia', 'invent', 'invent_ahaji', 'draw', 'court'));

insert into public.fq_catalog (key, visibility)
values ('court', 'public')
on conflict do nothing;

create or replace function public.fq_session_game_key(p_config jsonb, p_game_id uuid)
returns text
language sql
immutable
as $$
  select case coalesce(p_config->>'kind', 'quiz')
           when 'mafia' then 'mafia'
           when 'invent' then case when p_config->>'questionSet' = 'custom' then 'invent' else 'invent_ahaji' end
           when 'draw' then 'draw'
           when 'court' then 'court'
           else p_game_id::text
         end
$$;

create or replace function public.fq_session_is_complete(p_kind text, p_status text, p_match jsonb, p_index integer, p_total integer)
returns boolean
language sql
immutable
as $$
  select case p_kind
           when 'quiz' then p_status = 'FINISHED' and p_total > 0 and p_index >= p_total - 1
           when 'invent' then p_match #>> '{game,phase}' = 'final'
                              and coalesce((p_match #>> '{game,endedEarly}')::boolean, false) = false
           when 'draw' then p_match #>> '{game,phase}' = 'final'
                            and coalesce((p_match #>> '{game,endedEarly}')::boolean, false) = false
           when 'court' then p_match #>> '{game,phase}' = 'final'
                             and coalesce((p_match #>> '{game,endedEarly}')::boolean, false) = false
           else jsonb_typeof(p_match->'winner') = 'object'
         end
$$;

-- p_key: a built-in key ('mafia', 'invent', 'invent_ahaji', 'draw', 'court') or a game id.
create or replace function public.fq_admin_set_visibility(p_key text, p_visibility text)
returns jsonb
language plpgsql
as $$
begin
  if p_visibility not in ('public', 'private') then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  if p_key in ('mafia', 'invent', 'invent_ahaji', 'draw', 'court') then
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
-- Rooms
-- ---------------------------------------------------------------------------

-- p_config: { kind: 'court', title, emoji, accent, settings: { lateJoin: true, askPersonOnJoin: false }, people: [] }
-- p_match:  the lobby document (settings only).
create or replace function public.fq_court_create_session(p_host_token_hash text, p_config jsonb, p_match jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_code text;
  v_id   uuid;
begin
  if coalesce(p_config->>'kind', '') <> 'court' or p_match is null then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  for i in 1..60 loop
    v_code := (1000 + floor(random() * 9000))::int::text;
    update public.game_sessions
       set status = 'FINISHED', updated_at = now(), finished_at = coalesce(finished_at, now())
     where code = v_code and status <> 'FINISHED' and created_at < now() - interval '12 hours';
    begin
      insert into public.game_sessions (code, host_token_hash, game_id, config, total_questions, match)
      values (v_code, p_host_token_hash, null, p_config, 0, p_match)
      returning id into v_id;
    exception when unique_violation then
      continue;
    end;
    return jsonb_build_object('ok', true, 'session_id', v_id, 'code', v_code);
  end loop;
  return jsonb_build_object('ok', false, 'error', 'CODE_EXHAUSTED');
end;
$$;

-- Writes a new state if nobody else wrote one since p_expected_version.
-- The Next.js server has already checked who is acting and run the engine.
-- p_status: 'LOBBY' (settings, joining open), 'PLAYING', or 'FINISHED' (room closed for good).
create or replace function public.fq_court_save_match(
  p_session_id uuid, p_expected_version integer, p_match jsonb, p_status text
)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  if p_status not in ('LOBBY', 'PLAYING', 'FINISHED') or p_match is null then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found or v_session.kind <> 'court' then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;
  if v_session.status = 'FINISHED' then
    return jsonb_build_object('ok', false, 'error', 'GAME_OVER');
  end if;
  if v_session.match_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'error', 'STALE_STATE', 'version', v_session.match_version);
  end if;
  update public.game_sessions
     set match = p_match,
         match_version = match_version + 1,
         status = p_status,
         updated_at = now(),
         finished_at = case when p_status = 'FINISHED' then coalesce(finished_at, now()) else finished_at end
   where id = p_session_id;
  return jsonb_build_object('ok', true, 'version', v_session.match_version + 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Presence
-- ---------------------------------------------------------------------------

create table if not exists public.fq_player_presence (
  player_id  uuid primary key references public.game_players (id) on delete cascade,
  session_id uuid not null references public.game_sessions (id) on delete cascade,
  seen_at    timestamptz not null default now()
);
create index if not exists fq_player_presence_session_idx on public.fq_player_presence (session_id);
alter table public.fq_player_presence enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.fq_player_presence from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.fq_player_presence to service_role;
  end if;
end;
$$;

-- Stamps p_player_id (when given, and only if it belongs to the room) as seen
-- now, then returns when every player of the room was last seen:
-- { ok, seen: { <player id>: <epoch ms> } }. p_player_id null = read only (host screen).
create or replace function public.fq_court_touch(p_session_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
as $$
begin
  if p_player_id is not null then
    insert into public.fq_player_presence (player_id, session_id, seen_at)
    select p.id, p.session_id, clock_timestamp()
      from public.game_players p
     where p.id = p_player_id and p.session_id = p_session_id
    on conflict (player_id) do update
       set seen_at = excluded.seen_at
     where public.fq_player_presence.seen_at < excluded.seen_at - interval '2 seconds';
  end if;
  return jsonb_build_object(
    'ok', true,
    'seen', coalesce((
      select jsonb_object_agg(player_id::text, floor(extract(epoch from seen_at) * 1000)::bigint)
        from public.fq_player_presence
       where session_id = p_session_id
    ), '{}'::jsonb)
  );
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'fq_schema_version()',
    'fq_session_game_key(jsonb, uuid)',
    'fq_session_is_complete(text, text, jsonb, integer, integer)',
    'fq_admin_set_visibility(text, text)',
    'fq_court_create_session(text, jsonb, jsonb)',
    'fq_court_save_match(uuid, integer, jsonb, text)',
    'fq_court_touch(uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function public.%s from anon, authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
