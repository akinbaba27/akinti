-- Rollback for 20260918120100_echoes.sql

-- Restore waves_guard_insert / waves_guard_update to their pre-Echo bodies
-- (the same versions `20260905120200_duet_v2_modes.sql` last defined),
-- before dropping echo_count itself.
create or replace function public.waves_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_req public.duet_requests;
begin
  if not public.is_service_request() then
    new.play_count := 0;
    new.replay_count := 0;
    new.comment_count := 0;
    new.save_count := 0;
    new.share_count := 0;
    new.duet_count := 0;
  end if;

  if not exists (
    select 1 from public.audio_assets a
    where a.id = new.audio_asset_id and a.owner_id = new.creator_id
  ) then
    raise exception 'audio asset must belong to the wave creator' using errcode = '42501';
  end if;

  if new.creation_type = 'duet' then
    if new.duet_request_id is null then
      raise exception 'a duet wave requires an accepted duet request' using errcode = '42501';
    end if;

    select * into v_req from public.duet_requests where id = new.duet_request_id;
    if v_req.id is null or v_req.status <> 'accepted' then
      raise exception 'duet request is not accepted' using errcode = '42501';
    end if;
    if new.creator_id not in (v_req.requester_id, v_req.recipient_id) then
      raise exception 'not a party to this duet request' using errcode = '42501';
    end if;
    if new.parent_wave_id is distinct from v_req.wave_id then
      raise exception 'duet parent must be the requested wave' using errcode = '42501';
    end if;
  elsif new.duet_request_id is not null then
    raise exception 'only duet waves may reference a duet request' using errcode = '42501';
  end if;

  return new;
end;
$fn$;

create or replace function public.waves_guard_update()
returns trigger
language plpgsql
as $fn$
begin
  if public.is_service_request() or pg_trigger_depth() > 1 then
    return new;
  end if;

  new.play_count    := old.play_count;
  new.replay_count  := old.replay_count;
  new.comment_count := old.comment_count;
  new.save_count    := old.save_count;
  new.share_count   := old.share_count;
  new.duet_count    := old.duet_count;

  new.creator_id      := old.creator_id;
  new.audio_asset_id  := old.audio_asset_id;
  new.creation_type   := old.creation_type;
  new.parent_wave_id  := old.parent_wave_id;
  new.original_wave_id := old.original_wave_id;
  new.duet_request_id := old.duet_request_id;
  new.duet_depth      := old.duet_depth;
  new.duet_mode       := old.duet_mode;
  new.segments        := old.segments;
  new.cypher_order    := old.cypher_order;
  new.published_at    := old.published_at;

  return new;
end;
$fn$;

drop trigger if exists echoes_after_change on public.echoes;
drop function if exists public.echoes_after_change();
alter table public.waves drop constraint if exists waves_echo_count_non_negative;
alter table public.waves drop column if exists echo_count;
drop table if exists public.echoes;
