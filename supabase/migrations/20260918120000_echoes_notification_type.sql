-- AKINTI — Echoes (Wave E), part 1 of 2: new notification_type value.
--
-- Product decision, 2026-09-18: the founder asked for a lightweight, visible
-- appreciation signal — the concrete gap being that Replay/Save/Comment
-- don't read as a single, immediate "I appreciated this" gesture the way a
-- Like does elsewhere. Per `docs/SECURITY.md`'s own instruction ("No Likes
-- ... a future change reintroducing a Like-shaped feature is a deliberate
-- product decision requiring a spec change, not a small add-on"), this is
-- that spec change — see `docs/ECHOES.md`. It is deliberately NOT called a
-- Like: a single tap ("Echo" / "Yankı"), a public but honestly-computed
-- count (never a fabricated number, never printed at zero — same rule every
-- other count in this product follows), no streaks, no leaderboard, no
-- notification spam beyond the same grouped pattern every other social
-- signal already uses.
--
-- `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that
-- later references the new value in a query/DML statement — this repo's
-- migration runner wraps each file in its own transaction (see the
-- identical note on `20260905120000_duet_v2_notification_type.sql`), so the
-- new value must be committed in its own file before
-- `20260918120100_echoes.sql` can use it.
alter type public.notification_type add value if not exists 'echo';

comment on type public.notification_type is
  'Includes echo (Wave E, 2026-09-18): fired when someone Echoes a Wave — '
  'see push_notification calls in echoes_after_change, docs/ECHOES.md.';
