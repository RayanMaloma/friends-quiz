-- Mafia rooms (built-in game, played on the TV + phones).
--
-- * A Mafia room is a game_sessions row whose config has "kind": "mafia"
--   (the generated `kind` column picks it up). It is not tied to a game in
--   `games`: the rules are fixed in code (lib/mafia).
-- * Like deduction rooms, the live state is one JSON document (`match`)
--   owned by the Next.js server, saved with the `match_version` optimistic
--   lock. Unlike them, a room survives the end of a match: the host can go
--   back to the lobby (match = null) for a rematch with the same players.
-- * Same security model: RLS on, no policies, service role only.
--
-- Safe to run twice. Run after 20261018000000_deduction.sql.

create or replace function public.fq_schema_version()
returns integer
language sql
immutable
as $$ select 5 $$;

-- p_config: { kind: 'mafia', title, emoji, accent, settings: { lateJoin: false, askPersonOnJoin: false }, people: [] }
create or replace function public.fq_mafia_create_session(p_host_token_hash text, p_config jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_code text;
  v_id   uuid;
begin
  if coalesce(p_config->>'kind', '') <> 'mafia' then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  for i in 1..60 loop
    v_code := (1000 + floor(random() * 9000))::int::text;
    update public.game_sessions
       set status = 'FINISHED', updated_at = now(), finished_at = coalesce(finished_at, now())
     where code = v_code and status <> 'FINISHED' and created_at < now() - interval '12 hours';
    begin
      insert into public.game_sessions (code, host_token_hash, game_id, config, total_questions)
      values (v_code, p_host_token_hash, null, p_config, 0)
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
-- p_status: 'LOBBY' (back to the lobby, p_match null), 'PLAYING' or 'FINISHED' (room closed for good).
create or replace function public.fq_mafia_save_match(
  p_session_id uuid, p_expected_version integer, p_match jsonb, p_status text
)
returns jsonb
language plpgsql
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  if p_status not in ('LOBBY', 'PLAYING', 'FINISHED')
     or (p_match is null and p_status = 'PLAYING') then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found or v_session.kind <> 'mafia' then
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
    'fq_mafia_create_session(text, jsonb)',
    'fq_mafia_save_match(uuid, integer, jsonb, text)'
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
