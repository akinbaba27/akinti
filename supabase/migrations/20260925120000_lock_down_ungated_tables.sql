-- AKINTI — security fix: close the two public tables that had neither RLS
-- nor restricted grants (audit 2026-09-25).
--
-- Every other table in `public` is gated one of two ways: RLS with real
-- per-row policies, or RLS enabled with zero policies (fail-closed — see
-- `billing_events`, `play_events`, `rate_limit_events`, all three verified
-- to return `[]` to an anon REST caller). Two tables were neither:
--
--   * `public.schema_migrations` — created by this repo's own migration
--     runner (`scripts/apply-migrations.ts`), so it never went through a
--     migration that would have enabled RLS on it.
--   * `public.rate_limit_actions` — `20260906140000_rate_limit_actions_union.sql`
--     deliberately left RLS off ("static reference data ... reads are
--     harmless; only migrations insert into it") and granted `select` to
--     anon/authenticated.
--
-- The gap in both cases is the same: Supabase ships a blanket
-- `grant all on all tables in schema public to anon, authenticated`, and a
-- migration that only *adds* `select` never takes the rest away. With RLS
-- off, those leftover INSERT/UPDATE/DELETE/TRUNCATE grants are live over
-- PostgREST. Confirmed against the live project on 2026-09-25:
-- `GET /rest/v1/schema_migrations?select=name` returned real rows to a
-- caller holding only the publishable (anon) key.
--
-- Why it matters beyond information disclosure: `rate_limit_events.action`
-- is a foreign key onto `rate_limit_actions (action) on update cascade`, so
-- an anonymous UPDATE renaming a row (e.g. 'audio_upload') cascades and
-- makes `check_rate_limit` fail for that action for everyone — a trivially
-- reachable denial of service on uploads, comments, follows, messages,
-- duet requests, reports, challenge entries, checkout and flow events. An
-- anonymous DELETE or TRUNCATE of `schema_migrations` corrupts the ledger
-- that decides which migrations are still pending.
--
-- Fix, per table, without changing any intended read path:
--   * `rate_limit_actions` keeps its deliberate public `select`; every
--     write privilege is revoked. RLS stays off on purpose, exactly as
--     20260906140000 reasoned — revoking the grants is the precise fix and
--     leaves the foreign-key check alone.
--   * `schema_migrations` is runner bookkeeping, not application data: no
--     client role has any business reading or writing it, so every grant is
--     revoked AND RLS is enabled with no policies, matching the fail-closed
--     pattern the other three non-client tables already use. Safe for the
--     runner itself: it connects as `postgres`, which owns both tables and
--     has `rolbypassrls`.

-- ---------------------------------------------------------------------------
-- rate_limit_actions — reads stay public, writes are revoked.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on public.rate_limit_actions from anon, authenticated;

grant select on public.rate_limit_actions to anon, authenticated, service_role;

comment on table public.rate_limit_actions is
  'Closed whitelist of rate_limit_events.action values, enforced via foreign '
  'key rather than a check constraint so a new action can be added with a '
  'single insert instead of a drop/add constraint pair that can silently '
  'race a concurrent migration touching the same constraint (review3 finding 1). '
  'RLS is deliberately off (static reference data, keeps the FK check simple); '
  'client roles hold SELECT only — every write privilege was revoked by '
  '20260925120000 after an audit found the Supabase default blanket grant '
  'still left anon able to UPDATE/DELETE here, which cascades into '
  'rate_limit_events and breaks rate limiting.';

-- ---------------------------------------------------------------------------
-- schema_migrations — not application data; fully closed to client roles.
-- ---------------------------------------------------------------------------
revoke all on public.schema_migrations from anon, authenticated;

alter table public.schema_migrations enable row level security;

comment on table public.schema_migrations is
  'Applied-migration ledger written by scripts/apply-migrations.ts. Not '
  'application data: no grants to anon/authenticated and RLS on with zero '
  'policies (fail-closed), so it is unreachable over PostgREST. The runner '
  'connects as the owning postgres role, which bypasses RLS.';
