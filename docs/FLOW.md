# Flow — the full-screen listening feed (founder decision, 6 Sept 2026)

The founder asked for the app to pull people in and keep them there, "like Reels". Flow is AKINTI's answer: a full-screen, one-Wave-per-screen vertical feed that plays continuously. It becomes the default screen after login (Home keeps the follow-only list as a tab or secondary route).

## Non-negotiables carried over
- Reactions are Replay, Save, Comment, Share, Echo (`docs/ECHOES.md`, added 2026-09-18) and Duet — Echo not yet wired into Flow's own card, see that doc's "Known gaps".
- First sound needs one gesture (browser rule); after that Flow plays continuously and advances on its own.
- No fake counts, no confetti, no badges. Retention comes from good next Waves, fast Duet, and honest "new for you" counts.
- Design: waterline is the visual; colour per COLOR_V2.md; no cards, no gradients, no purple.

## The screen (390×844 first)
- One Wave fills the viewport (100dvh, safe areas). Ground is tinted paper; the Wave's trace is drawn large and live: a `waterline` that reacts to the audio (analyser on the single global playback element) with linear motion; played part in Signal.
- Top: creator handle · title · one metadata line (mode/genre mark, duration in Martian Mono). Tap handle → profile.
- Right rail (thumb zone, largest targets): Replay, Save, Comment (opens sheet), Share, **Duet** (the hero action; open-for-Duet mark in Signal when the creator invites).
- Bottom: transport (play/pause largest target), scrub on the trace, "Up next" hairline strip showing the next trace faintly.
- Gestures: swipe up = next, swipe down = previous, double tap = Replay (never Like), long press = Save, tap = pause/play. Keyboard: ↑/↓, space.
- Auto-advance when a Wave ends (linear, no bounce). Prefetch signed URLs and peaks for the next 2 Waves; keep the previous one warm.
- Continuous playback: leaving Flow keeps the persistent player.

## Ranking (server RPC `get_flow_page(cursor, seed)`)
Session-seeded mix, keyset paginated, never repeats within a session:
1. Waves from followed creators not yet heard (newest first).
2. Answers to the viewer's Open Calls and Duets of their Waves.
3. Live challenge entries and curated Top 5.
4. Rising Waves (plays + replays + saves + duets in last 48h, decayed), diversified by creator and genre.
5. Backing-track and Open Call invitations every ~8th slot ("Sing over this").
Heard state is recorded server-side (existing play counting); "new for you" count = items in 1–3 unheard.

## Retention hooks (honest)
- "New for you" number on the Flow tab icon (never zero shown).
- Daily push digest (existing push infra): "3 new answers to your Open Call".
- After the viewer's first Duet: prompt to invite one friend (share card).
- Listening streak is NOT in scope (DESIGN §12 rule 35); revisit only with data.

## Engineering
- Route `src/app/(app)/flow/**`, components `src/components/flow/**`, helper `src/lib/db/flow.ts`, migration for `get_flow_page` and a `flow_impressions` table (user_id, wave_id, seen_at; RLS owner-only) to avoid repeats.
- Uses the single playback store; the big trace uses an `AnalyserNode` attached to the store's media element (create once, reuse).
- Virtualised: render current ±1 only. `next/dynamic` for the comment sheet and share sheet.
- Performance: first Wave server-rendered with peaks; audio starts on the first gesture; INP < 200 ms on swipe.
- Analytics: impressions, completes, skips (position), replays, saves, duet taps → existing metrics tables or a `flow_events` table.

## Implementation notes (as built, 6 Sept 2026)

**Data** (migration `20260906110000_flow.sql`): `flow_impressions(user_id, wave_id, seen_at, completed, skipped_at_ms)`, owner-only RLS, no client write path. `get_flow_page(p_cursor jsonb, p_seed int, p_limit int)` is SECURITY INVOKER — every table it reads already has RLS that resolves correctly for the caller, so it can never show more than the caller's own queries against those tables already would. Ranking, in bucket order:

1. Followed creators, unheard (`wave_listens`, the same "heard" definition Home's unheard mark uses), newest first.
2. Duets whose `parent_wave_id`'s creator is the viewer — a strict superset of "answers to my Open Calls", since `answer_open_call()` always produces a Duet of the Open Call's Wave.
3. Live-challenge entries, curated picks (rank 1-5) ranked ahead of plain entries.
4. Rising (48h, `wave_trending_score`), diversified by creator and genre via a round-robin re-rank (`greatest(rank within creator, rank within genre)`) — a best-effort spread, not a hard per-page guarantee for a pathological distribution (one creator owning every rising Wave).
5. An Open-Call/backing-track "invitation" spliced in at every 8th absolute session position, paginated independently by an `offset` derived from the cursor's `slot`. When the invitation pool is exhausted, that slot is omitted rather than repeating or fabricating one.

The keyset cursor is `(bucket, score, id, slot)`; diversification/interleaving only reorders *within* one fetched page, so the cursor always advances by exactly the underlying ranked stream's own order, never skipping or repeating a row across pages. `record_flow_event` (impression/complete/skip/replay) is rate-limited via `check_rate_limit`, action `'flow_event'`, 600/hour. Saves and Duet taps ride the existing `saves`/`duet_requests` write paths (with `emitAnalyticsEvent`), not `record_flow_event` — the RPC's kind enum is exactly the four kinds above.

**Screen**: `FlowScreen` is a `fixed inset-0 z-40` full-viewport takeover rendered from inside `(app)/layout.tsx`'s `{children}` — `AppShell`/the shared layout were out of this stage's ownership, so Flow covers the shell's chrome (top bar, keyboard nav, persistent player strip) from its own owned tree rather than by editing them. Swipe/wheel/tap/double-tap/long-press are unified on one Pointer Event handler at the track level; the trace's own drag (scrub) claims the gesture first and calls `stopPropagation` only once an actual drag (not a tap) is detected. `getFlowAnalyser`/`readFlowAmplitude` (`src/lib/audio/analyser.ts`) build one `AudioContext`/`MediaElementAudioSourceNode`/`AnalyserNode` graph the first time the playback store's `<audio>` element exists (after the first gesture) and reuse it — `createMediaElementSource` throws on a second call against the same element.

**Navigation**: Flow is first in `KEYBOARD_ITEMS`/`RAIL_ITEMS`; Home is second. The actual post-login landing page is decided in two places, not one — `src/lib/supabase/middleware.ts` (an already-signed-in visit to `/login`) and `src/app/(auth)/actions.ts`'s `signIn` Server Action (the real form submission every sign-in takes) — both now default to Flow instead of Home.

**Verified live** (`scripts/qa/flow-qa.mjs`, `docs/qa/flow/`): 19/20 checks against real seeded Waves on the live project, both 390×844 and 1280×800. One QA-only bug was found and fixed this pass: the swipe track's `translateY` used a percentage, which CSS resolves against the *track's own* height (up to 3x one screen, since it stacks up to 3 sections) rather than one section's height — every swipe overshot by up to 3x, which is what pushed the rail off-screen after the first navigation. Fixed by switching to `dvh` units.
