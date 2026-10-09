-- Platform: games authored in the admin dashboard + live sessions of any game.
--
-- * `games` holds one JSON document per game (people, questions, settings),
--   validated/normalized by the Next.js server before it is saved.
-- * A session snapshots the game when it is created (config + every round,
--   including the secret answer key), so editing a game never affects a
--   running session.
-- * Everything still goes through the Next.js server with the service role:
--   RLS on, no policies, no grants for anon/authenticated.
-- * Scores are still derived (never stored): see lib/game/views.ts.
--
-- This replaces the single-game session tables of the previous migrations.
-- Old sessions are dropped (they were throwaway party rooms). Safe to run twice.

-- ---------------------------------------------------------------------------
-- Drop the single-game schema
-- ---------------------------------------------------------------------------

drop function if exists public.fq_create_game(text);
drop function if exists public.fq_lookup_game(text);
drop function if exists public.fq_join_game(text, text, text);
drop function if exists public.fq_join_game(text, text, text, text);
drop function if exists public.fq_leave_game(uuid, text);
drop function if exists public.fq_release_player(uuid, text, text);
drop function if exists public.fq_release_player(uuid, text, uuid);
drop function if exists public.fq_start_game(uuid, text, jsonb);
drop function if exists public.fq_host_transition(uuid, text, text, integer);
drop function if exists public.fq_submit_answer(uuid, text, integer, text);
drop function if exists public.fq_get_snapshot(uuid);

do $$
begin
  -- Only drop the old session tables (detected by the old fact_text column).
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'game_rounds' and column_name = 'fact_text'
  ) then
    drop table if exists public.answers cascade;
    drop table if exists public.game_rounds cascade;
    drop table if exists public.game_players cascade;
    drop table if exists public.game_sessions cascade;
  end if;
end;
$$;

drop function if exists public.answers_guard() cascade;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.games (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version     integer not null default 1,
  doc         jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.game_sessions (
  id               uuid primary key default gen_random_uuid(),
  code             text not null check (code ~ '^[0-9]{4}$'),
  host_token_hash  text not null,
  game_id          uuid references public.games (id) on delete set null,
  -- Snapshot: title, emoji, accent, people, settings.
  config           jsonb not null,
  status           text not null default 'LOBBY'
                   check (status in ('LOBBY', 'QUESTION', 'REVEAL', 'LEADERBOARD', 'FINISHED')),
  current_index    integer not null default -1,
  total_questions  integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz
);

-- A room code is unique among sessions that are still running.
create unique index if not exists game_sessions_active_code_idx
  on public.game_sessions (code) where status <> 'FINISHED';
create index if not exists game_sessions_game_idx on public.game_sessions (game_id);

create table if not exists public.game_players (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.game_sessions (id) on delete cascade,
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 24),
  -- Link to one of the game's people (config.people[].id), or NULL.
  person_id     text,
  -- sha256 of the device token. NULL = released by the host, claimable again.
  token_hash    text,
  joined_at     timestamptz not null default now()
);

create unique index if not exists game_players_session_person_idx
  on public.game_players (session_id, person_id) where person_id is not null;
create unique index if not exists game_players_session_name_idx
  on public.game_players (session_id, lower(display_name));

create table if not exists public.game_rounds (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.game_sessions (id) on delete cascade,
  round_index      integer not null check (round_index >= 0),
  -- What is shown (type, prompt, image, options). No answers in here.
  question         jsonb not null,
  -- The secret part (correct options, accepted texts, number). Server only.
  answer_key       jsonb not null,
  -- A player linked to this person can't answer this round.
  about_person_id  text,
  time_limit       integer not null default 0 check (time_limit >= 0),
  points           integer not null default 0 check (points >= 0),
  status           text not null default 'OPEN' check (status in ('OPEN', 'REVEALED')),
  opened_at        timestamptz,
  -- Snapshot of how many players could answer, taken at reveal time.
  eligible_count   integer,
  revealed_at      timestamptz,
  unique (session_id, round_index)
);

create table if not exists public.answers (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.game_sessions (id) on delete cascade,
  round_id    uuid not null references public.game_rounds (id) on delete cascade,
  player_id   uuid not null references public.game_players (id) on delete cascade,
  -- {"option": "<id>"} | {"text": "..."} | {"number": 12.5}
  value       jsonb not null,
  created_at  timestamptz not null default clock_timestamp(),
  -- One answer per player per round. Submissions are final.
  unique (round_id, player_id)
);

create index if not exists answers_session_idx on public.answers (session_id);

alter table public.games         enable row level security;
alter table public.game_sessions enable row level security;
alter table public.game_players  enable row level security;
alter table public.game_rounds   enable row level security;
alter table public.answers       enable row level security;

-- Defense in depth: even a direct insert cannot answer a closed round or let
-- the person a question is about answer it.
create or replace function public.answers_guard()
returns trigger
language plpgsql
as $$
declare
  v_round  public.game_rounds%rowtype;
  v_player public.game_players%rowtype;
begin
  select * into v_round from public.game_rounds where id = new.round_id;
  if not found or v_round.status <> 'OPEN' then
    raise exception 'ROUND_CLOSED';
  end if;
  select * into v_player from public.game_players where id = new.player_id;
  if not found then
    raise exception 'NOT_A_PLAYER';
  end if;
  if v_player.person_id is not null and v_player.person_id = v_round.about_person_id then
    raise exception 'OWNER_CANNOT_ANSWER';
  end if;
  return new;
end;
$$;

drop trigger if exists answers_guard_trg on public.answers;
create trigger answers_guard_trg
  before insert or update on public.answers
  for each row execute function public.answers_guard();

-- ---------------------------------------------------------------------------
-- Schema version (lets the dashboard detect a database that needs this file)
-- ---------------------------------------------------------------------------

create or replace function public.fq_schema_version()
returns integer
language sql
immutable
as $$ select 3 $$;

-- ---------------------------------------------------------------------------
-- Admin: games
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
               'session_count', (select count(*) from public.game_sessions s where s.game_id = ga.id)
             ) as g
        from public.games ga
    ) t;
$$;

create or replace function public.fq_admin_get_game(p_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v public.games%rowtype;
begin
  select * into v from public.games where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true, 'game', jsonb_build_object(
    'id', v.id, 'status', v.status, 'version', v.version, 'doc', v.doc, 'updated_at', v.updated_at
  ));
end;
$$;

-- p_id NULL creates a game. p_expected_version guards against two tabs
-- overwriting each other (NULL skips the check).
create or replace function public.fq_admin_save_game(
  p_id uuid, p_doc jsonb, p_expected_version integer, p_status text
)
returns jsonb
language plpgsql
as $$
declare
  v public.games%rowtype;
begin
  if p_status is not null and p_status not in ('draft', 'published', 'archived') then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  if p_id is null then
    insert into public.games (doc, status) values (p_doc, coalesce(p_status, 'draft')) returning * into v;
  else
    select * into v from public.games where id = p_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;
    if p_expected_version is not null and v.version <> p_expected_version then
      return jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT', 'version', v.version);
    end if;
    update public.games
       set doc = p_doc,
           status = coalesce(p_status, status),
           version = version + 1,
           updated_at = now()
     where id = p_id
     returning * into v;
  end if;
  return jsonb_build_object('ok', true, 'game', jsonb_build_object(
    'id', v.id, 'status', v.status, 'version', v.version, 'doc', v.doc, 'updated_at', v.updated_at
  ));
end;
$$;

create or replace function public.fq_admin_set_game_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
as $$
declare
  v public.games%rowtype;
begin
  if p_status not in ('draft', 'published', 'archived') then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  update public.games set status = p_status, version = version + 1, updated_at = now()
   where id = p_id returning * into v;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true, 'status', v.status, 'version', v.version);
end;
$$;

create or replace function public.fq_admin_delete_game(p_id uuid)
returns jsonb
language plpgsql
as $$
begin
  delete from public.games where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: sessions
-- ---------------------------------------------------------------------------

create or replace function public.fq_admin_list_sessions(p_limit integer)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('ok', true, 'sessions', coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb))
    from (
      select jsonb_build_object(
               'id', s.id,
               'code', s.code,
               'game_id', s.game_id,
               'title', s.config->>'title',
               'emoji', s.config->>'emoji',
               'status', s.status,
               'current_index', s.current_index,
               'total_questions', s.total_questions,
               'player_count', (select count(*) from public.game_players p where p.session_id = s.id),
               'created_at', s.created_at,
               'finished_at', s.finished_at
             ) as x
        from public.game_sessions s
       order by s.created_at desc
       limit greatest(1, least(coalesce(p_limit, 50), 500))
    ) t;
$$;

create or replace function public.fq_admin_end_session(p_id uuid)
returns jsonb
language plpgsql
as $$
begin
  update public.game_sessions
     set status = 'FINISHED', updated_at = now(), finished_at = coalesce(finished_at, now())
   where id = p_id and status <> 'FINISHED';
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fq_admin_delete_session(p_id uuid)
returns jsonb
language plpgsql
as $$
begin
  delete from public.game_sessions where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

-- p_rounds: [{ question, answer_key, about_person_id, time_limit, points }, ...]
-- in play order. The session starts in the LOBBY with every round prepared.
create or replace function public.fq_create_session(
  p_host_token_hash text, p_game_id uuid, p_config jsonb, p_rounds jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_code  text;
  v_id    uuid;
  v_count integer := jsonb_array_length(coalesce(p_rounds, '[]'::jsonb));
begin
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'NO_QUESTIONS');
  end if;
  for i in 1..60 loop
    v_code := (1000 + floor(random() * 9000))::int::text;
    -- Abandoned sessions older than 12h give their code back.
    update public.game_sessions
       set status = 'FINISHED', updated_at = now(), finished_at = coalesce(finished_at, now())
     where code = v_code and status <> 'FINISHED' and created_at < now() - interval '12 hours';
    begin
      insert into public.game_sessions (code, host_token_hash, game_id, config, total_questions)
      values (v_code, p_host_token_hash, p_game_id, p_config, v_count)
      returning id into v_id;
    exception when unique_violation then
      continue; -- code in use, try another one
    end;

    insert into public.game_rounds
      (session_id, round_index, question, answer_key, about_person_id, time_limit, points)
    select v_id,
           (r.ord - 1)::int,
           r.value -> 'question',
           r.value -> 'answer_key',
           nullif(r.value ->> 'about_person_id', ''),
           greatest(0, coalesce((r.value ->> 'time_limit')::int, 0)),
           greatest(0, coalesce((r.value ->> 'points')::int, 0))
      from jsonb_array_elements(p_rounds) with ordinality as r(value, ord);

    return jsonb_build_object('ok', true, 'session_id', v_id, 'code', v_code);
  end loop;
  return jsonb_build_object('ok', false, 'error', 'CODE_EXHAUSTED');
end;
$$;

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

-- p_person_id: NULL for a regular player, or the id of one of the game's people.
create or replace function public.fq_join_game(
  p_code text, p_display_name text, p_person_id text, p_token_hash text
)
returns jsonb
language plpgsql
as $$
declare
  v_session    public.game_sessions%rowtype;
  v_player     public.game_players%rowtype;
  v_name       text := btrim(p_display_name);
  v_person     text := p_person_id;
  v_constraint text;
begin
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 24 then
    return jsonb_build_object('ok', false, 'error', 'BAD_NAME');
  end if;

  select * into v_session
    from public.game_sessions
   where code = p_code and status <> 'FINISHED'
   order by created_at desc
   limit 1
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;

  -- Same name as an existing player?
  select * into v_player
    from public.game_players
   where session_id = v_session.id and lower(display_name) = lower(v_name);
  if found then
    if v_player.token_hash is not null then
      return jsonb_build_object('ok', false, 'error', 'NAME_TAKEN');
    end if;
    -- Released by the host: a new device reclaims this player (keeps score + link).
    update public.game_players set token_hash = p_token_hash where id = v_player.id;
    return jsonb_build_object('ok', true, 'session_id', v_session.id, 'player_id', v_player.id,
                              'person_id', v_player.person_id, 'display_name', v_player.display_name);
  end if;

  -- Only link to people that exist in this game, and only if the game asks.
  if v_person is not null and (
       not coalesce((v_session.config #>> '{settings,askPersonOnJoin}')::boolean, false)
       or not exists (select 1 from jsonb_array_elements(v_session.config->'people') p where p->>'id' = v_person)
     ) then
    v_person := null;
  end if;

  if v_person is not null then
    select * into v_player
      from public.game_players
     where session_id = v_session.id and person_id = v_person;
    if found then
      if v_player.token_hash is not null then
        return jsonb_build_object('ok', false, 'error', 'IDENTITY_TAKEN');
      end if;
      -- Released person rejoining under a new name.
      update public.game_players
         set token_hash = p_token_hash, display_name = v_name
       where id = v_player.id;
      return jsonb_build_object('ok', true, 'session_id', v_session.id, 'player_id', v_player.id,
                                'person_id', v_player.person_id, 'display_name', v_name);
    end if;
  end if;

  if v_session.status <> 'LOBBY'
     and not coalesce((v_session.config #>> '{settings,lateJoin}')::boolean, true) then
    return jsonb_build_object('ok', false, 'error', 'GAME_ALREADY_STARTED');
  end if;

  begin
    insert into public.game_players (session_id, person_id, display_name, token_hash)
    values (v_session.id, v_person, v_name, p_token_hash)
    returning * into v_player;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    return jsonb_build_object('ok', false, 'error',
      case when v_constraint = 'game_players_session_person_idx' then 'IDENTITY_TAKEN' else 'NAME_TAKEN' end);
  end;

  return jsonb_build_object('ok', true, 'session_id', v_session.id, 'player_id', v_player.id,
                            'person_id', v_player.person_id, 'display_name', v_player.display_name);
end;
$$;

-- A guest leaves (e.g. typed the wrong name). Only allowed in the lobby.
create or replace function public.fq_leave_game(p_session_id uuid, p_token_hash text)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;
  if v_session.status <> 'LOBBY' then
    return jsonb_build_object('ok', false, 'error', 'GAME_ALREADY_STARTED');
  end if;
  delete from public.game_players where session_id = p_session_id and token_hash = p_token_hash;
  return jsonb_build_object('ok', true);
end;
$$;

-- Host frees a player so a new device can take it over (same name). Lobby: removes them.
create or replace function public.fq_release_player(p_session_id uuid, p_host_token_hash text, p_player_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;
  if v_session.host_token_hash <> p_host_token_hash then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if v_session.status = 'LOBBY' then
    delete from public.game_players where session_id = p_session_id and id = p_player_id;
  else
    update public.game_players set token_hash = null
     where session_id = p_session_id and id = p_player_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Idempotent: only acts in the LOBBY.
create or replace function public.fq_start_game(p_session_id uuid, p_host_token_hash text)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;
  if v_session.host_token_hash <> p_host_token_hash then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if v_session.status <> 'LOBBY' then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  if v_session.total_questions = 0 then
    return jsonb_build_object('ok', false, 'error', 'NO_QUESTIONS');
  end if;

  update public.game_rounds set opened_at = clock_timestamp()
   where session_id = p_session_id and round_index = 0;
  update public.game_sessions
     set status = 'QUESTION', current_index = 0, updated_at = now()
   where id = p_session_id;
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- p_action: 'reveal' | 'leaderboard' | 'next' | 'finish' | 'end'
-- p_expected_index: the question index the host's screen is showing.
-- If the session is not in the state the action expects, nothing happens
-- (changed=false). Double clicks, retries and an auto-reveal racing a manual
-- click are all harmless.
create or replace function public.fq_host_transition(
  p_session_id uuid, p_host_token_hash text, p_action text, p_expected_index integer
)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;
  if v_session.host_token_hash <> p_host_token_hash then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  -- Ending the session early works from any state.
  if p_action = 'end' then
    if v_session.status = 'FINISHED' then
      return jsonb_build_object('ok', true, 'changed', false);
    end if;
    update public.game_sessions
       set status = 'FINISHED', updated_at = now(), finished_at = now()
     where id = p_session_id;
    return jsonb_build_object('ok', true, 'changed', true);
  end if;

  if v_session.current_index <> p_expected_index then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  if p_action = 'reveal' and v_session.status = 'QUESTION' then
    update public.game_rounds r
       set status = 'REVEALED',
           revealed_at = now(),
           eligible_count = (
             select count(*) from public.game_players p
              where p.session_id = r.session_id
                and (r.about_person_id is null or p.person_id is distinct from r.about_person_id)
           )
     where r.session_id = p_session_id
       and r.round_index = v_session.current_index
       and r.status = 'OPEN';
    update public.game_sessions set status = 'REVEAL', updated_at = now() where id = p_session_id;
    return jsonb_build_object('ok', true, 'changed', true);
  end if;

  if p_action = 'leaderboard' and v_session.status = 'REVEAL' then
    update public.game_sessions set status = 'LEADERBOARD', updated_at = now() where id = p_session_id;
    return jsonb_build_object('ok', true, 'changed', true);
  end if;

  if p_action = 'next'
     and v_session.status in ('REVEAL', 'LEADERBOARD')
     and v_session.current_index < v_session.total_questions - 1 then
    update public.game_rounds set opened_at = clock_timestamp()
     where session_id = p_session_id and round_index = v_session.current_index + 1;
    update public.game_sessions
       set status = 'QUESTION', current_index = current_index + 1, updated_at = now()
     where id = p_session_id;
    return jsonb_build_object('ok', true, 'changed', true);
  end if;

  if p_action = 'finish'
     and v_session.status in ('REVEAL', 'LEADERBOARD')
     and v_session.current_index = v_session.total_questions - 1 then
    update public.game_sessions
       set status = 'FINISHED', updated_at = now(), finished_at = now()
     where id = p_session_id;
    return jsonb_build_object('ok', true, 'changed', true);
  end if;

  return jsonb_build_object('ok', true, 'changed', false);
end;
$$;

-- p_value: {"option": "<id>"} | {"text": "..."} | {"number": n}, matching the round type.
create or replace function public.fq_submit_answer(
  p_session_id uuid, p_token_hash text, p_round_index integer, p_value jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
  v_player  public.game_players%rowtype;
  v_round   public.game_rounds%rowtype;
  v_type    text;
  v_value   jsonb;
  v_option  text;
  v_text    text;
  v_rows    integer;
begin
  -- FOR SHARE: waits for an in-flight reveal (FOR UPDATE) to commit, so an
  -- answer can never slip in after the round was locked.
  select * into v_session from public.game_sessions where id = p_session_id for share;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;

  select * into v_player
    from public.game_players
   where session_id = p_session_id and token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_PLAYER');
  end if;

  if v_session.status <> 'QUESTION' or v_session.current_index <> p_round_index then
    return jsonb_build_object('ok', false, 'error', 'ROUND_CLOSED');
  end if;

  select * into v_round
    from public.game_rounds
   where session_id = p_session_id and round_index = p_round_index;
  if not found or v_round.status <> 'OPEN' then
    return jsonb_build_object('ok', false, 'error', 'ROUND_CLOSED');
  end if;

  if v_player.person_id is not null and v_player.person_id = v_round.about_person_id then
    return jsonb_build_object('ok', false, 'error', 'OWNER_CANNOT_ANSWER');
  end if;

  -- Timer (2s grace for network latency).
  if v_round.time_limit > 0 and v_round.opened_at is not null
     and clock_timestamp() > v_round.opened_at + make_interval(secs => v_round.time_limit + 2) then
    return jsonb_build_object('ok', false, 'error', 'TIME_UP');
  end if;

  v_type := v_round.question->>'type';
  if v_type in ('who', 'choice', 'truefalse', 'poll') then
    v_option := p_value->>'option';
    if v_option is null or not exists (
      select 1 from jsonb_array_elements(v_round.question->'options') o where o->>'id' = v_option
    ) then
      return jsonb_build_object('ok', false, 'error', 'INVALID_CHOICE');
    end if;
    if v_type = 'who' and v_option = v_player.person_id then
      return jsonb_build_object('ok', false, 'error', 'INVALID_CHOICE');
    end if;
    v_value := jsonb_build_object('option', v_option);
  elsif v_type = 'text' then
    v_text := btrim(p_value->>'text');
    if v_text is null or char_length(v_text) < 1 or char_length(v_text) > 80 then
      return jsonb_build_object('ok', false, 'error', 'INVALID_ANSWER');
    end if;
    v_value := jsonb_build_object('text', v_text);
  elsif v_type = 'number' then
    if jsonb_typeof(p_value->'number') <> 'number' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_ANSWER');
    end if;
    v_value := jsonb_build_object('number', p_value->'number');
  else
    return jsonb_build_object('ok', false, 'error', 'INVALID_ANSWER');
  end if;

  insert into public.answers (session_id, round_id, player_id, value)
  values (p_session_id, v_round.id, v_player.id, v_value)
  on conflict (round_id, player_id) do nothing;
  get diagnostics v_rows = row_count;

  return jsonb_build_object('ok', true, 'already_submitted', v_rows = 0);
end;
$$;

-- Raw snapshot for the server. NEVER returned to browsers as-is: the server
-- builds role-specific views from it (lib/game/views.ts).
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
      'code', v_session.code,
      'status', v_session.status,
      'current_index', v_session.current_index,
      'total_questions', v_session.total_questions,
      'host_token_hash', v_session.host_token_hash,
      'game_id', v_session.game_id,
      'config', v_session.config,
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
-- Grants: browsers get nothing; the service role gets everything.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.games, public.game_sessions, public.game_players, public.game_rounds, public.answers
      from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.games, public.game_sessions, public.game_players, public.game_rounds, public.answers
      to service_role;
  end if;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'fq_schema_version()',
    'fq_admin_list_games()',
    'fq_admin_get_game(uuid)',
    'fq_admin_save_game(uuid, jsonb, integer, text)',
    'fq_admin_set_game_status(uuid, text)',
    'fq_admin_delete_game(uuid)',
    'fq_admin_list_sessions(integer)',
    'fq_admin_end_session(uuid)',
    'fq_admin_delete_session(uuid)',
    'fq_create_session(text, uuid, jsonb, jsonb)',
    'fq_lookup_game(text)',
    'fq_join_game(text, text, text, text)',
    'fq_leave_game(uuid, text)',
    'fq_release_player(uuid, text, uuid)',
    'fq_start_game(uuid, text)',
    'fq_host_transition(uuid, text, text, integer)',
    'fq_submit_answer(uuid, text, integer, jsonb)',
    'fq_get_snapshot(uuid)',
    'answers_guard()'
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
