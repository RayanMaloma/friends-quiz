-- «وزارة المقيمين للفنون والرسم» rooms (built-in drawing game, played on
-- the host screen + phones).
--
-- * A room is a game_sessions row whose config has "kind": "draw" (the
--   generated `kind` column picks it up). Not tied to a game in `games`: the
--   word bank and the rules are fixed in code (lib/draw).
-- * Same model as «اخترع إجابتك»: the live state is one JSON document
--   (`match`) owned by the Next.js server and saved with the `match_version`
--   optimistic lock, so two phones guessing at the same instant can never
--   both write on top of the same state and a turn is scored once. In the
--   lobby `match` holds the host's settings (`{ v, settings, game: null }`).
-- * Same security model: RLS on, no policies, service role only. The word,
--   the drawings and the guesses live inside `match` and never reach a
--   browser except through the server's per-device views.
-- * Catalog: a new built-in key 'draw' (public), filed by fq_session_game_key,
--   and counted as completed when its match reaches the final results.
--
-- Safe to run twice. Run after 20261030020000_auth_users_access.sql.

create or replace function public.fq_schema_version()
returns integer
language sql
immutable
as $$ select 8 $$;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

alter table public.fq_catalog drop constraint if exists fq_catalog_key_check;
alter table public.fq_catalog add constraint fq_catalog_key_check
  check (key in ('mafia', 'invent', 'invent_ahaji', 'draw'));

insert into public.fq_catalog (key, visibility)
values ('draw', 'public')
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
           else jsonb_typeof(p_match->'winner') = 'object'
         end
$$;

-- p_key: a built-in key ('mafia', 'invent', 'invent_ahaji', 'draw') or a game id.
create or replace function public.fq_admin_set_visibility(p_key text, p_visibility text)
returns jsonb
language plpgsql
as $$
begin
  if p_visibility not in ('public', 'private') then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  if p_key in ('mafia', 'invent', 'invent_ahaji', 'draw') then
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

-- p_config: { kind: 'draw', title, emoji, accent, settings: { lateJoin: true, askPersonOnJoin: false }, people: [] }
-- p_match:  the lobby document (settings only).
create or replace function public.fq_draw_create_session(p_host_token_hash text, p_config jsonb, p_match jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_code text;
  v_id   uuid;
begin
  if coalesce(p_config->>'kind', '') <> 'draw' or p_match is null then
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
create or replace function public.fq_draw_save_match(
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
  if not found or v_session.kind <> 'draw' then
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

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'fq_schema_version()',
    'fq_session_game_key(jsonb, uuid)',
    'fq_session_is_complete(text, text, jsonb, integer, integer)',
    'fq_admin_set_visibility(text, text)',
    'fq_draw_create_session(text, jsonb, jsonb)',
    'fq_draw_save_match(uuid, integer, jsonb, text)'
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
