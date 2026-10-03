-- Open player model.
--
-- Players are no longer limited to the six people in people.json. Each player
-- has a free display name. A player MAY be linked to one of the fact owners
-- (person_id) so they are excluded from voting on their own facts; players
-- without a link (person_id NULL) can answer every question.
--
-- Safe to run on a database that already has 20261004000000_init.sql, and safe
-- to run twice.

alter table public.game_players add column if not exists display_name text;
update public.game_players set display_name = person_id where display_name is null;
alter table public.game_players alter column display_name set not null;
alter table public.game_players alter column person_id drop not null;
alter table public.game_players drop constraint if exists game_players_session_id_person_id_key;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'game_players_display_name_len') then
    alter table public.game_players
      add constraint game_players_display_name_len
      check (char_length(btrim(display_name)) between 1 and 24);
  end if;
end;
$$;

-- One device per fact owner, and display names unique (case-insensitive) per game.
create unique index if not exists game_players_session_person_idx
  on public.game_players (session_id, person_id) where person_id is not null;
create unique index if not exists game_players_session_name_idx
  on public.game_players (session_id, lower(display_name));

-- Owner guard: unlinked players (person_id NULL) may answer anything.
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
  if v_player.person_id is not null and v_player.person_id = v_round.owner_person_id then
    raise exception 'OWNER_CANNOT_ANSWER';
  end if;
  return new;
end;
$$;

-- Fact owners already linked to an active device (so the join screen can disable them).
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
       where session_id = v_session.id and token_hash is not null and person_id is not null
    ), '[]'::jsonb)
  );
end;
$$;

drop function if exists public.fq_join_game(text, text, text);
drop function if exists public.fq_release_player(uuid, text, text);

-- p_person_id: NULL for a regular player, or the people.json id if this player
-- is one of the fact owners.
create or replace function public.fq_join_game(
  p_code text, p_display_name text, p_person_id text, p_token_hash text
)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
  v_player  public.game_players%rowtype;
  v_name    text := btrim(p_display_name);
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
    -- Released by the host: a new device reclaims this player (keeps score + owner link).
    update public.game_players set token_hash = p_token_hash where id = v_player.id;
    return jsonb_build_object('ok', true, 'session_id', v_session.id, 'player_id', v_player.id,
                              'person_id', v_player.person_id, 'display_name', v_player.display_name);
  end if;

  if p_person_id is not null then
    select * into v_player
      from public.game_players
     where session_id = v_session.id and person_id = p_person_id;
    if found then
      if v_player.token_hash is not null then
        return jsonb_build_object('ok', false, 'error', 'IDENTITY_TAKEN');
      end if;
      -- Released fact owner rejoining under a new name.
      update public.game_players
         set token_hash = p_token_hash, display_name = v_name
       where id = v_player.id;
      return jsonb_build_object('ok', true, 'session_id', v_session.id, 'player_id', v_player.id,
                                'person_id', v_player.person_id, 'display_name', v_name);
    end if;
  end if;

  begin
    insert into public.game_players (session_id, person_id, display_name, token_hash)
    values (v_session.id, p_person_id, v_name, p_token_hash)
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

-- Same as before, except eligibility treats unlinked players as eligible.
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
              where p.session_id = r.session_id
                and p.person_id is distinct from r.owner_person_id
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
               'id', p.id, 'person_id', p.person_id, 'display_name', p.display_name,
               'token_hash', p.token_hash
             ) order by p.joined_at, p.id)
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

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'fq_lookup_game(text)',
    'fq_join_game(text, text, text, text)',
    'fq_release_player(uuid, text, uuid)',
    'fq_host_transition(uuid, text, text, integer)',
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
