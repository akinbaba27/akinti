-- Rollback for 20260925120000_lock_down_ungated_tables.sql
--
-- Restores the pre-fix privilege state: Supabase's blanket
-- `grant all ... to anon, authenticated` on both tables and RLS back off on
-- `schema_migrations`. Note what this means — rolling this back deliberately
-- re-opens the anon write path the forward migration closed. Only run it to
-- unblock a bad deploy, and re-apply the forward migration afterwards.

alter table public.schema_migrations disable row level security;

grant all on public.schema_migrations to anon, authenticated;

grant all on public.rate_limit_actions to anon, authenticated;

comment on table public.rate_limit_actions is
  'Closed whitelist of rate_limit_events.action values, enforced via foreign '
  'key rather than a check constraint so a new action can be added with a '
  'single insert instead of a drop/add constraint pair that can silently '
  'race a concurrent migration touching the same constraint (review3 finding 1).';

comment on table public.schema_migrations is null;
