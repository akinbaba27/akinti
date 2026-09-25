-- AKINTI — Echoes (Wave E), part 2 of 2: the `echoes` table, wave.echo_count,
-- notification, RLS, and the counter guards that lock echo_count down the
-- same way every other counter on `waves` already is.
--
-- Shape deliberately mirrors `public.saves` (`20260903120500_interactions.sql`)
-- as closely as possible — same primary key, same privacy model (a row is
-- private to the person who echoed; only the aggregate on `waves` is
-- public), same trigger-count-plus-notification pattern
-- (`20260903121100_counters_and_events.sql` "saves -> wave.save_count +
-- notification"). Echo is intentionally NOT a re-implementation of a
-- generic "reaction" system (no reaction types, no emoji picker) — one
-- gesture, one meaning, see `docs/ECHOES.md`.

-- ---------------------------------------------------------------------------
-- echoes
-- ---------------------------------------------------------------------------
create table public.echoes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  wave_id    uuid not null references public.waves (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, wave_id)
);

create index echoes_profile_idx on public.echoes (profile_id, created_at desc);
create index echoes_wave_idx on public.echoes (wave_id);

grant select, insert, delete on public.echoes to authenticated;

alter table public.echoes enable row level security;

create policy echoes_select_own on public.echoes
  for select to authenticated using (profile_id = auth.uid());

create policy echoes_insert_own on public.echoes
  for insert to authenticated
  with check (profile_id = auth.uid() and public.can_view_wave(wave_id));

create policy echoes_delete_own on public.echoes
  for delete to authenticated using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- waves.echo_count — maintained by the trigger below, same as every other
-- counter on this table (migration 04's `waves_counters_non_negative`
-- covers the original six; a separate constraint here rather than editing
-- that one, so this migration never has to reproduce it).
-- ---------------------------------------------------------------------------
alter table public.waves add column echo_count integer not null default 0;

alter table public.waves
  add constraint waves_echo_count_non_negative check (echo_count >= 0);

-- ===========================================================================
-- echoes -> wave.echo_count + notification (mirrors saves_after_change())
-- ===========================================================================
create or replace function public.echoes_after_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_creator uuid;
begin
  if tg_op = 'INSERT' then
    update public.waves set echo_count = echo_count + 1 where id = new.wave_id;
    select creator_id into v_creator from public.waves where id = new.wave_id;
    perform public.push_notification(
      v_creator, 'echo', 'echo:' || new.wave_id::text, new.profile_id, new.wave_id
    );
    return new;
  else
    update public.waves set echo_count = greatest(echo_count - 1, 0) where id = old.wave_id;
    return old;
  end if;
end;
$fn$;

create trigger echoes_after_change
  after insert or delete on public.echoes
  for each row execute function public.echoes_after_change();

-- ===========================================================================
-- Lock echo_count down exactly like every other counter (migration 12):
-- clients never set it directly, and it survives a client-initiated update
-- unchanged. Both functions are CREATE OR REPLACE'd in full — Postgres has
-- no way to patch a single line of a function body — reproducing the
-- current body of each (waves_guard_insert last defined in migration 12,
-- waves_guard_update last redefined in `20260905120200_duet_v2_modes.sql`
-- for the Wave D duet_mode/segments/cypher_order columns) with only the new
-- echo_count lines added.
-- ===========================================================================
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
    new.echo_count := 0;
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
  new.echo_count    := old.echo_count;

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
