# AKINTI — Echoes ("Yankı")

Founder decision, 2026-09-18: a lightweight, visible appreciation signal.
Per `docs/SECURITY.md`'s own standing instruction ("a future change
reintroducing a Like-shaped feature is a deliberate product decision
requiring a spec change, not a small add-on"), this document is that spec
change. Migration: `supabase/migrations/20260918120000_echoes_notification_type.sql`
+ `20260918120100_echoes.sql` (rollback: the matching files under
`supabase/migrations/down/`).

## What it is, and what it deliberately is not

Echo is one gesture, one meaning: a single tap that says "I appreciated
this." It is not a re-implementation of a generic reaction system — no
reaction types, no emoji picker, no "which of six feelings" choice. It is
not called a Like, even though it fills the gap a Like usually fills: the
founder's read was that Replay/Save/Comment don't read as a single,
immediate appreciation gesture the way a Like does elsewhere, and asked for
one, explicitly accepting that this is a conscious, informed override of the
product's original "No Likes" decision (`docs/PRODUCT_SPEC_ORIGINAL.md`
§3.4, `docs/SECURITY.md` "No Likes"), not an accidental reintroduction of
one.

What Echo keeps from that original decision, on purpose: no streaks, no
badges, no public leaderboard of who echoes most, no gamification of any
kind (`docs/design/DESIGN.md` §12 rule 35 still applies). The count is
always the real, honestly-computed aggregate — never fabricated, never
printed at zero (the same "never print a zero metric" rule every other
count in this product follows). Echoing is idempotent and reversible
(un-echo), exactly like Save.

## Schema

- **`echoes`** — one row per (profile, wave): `profile_id`, `wave_id`,
  `created_at`. Primary key `(profile_id, wave_id)`. Shape and privacy model
  copied deliberately from `public.saves`
  (`supabase/migrations/20260903120500_interactions.sql`): a row is private
  to the person who echoed (`echoes_select_own` RLS); only the aggregate is
  public.
- **`waves.echo_count`** — maintained by `echoes_after_change()`
  (mirrors `saves_after_change()`), locked against direct client writes by
  `waves_guard_insert`/`waves_guard_update` exactly like every other counter
  on `waves` (migration 12).

## Authorization

- **Echoing.** `echoes_insert_own` RLS: `profile_id = auth.uid()` and
  `can_view_wave(wave_id)` — you can only Echo a Wave you can actually see.
  There is no restriction on echoing your own Wave (unlike a Duet request),
  since Echo is not a collaboration ask.
- **Reading your own Echo state.** `echoes_select_own` — a viewer reads only
  their own rows, the same way `saves` works; there is no public "who
  echoed this" list in this pass.
- **Un-echoing.** `echoes_delete_own` — a viewer removes only their own row.

## Notification

`echo` (added to `notification_type` in its own migration, same reason
`open_call_answered` needed one — see that migration's own comment),
grouped by `push_notification()` like every other social notification
(`group_key = 'echo:<wave_id>'`). No dedicated notification-preference
category — always delivered, same treatment `save`/`share` already get.

## App layer

- `src/lib/db/echoes.ts` — `echoWave`, `unechoWave`, `isWaveEchoed`,
  `getEchoedWaveIds` (mirrors `src/lib/db/saves.ts` line for line).
- `src/lib/db/waves.ts#listEchoedWaveIds` — batch read for hydrating a page
  of Wave cards, mirrors `listSavedWaveIds`.
- `src/app/(app)/w/[id]/interactions.ts#echoWave`/`unechoWave` — Server
  Actions, same contract as every other action in this file
  (`{ ok, error?, message?, data? }`, never throws to the client).
- `src/lib/interactions/echoReducer.ts` — optimistic toggle/rollback state,
  mirrors `saveReducer.ts`.

## UI

Deliberately NOT part of the generic metrics row (`METRICS`/`MetricKey`,
`src/config/terminology.ts` — that union was not extended). "312 plays · 41
replays · 6 duets" stays exactly as it was; Echo gets its own button (a
`Waves` icon, filled when echoed) with its own count printed directly next
to it, in `WaveCard.tsx`, `WaveCardContainer.tsx` and the Wave detail page
(`WaveDetail.tsx`). This was a deliberate design call, not an oversight: the
founder's stated complaint was that the existing signals don't read as
"concrete and visible" enough — folding Echo into the same pluralized
sentence as everything else would have reproduced exactly that problem.

## Known gaps (not done in this pass)

Echo currently only appears on the Wave detail page and everywhere
`WaveCardContainer` renders a Wave (Explore, Home, search, hashtag pages,
Challenges entries). It does **not** yet appear in Flow's own full-screen
swipe view (`src/app/(app)/flow/hydrateFlow.ts` / `FlowWaveView.tsx`) or a
profile's Saved/Published/Duets tabs (`src/lib/interactions/contentLists.ts`
/ its own `ContentWaveCard`), which hydrate their own, separate card shapes
rather than going through `WaveCardContainer`. Both were left alone
deliberately, to keep this pass's surface area (and risk) contained — the
`echoes` table, the count on `waves`, and every DB-level authorization check
are already real and correct regardless; adding the button to those two
surfaces is purely a UI wiring task for later, following the exact pattern
`toCardWave.ts`/`hydrate.ts` already establish.

## Verifying against the live project

No dedicated `verify-live-echoes.ts` script yet (mirrors the gap noted for
`challenges` in earlier stages, not filled in here either) — spot-check
manually: Echo a Wave from its own page or a feed card, confirm the count
increments and survives a reload, un-echo, confirm it decrements, and check
that a Wave's creator receives an `echo` notification the first time (and
only the first time, per the standing grouping rule) someone new echoes it.
