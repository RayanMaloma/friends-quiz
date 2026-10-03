-- Friends Quiz: initial schema.
--
-- Design notes
-- * All reads/writes go through the Next.js server using the service role key.
--   RLS is enabled with NO policies, so the browser (anon key) cannot read or
--   write any table directly. The browser only uses Supabase Realtime
--   *broadcast* channels, which carry content-free "sync" pings.
-- * Game state transitions are guarded by row locks + an expected question
--   index, so double clicks / retries are no-ops instead of double actions.
-- * Scores are never stored. They are derived from answers in REVEALED rounds,
--   so there is nothing that can be "scored twice".

create table if not exists public.game_sessions (
  id               uuid primary key default gen_random_uuid(),
  code             text not null check (code ~ '^[0-9]{4}$'),
  host_token_hash  text not null,
  status           text not null default 'LOBBY'
                   check (status in ('LOBBY', 'QUESTION', 'REVEAL', 'LEADERBOARD', 'FINISHED')),
  current_index    integer not null default -1,
  total_questions  integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- A room code is unique among games that are still running.
create unique index if not exists game_sessions_active_code_idx
  on public.game_sessions (code) where status <> 'FINISHED';

create table if not exists public.game_players (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.game_sessions (id) on delete cascade,
  person_id   text not null,
  -- sha256 of the device token. NULL = identity released by the host and claimable again.
  token_hash  text,
  joined_at   timestamptz not null default now(),
  unique (session_id, person_id)
);

create table if not exists public.game_rounds (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.game_sessions (id) on delete cascade,
  round_index      integer not null check (round_index >= 0),
  fact_id          text not null,
  fact_text        text not null,
  owner_person_id  text not null,
  status           text not null default 'OPEN' check (status in ('OPEN', 'REVEALED')),
  -- Snapshot of how many players could answer, taken at reveal time.
  eligible_count   integer,
  revealed_at      timestamptz,
  unique (session_id, round_index)
);

create table if not exists public.answers (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.game_sessions (id) on delete cascade,
  round_id          uuid not null references public.game_rounds (id) on delete cascade,
  player_id         uuid not null references public.game_players (id) on delete cascade,
  chosen_person_id  text not null,
  created_at        timestamptz not null default now(),
  -- One answer per player per round. Submissions are final.
  unique (round_id, player_id)
);

create index if not exists answers_session_idx on public.answers (session_id);

alter table public.game_sessions enable row level security;
alter table public.game_players  enable row level security;
alter table public.game_rounds   enable row level security;
alter table public.answers       enable row level security;

-- Defense in depth: even a direct insert cannot answer a closed round or
-- let the fact owner answer their own fact.
create or replace function public.answers_guard()
returns trigger
language plpgsql
as $$
declare
  v_round  public.game_rounds%rowtype;
  v_person text;
begin
  select * into v_round from public.game_rounds where id = new.round_id;
  if not found or v_round.status <> 'OPEN' then
    raise exception 'ROUND_CLOSED';
  end if;
  select person_id into v_person from public.game_players where id = new.player_id;
  if v_person is null or v_person = v_round.owner_person_id then
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
-- RPC functions (called only by the server with the service role key)
-- Every function returns jsonb: { ok: true, ... } or { ok: false, error: CODE }
-- ---------------------------------------------------------------------------

create or replace function public.fq_create_game(p_host_token_hash text)
returns jsonb
language plpgsql
as $$
declare
  v_code text;
  v_id   uuid;
begin
  for i in 1..60 loop
    v_code := (1000 + floor(random() * 9000))::int::text;
    -- Abandoned games older than 12h give their code back.
    update public.game_sessions
       set status = 'FINISHED', updated_at = now()
     where code = v_code and status <> 'FINISHED' and created_at < now() - interval '12 hours';
    begin
      insert into public.game_sessions (code, host_token_hash)
      values (v_code, p_host_token_hash)
      returning id into v_id;
      return jsonb_build_object('ok', true, 'session_id', v_id, 'code', v_code);
    exception when unique_violation then
      -- code in use, try another one
    end;
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
begin
  select * into v_session
    from public.game_sessions
   where code = p_code and status <> 'FINISHED'
   order by created_at desc
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;
  return jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'status', v_session.status,
    'taken_person_ids', coalesce((
      select jsonb_agg(person_id)
        from public.game_players
       where session_id = v_session.id and token_hash is not null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.fq_join_game(p_code text, p_person_id text, p_token_hash text)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
  v_player  public.game_players%rowtype;
begin
  select * into v_session
    from public.game_sessions
   where code = p_code and status <> 'FINISHED'
   order by created_at desc
   limit 1
   for share;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'GAME_NOT_FOUND');
  end if;

  select * into v_player
    from public.game_players
   where session_id = v_session.id and person_id = p_person_id
   for update;

  if found then
    if v_player.token_hash is not null then
      return jsonb_build_object('ok', false, 'error', 'IDENTITY_TAKEN');
    end if;
    -- Identity was released by the host: claim it, keeping past answers/score.
    update public.game_players set token_hash = p_token_hash where id = v_player.id;
  else
    begin
      insert into public.game_players (session_id, person_id, token_hash)
      values (v_session.id, p_person_id, p_token_hash)
      returning * into v_player;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'IDENTITY_TAKEN');
    end;
  end if;

  return jsonb_build_object('ok', true, 'session_id', v_session.id, 'player_id', v_player.id);
end;
$$;

-- A guest leaves (e.g. picked the wrong name). Only allowed in the lobby.
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

-- Host frees an identity so a new device can pick it (lost phone / cleared storage).
create or replace function public.fq_release_player(p_session_id uuid, p_host_token_hash text, p_person_id text)
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
    delete from public.game_players where session_id = p_session_id and person_id = p_person_id;
  else
    update public.game_players set token_hash = null
     where session_id = p_session_id and person_id = p_person_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- p_rounds: [{ "fact_id": "...", "fact_text": "...", "owner_person_id": "..." }, ...]
-- in the (already balanced-shuffled) play order. Idempotent: only acts in LOBBY.
create or replace function public.fq_start_game(p_session_id uuid, p_host_token_hash text, p_rounds jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
  v_count   integer;
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

  v_count := jsonb_array_length(p_rounds);
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'NO_FACTS');
  end if;

  insert into public.game_rounds (session_id, round_index, fact_id, fact_text, owner_person_id)
  select p_session_id,
         (r.ord - 1)::int,
         r.value ->> 'fact_id',
         r.value ->> 'fact_text',
         r.value ->> 'owner_person_id'
    from jsonb_array_elements(p_rounds) with ordinality as r(value, ord);

  update public.game_sessions
     set status = 'QUESTION', current_index = 0, total_questions = v_count, updated_at = now()
   where id = p_session_id;

  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- p_action: 'reveal' | 'leaderboard' | 'next' | 'finish'
-- p_expected_index: the question index the host's screen is showing.
-- If the game is not in the state the action expects, nothing happens
-- (returns changed=false). This makes double clicks and retries harmless.
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
  if v_session.current_index <> p_expected_index then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  if p_action = 'reveal' and v_session.status = 'QUESTION' then
    update public.game_rounds r
       set status = 'REVEALED',
           revealed_at = now(),
           eligible_count = (
             select count(*) from public.game_players p
              where p.session_id = r.session_id and p.person_id <> r.owner_person_id
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
    update public.game_sessions
       set status = 'QUESTION', current_index = current_index + 1, updated_at = now()
     where id = p_session_id;
    return jsonb_build_object('ok', true, 'changed', true);
  end if;

  if p_action = 'finish'
     and v_session.status in ('REVEAL', 'LEADERBOARD')
     and v_session.current_index = v_session.total_questions - 1 then
    update public.game_sessions set status = 'FINISHED', updated_at = now() where id = p_session_id;
    return jsonb_build_object('ok', true, 'changed', true);
  end if;

  return jsonb_build_object('ok', true, 'changed', false);
end;
$$;

create or replace function public.fq_submit_answer(
  p_session_id uuid, p_token_hash text, p_round_index integer, p_chosen_person_id text
)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
  v_player  public.game_players%rowtype;
  v_round   public.game_rounds%rowtype;
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

  if v_round.owner_person_id = v_player.person_id then
    return jsonb_build_object('ok', false, 'error', 'OWNER_CANNOT_ANSWER');
  end if;
  if p_chosen_person_id = v_player.person_id then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CHOICE');
  end if;

  insert into public.answers (session_id, round_id, player_id, chosen_person_id)
  values (p_session_id, v_round.id, v_player.id, p_chosen_person_id)
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
    'session', jsonb_build_object(
      'id', v_session.id,
      'code', v_session.code,
      'status', v_session.status,
      'current_index', v_session.current_index,
      'total_questions', v_session.total_questions,
      'host_token_hash', v_session.host_token_hash
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'person_id', p.person_id, 'token_hash', p.token_hash
             ) order by p.joined_at)
        from public.game_players p where p.session_id = p_session_id
    ), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'round_index', r.round_index, 'fact_id', r.fact_id,
               'fact_text', r.fact_text, 'owner_person_id', r.owner_person_id,
               'status', r.status, 'eligible_count', r.eligible_count
             ) order by r.round_index)
        from public.game_rounds r where r.session_id = p_session_id
    ), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'round_id', a.round_id, 'player_id', a.player_id,
               'chosen_person_id', a.chosen_person_id
             ))
        from public.answers a where a.session_id = p_session_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Tables: browsers get nothing (RLS + revoke); the service role gets full access.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.game_sessions, public.game_players, public.game_rounds, public.answers
      from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.game_sessions, public.game_players, public.game_rounds, public.answers
      to service_role;
  end if;
end;
$$;

-- Only the service role may call the RPCs (Supabase grants EXECUTE to anon by default).
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'fq_create_game(text)',
    'fq_lookup_game(text)',
    'fq_join_game(text, text, text)',
    'fq_leave_game(uuid, text)',
    'fq_release_player(uuid, text, text)',
    'fq_start_game(uuid, text, jsonb)',
    'fq_host_transition(uuid, text, text, integer)',
    'fq_submit_answer(uuid, text, integer, text)',
    'fq_get_snapshot(uuid)',
    'answers_guard()'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    -- (tables are additionally protected by RLS with no policies)
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function public.%s from anon, authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
  end loop;
end;
$$;
