-- Deduction games (hidden roles, Secret-Hitler style), played on the TV + phones.
--
-- * A deduction game is a row in `games` whose doc has "kind": "deduction".
--   The doc holds the whole design (GameConfig) + its image library.
-- * A deduction session reuses game_sessions / game_players (same room codes,
--   same /join flow). Its live state is one JSON document (`match`) owned by
--   the Next.js server, which runs the game engine and checks who may act.
--   `match_version` is an optimistic lock: two simultaneous actions can never
--   both apply on top of the same state.
-- * Same security model: RLS on, no policies, service role only.
--
-- Safe to run twice. Run after 20261009000000_platform.sql.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.games
  add column if not exists kind text generated always as (coalesce(doc->>'kind', 'quiz')) stored;

alter table public.game_sessions
  add column if not exists kind text generated always as (coalesce(config->>'kind', 'quiz')) stored;
alter table public.game_sessions add column if not exists match jsonb;
alter table public.game_sessions add column if not exists match_version integer not null default 0;

-- Deduction sessions are 'PLAYING' between the lobby and the end.
alter table public.game_sessions drop constraint if exists game_sessions_status_check;
alter table public.game_sessions add constraint game_sessions_status_check
  check (status in ('LOBBY', 'QUESTION', 'REVEAL', 'LEADERBOARD', 'PLAYING', 'FINISHED'));

-- ---------------------------------------------------------------------------
-- Version
-- ---------------------------------------------------------------------------

create or replace function public.fq_schema_version()
returns integer
language sql
immutable
as $$ select 4 $$;

-- ---------------------------------------------------------------------------
-- Admin lists now say which kind of game / session each row is
-- ---------------------------------------------------------------------------

create or replace function public.fq_admin_list_games()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('ok', true, 'games', coalesce(jsonb_agg(g order by g->>'updated_at' desc), '[]'::jsonb))
    from (
      select jsonb_build_object(
               'id', ga.id,
               'kind', ga.kind,
               'status', ga.status,
               'version', ga.version,
               'updated_at', ga.updated_at,
               'title', ga.doc->>'title',
               'emoji', ga.doc->>'emoji',
               'cover', ga.doc->'cover',
               'accent', ga.doc->>'accent',
               'question_count', (
                 select count(*) from jsonb_array_elements(coalesce(ga.doc->'questions', '[]'::jsonb)) q
                  where coalesce((q->>'enabled')::boolean, true)
               ),
               'people_count', jsonb_array_length(coalesce(ga.doc->'people', '[]'::jsonb)),
               'min_players', ga.doc #> '{config,mechanics,minPlayers}',
               'max_players', ga.doc #> '{config,mechanics,maxPlayers}',
               'session_count', (select count(*) from public.game_sessions s where s.game_id = ga.id)
             ) as g
        from public.games ga
    ) t;
$$;

create or replace function public.fq_admin_list_sessions(p_limit integer)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('ok', true, 'sessions', coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb))
    from (
      select jsonb_build_object(
               'id', s.id,
               'kind', s.kind,
               'code', s.code,
               'game_id', s.game_id,
               'title', s.config->>'title',
               'emoji', s.config->>'emoji',
               'status', s.status,
               'current_index', s.current_index,
               'total_questions', s.total_questions,
               'round', s.match->'round',
               'winner', s.match #> '{winner,factionId}',
               'player_count', (select count(*) from public.game_players p where p.session_id = s.id),
               'created_at', s.created_at,
               'finished_at', s.finished_at
             ) as x
        from public.game_sessions s
       order by s.created_at desc
       limit greatest(1, least(coalesce(p_limit, 50), 500))
    ) t;
$$;

-- ---------------------------------------------------------------------------
-- Lookup returns the kind, so /join can send the phone to the right screen
-- ---------------------------------------------------------------------------

create or replace function public.fq_lookup_game(p_code text)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
  v_ask     boolean;
begin
  select * into v_session
    from public.game_sessions
   where code = p_code and status <> 'FINISHED'
   order by created_at desc
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;
  v_ask := coalesce((v_session.config #>> '{settings,askPersonOnJoin}')::boolean, false)
           and jsonb_array_length(coalesce(v_session.config->'people', '[]'::jsonb)) > 0;
  return jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'kind', v_session.kind,
    'status', v_session.status,
    'title', v_session.config->>'title',
    'emoji', v_session.config->>'emoji',
    'accent', v_session.config->>'accent',
    'ask_person', v_ask,
    'can_join', v_session.status = 'LOBBY'
                or coalesce((v_session.config #>> '{settings,lateJoin}')::boolean, true),
    'people', case when v_ask then coalesce((
                select jsonb_agg(jsonb_build_object('id', p->>'id', 'name', p->>'name'))
                  from jsonb_array_elements(v_session.config->'people') p
              ), '[]'::jsonb) else '[]'::jsonb end,
    'taken_person_ids', coalesce((
      select jsonb_agg(person_id)
        from public.game_players
       where session_id = v_session.id and token_hash is not null and person_id is not null
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Snapshot includes the deduction state
-- ---------------------------------------------------------------------------

create or replace function public.fq_get_snapshot(p_session_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions where id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;
  return jsonb_build_object(
    'ok', true,
    'now', clock_timestamp(),
    'session', jsonb_build_object(
      'id', v_session.id,
      'kind', v_session.kind,
      'code', v_session.code,
      'status', v_session.status,
      'current_index', v_session.current_index,
      'total_questions', v_session.total_questions,
      'host_token_hash', v_session.host_token_hash,
      'game_id', v_session.game_id,
      'config', v_session.config,
      'match', v_session.match,
      'match_version', v_session.match_version,
      'created_at', v_session.created_at
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'person_id', p.person_id, 'display_name', p.display_name,
               'token_hash', p.token_hash
             ) order by p.joined_at, p.id)
        from public.game_players p where p.session_id = p_session_id
    ), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'round_index', r.round_index, 'question', r.question,
               'answer_key', r.answer_key, 'about_person_id', r.about_person_id,
               'time_limit', r.time_limit, 'points', r.points, 'status', r.status,
               'opened_at', r.opened_at, 'eligible_count', r.eligible_count
             ) order by r.round_index)
        from public.game_rounds r where r.session_id = p_session_id
    ), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'round_id', a.round_id, 'player_id', a.player_id,
               'value', a.value, 'created_at', a.created_at
             ) order by a.created_at)
        from public.answers a where a.session_id = p_session_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Deduction sessions
-- ---------------------------------------------------------------------------

-- p_config: { kind: 'deduction', title, emoji, accent, settings: { lateJoin: false }, game: <GameConfig>, assets: [...] }
create or replace function public.fq_dx_create_session(
  p_host_token_hash text, p_game_id uuid, p_config jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_code text;
  v_id   uuid;
begin
  if coalesce(p_config->>'kind', '') <> 'deduction' then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  for i in 1..60 loop
    v_code := (1000 + floor(random() * 9000))::int::text;
    update public.game_sessions
       set status = 'FINISHED', updated_at = now(), finished_at = coalesce(finished_at, now())
     where code = v_code and status <> 'FINISHED' and created_at < now() - interval '12 hours';
    begin
      insert into public.game_sessions (code, host_token_hash, game_id, config, total_questions)
      values (v_code, p_host_token_hash, p_game_id, p_config, 0)
      returning id into v_id;
    exception when unique_violation then
      continue;
    end;
    return jsonb_build_object('ok', true, 'session_id', v_id, 'code', v_code);
  end loop;
  return jsonb_build_object('ok', false, 'error', 'CODE_EXHAUSTED');
end;
$$;

-- Writes a new match state if nobody else wrote one since p_expected_version.
-- The Next.js server has already checked who is acting and run the engine.
-- p_status: 'PLAYING' or 'FINISHED' (a deduction session never goes back to the lobby).
create or replace function public.fq_dx_save_match(
  p_session_id uuid, p_expected_version integer, p_match jsonb, p_status text
)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  if p_status not in ('PLAYING', 'FINISHED') or p_match is null then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found or v_session.kind <> 'deduction' then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;
  if v_session.status = 'FINISHED' and p_status <> 'FINISHED' then
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
-- Grants
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'fq_schema_version()',
    'fq_admin_list_games()',
    'fq_admin_list_sessions(integer)',
    'fq_lookup_game(text)',
    'fq_get_snapshot(uuid)',
    'fq_dx_create_session(text, uuid, jsonb)',
    'fq_dx_save_match(uuid, integer, jsonb, text)'
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
