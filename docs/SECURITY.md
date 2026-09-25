# AKINTI — Security

Authorization is designed around the database, not the client (spec §32).
Every rule in this document is enforced in Postgres; the application layer
re-checks the same predicates for good error messages and to avoid needless
round-trips, but a policy hidden in the UI only is never treated as
enforcement anywhere in this codebase.

## Authentication (spec §8, §32)

Supabase Auth (email/password; OAuth-ready via `src/app/auth/callback/route.ts`),
sessions carried in cookies through `@supabase/ssr`. The signup trigger
(`handle_new_user`, migration 02) creates the `profiles` row synchronously, so
there is never a signed-in user with no profile.

**Server API — `src/lib/auth/server.ts`** (Server Components/Actions/Route
Handlers only; never imported from a client component):

- `getSession()` — the raw, cookie-trusting session. Fast, NOT verified —
  never use it for an authorization decision.
- `getCurrentUser()` — the signed-in user, verified against the auth server
  via `getUser()`. `null` when signed out **or when Supabase isn't
  configured** — every caller degrades to the signed-out UI rather than
  throwing (`isSupabaseConfigured()`, `src/lib/supabase/config.ts`).
- `getCurrentProfile()` / `getCurrentUserWithProfile()` — the above plus the
  mapped `profiles` row.
- `requireUser(nextPath?)` — redirects to `/login?next=<nextPath>` if signed
  out; otherwise returns the verified user.
- `requireOnboarded(nextPath?)` — `requireUser` plus a redirect to
  `/onboarding` if `profiles.onboarded_at` is still null. `/onboarding` itself
  must never call this (it would redirect to itself).

**Client API — `src/lib/auth/AuthProvider.tsx`**: `<AuthProvider>` (mounted
once in `src/app/providers.tsx`, hydrated from `getCurrentUserWithProfile()`
in the root layout so first paint never flashes signed-out) and
`useCurrentUser()`, kept live via `supabase.auth.onAuthStateChange`.

**Server Actions — `src/app/(auth)/actions.ts`** (`signUp`, `signIn`,
`signOut`, `requestPasswordReset`, `updatePassword`) and
**`src/app/(auth)/onboarding/actions.ts`** (`completeOnboarding`,
`followSuggestedCreator`) never throw to the client — every action returns
`{ ok, fieldErrors?, formError?, message? }` (`src/lib/auth/types.ts`).
Supabase Auth error codes are translated to English by `mapAuthError`
(`src/lib/auth/errors.ts`) — a raw Supabase/Postgres error string is never
forwarded to a form.

### Route protection matrix

Enforced twice: `src/proxy.ts` (via `updateSession`,
`src/lib/supabase/middleware.ts`) redirects as a UX convenience at the edge;
every protected Server Component independently calls
`requireUser`/`requireOnboarded` as defense-in-depth. **Neither is the
authorization boundary** — that is Postgres RLS, below. Public routes are the
single list in `isPublicRoute` (`src/config/routes.ts`); everything else is
protected.

| Visitor state | Public route (`/explore`, `/w/[id]`, `/u/[username]`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/*`, `/kit`) | Protected route (`/`, `/create`, `/messages*`, `/notifications`, `/settings*`) |
|---|---|---|
| Anonymous | renders normally | → `/login?next=<path>` |
| Signed in, not onboarded | renders normally | → `/onboarding` (except `/onboarding` itself) |
| Signed in, onboarded | renders normally | renders normally |
| Signed in, visiting `/login` or `/signup` | — | → `/` (checked before the public-route rule) |

Onboarding is skippable at every step (spec §8) — "not onboarded" only means
`profiles.onboarded_at is null`; the onboarding wizard's global "Skip for
now" always finishes it (sets `onboarded_at`, possibly with defaults) rather
than leaving a dead end a user could get stuck behind.

### Password reset / email confirmation

Both flows share `src/app/auth/callback/route.ts` (PKCE code exchange,
allow-listed in `supabase/config.toml`'s `additional_redirect_urls`):
`requestPasswordReset` points `redirectTo` at
`/auth/callback?next=/reset-password`; `signUp`'s `emailRedirectTo` points at
`/auth/callback?next=/onboarding`. A failed/expired exchange redirects to
`/login?error=callback_failed` rather than rendering a raw error. `next` is
always sanitized to a same-origin relative path (`sanitizeNextPath`) before
being used in a redirect, to rule out an open-redirect via a crafted `next`
value.

### Never a fake login (spec §44 rule 9)

`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are unset in this
environment (`AGENTS.md`). Every auth surface checks `isSupabaseConfigured()`
first and renders an explicit "Backend not configured" state — sign-in,
sign-up, password reset and onboarding never simulate success, and
`getCurrentUser()`/`getSession()` return `null` rather than throwing so the
rest of the app degrades to its normal signed-out UI instead of crashing.

## Authorization model

**Single source of truth: the predicate functions in migration 10**
(`can_view_wave`, `can_comment_on_wave`, `can_request_duet`,
`can_view_audio_asset`, `can_view_profile`, `can_view_profile_content`,
`is_following`, `are_mutual_followers`, `is_blocked_between`,
`audience_allows`, `can_message`, `is_conversation_member`). Both RLS
policies (migration 12) and `src/lib/db/**` call these — never a hand-rolled
equivalent — so the database and the application can never quietly drift
apart on who can see what.

`can_view_wave(wave_id)` is the load-bearing one: soft-delete, creator
self-access, blocks, accepted-collaborator credit, per-Wave visibility, and
the creator's profile privacy all fold into one boolean. Everything else
(comments, saves, shares, audio asset access, search results) is only
reachable through a Wave that already passed this check.

## Row Level Security

**RLS is enabled on every table in `public`. A table with no policy for an
operation denies that operation by default** — there is no table anywhere
in this schema that a signed-in user can read or write without an explicit
policy backing it. Highlights:

- `profiles_select` uses `can_view_profile` (identity card — username,
  avatar — visible unless blocked, so a private account can still be found
  and follow-requested); the account's *content* (Waves, follower list) goes
  through the stricter `can_view_profile_content`.
- `waves_select`/`comments_select`/`audio_assets_select` all key off
  `can_view_wave`/`can_view_audio_asset` — a private Wave is unreachable via
  guessed IDs, the feed/search RPCs, or a share link, because every one of
  those read paths is still filtered by the same RLS policy underneath.
  `challenge_entries_select`/`challenge_picks_select` (migration 36,
  `20260905150000_challenge_entries_visibility.sql`) key off `can_view_wave`
  the same way — entering a Wave into a live challenge never widens who can
  see it, matching "sharing a Wave into a conversation never widens its
  visibility" below.
- `saves` has no policy letting anyone but the saver read their own saves —
  Saves are private; only the aggregate `waves.save_count` is public.
- `play_events`/`wave_listens` have **no client write policy at all**. The
  only way to affect them is `record_play_event()` (SECURITY DEFINER),
  which is itself server-authoritative about what counts as a Play/Replay.
- `notifications` has no client INSERT policy — the only writer is
  `push_notification()`, called from triggers.

## Write guards (server-owned columns)

RLS controls *whether* a row is writable; **BEFORE triggers control *which
columns* survive the write**, for anything a client must never forge:

- `waves_guard_insert`/`waves_guard_update` — force counters
  (`play_count`, ...) to `0`/unchanged, verify the audio asset belongs to
  the claimed creator, and independently re-verify a Duet's parent request
  before letting `creation_type = 'duet'` through.
- `audio_assets_guard_update` — rejects any client attempt to touch
  `processed_path`, `peaks`, `processing_status`, `processing_error`,
  `processed_at`, `owner_id`, `original_path`, `storage_bucket`,
  `byte_size`, `checksum_sha256`. Only the worker (flagged via
  `is_service_request()`) may set these.
- `duet_requests_guard` — the whole state machine from `DUET_SPEC.md`, plus
  forcing `recipient_id` to the Wave's actual creator regardless of what a
  client sends.
- `messages_guard_insert` — re-checks blocks between every conversation
  member and the sender on every send, even though the sender already
  passed `is_conversation_member` at the RLS layer.
- `reports_guard` — a client-submitted report is always forced to `status =
  'open'` with no reviewer/resolution fields; only `is_service_request()`
  (moderation tooling using the admin client) may set a verdict.

`is_service_request()` (migration 01) is what these guards check to allow
themselves through for legitimate server-side writes — true when the JWT
role claim is `service_role`, or inside a `SECURITY DEFINER` routine that
explicitly flags itself via `set_config('akinti.system', 'on', true)` (used
by `complete_audio_job`/`fail_audio_job` so they can update `audio_assets`'
guarded columns without being the service role client themselves).

## Storage security (spec §33)

Two buckets only:

- **`audio` — PRIVATE.** No listener SELECT policy on `storage.objects` at
  all; only the object's owner can sign their own file directly. Every other
  listener gets audio exclusively through `mintSignedAudioUrl`/
  `mintPlaybackUrl` (`src/lib/db/audioAssets.ts`): the caller's RLS-scoped
  client authorizes via `can_view_audio_asset` first, then the **admin
  (service-role) client** mints a 10-minute signed URL. Raw storage paths
  are never sent to the browser outside that flow. Full detail:
  `AUDIO_ARCHITECTURE.md`.
- **`avatars` — PUBLIC.** The one public image surface (profile pictures
  only — spec §3.2 bans image posts). World-readable, owner-writable, keyed
  `avatars/<owner_id>/<filename>`.

Object key convention for both buckets: **the first path segment is always
the owner's `auth.uid()`**, which is exactly what every storage policy keys
off (`(storage.foldername(name))[1] = auth.uid()::text`).

## Blocking (spec §26)

`blocks` is directional in storage, symmetric in effect —
`is_blocked_between(a, b)` is what every other check calls, never a raw
`blocks` row lookup. Blocking a user immediately (via
`blocks_after_insert`, migration 12):

- Deletes any `follows` row between the two accounts, either direction.
- Cancels any `PENDING` `duet_requests` between them, either direction.
- `can_view_wave`, `can_view_profile*`, `can_message`, `can_comment_on_wave`,
  `can_request_duet` all short-circuit to deny once a block exists — a
  blocked user cannot bypass this through a direct API call, a cached
  response, or a different route into the same data (spec §26/§46).

A blocked account is never told it blocked them: `blocks` has no SELECT
policy exposing the reverse direction.

## Abuse prevention (spec §39, Stage 12)

Implemented at the database level:

- **Play/Replay debounce** — duplicate raw events from the same listener
  within 5 seconds are dropped (`record_play_event`); self-plays by the
  creator never count. Deliberately NOT covered by the rate limiter below —
  it already has its own, more precise abuse control.
- **Duplicate Duet requests** — one live `PENDING` request per `(wave,
  requester)`, enforced by a unique partial index, not just app logic.
- **Duplicate reports** — one open report per `(reporter, target)`, per
  target type, enforced the same way.
- **Comment/message abuse surfaces** — routed through `can_comment_on_wave`/
  `can_message`, both of which respect blocks and per-account permission
  settings before a row can be inserted at all.
- **Per-account rate limits** (migration 21,
  `20260903140200_rate_limits.sql`) — a generic `check_rate_limit(profile_id,
  action, max_count, window)` SECURITY DEFINER function backed by an
  append-only `rate_limit_events` ledger, called from a `BEFORE INSERT`
  guard trigger on every rate-limited table (mirroring `messages_guard_insert`
  and every other write guard — enforcement lives in the database, not
  application code, so a direct API call cannot bypass it). Each guard
  records exactly one event per accepted insert via
  `record_rate_limit_event`, after every threshold for that action has
  already passed; `is_service_request()` exempts trusted server-side writes.
  `rate_limit_events` has no client-facing RLS policy at all — the only
  access is through these SECURITY DEFINER functions.

  | Action | Table | Limit(s) |
  |---|---|---|
  | `comment` | `comments` | 10/minute, 200/day per author |
  | `follow` | `follows` | 30/minute per follower |
  | `message` | `messages` | 60/minute per sender |
  | `duet_request` | `duet_requests` | 10/hour per requester |
  | `share` | `shares` | 30/minute per sharer |
  | `report` | `reports` | 20/day per reporter |
  | `audio_upload` | `audio_assets` | 10/hour per owner (covers Wave uploads, recordings and message-audio registrations alike) |
  | `challenge_entry` | `challenge_entries` | 10/hour per user (`challenge_entries_guard`, migration `20260905130000_challenges.sql`; SQLSTATE `AKRTL`, same mapping as every other row here — see `docs/CHALLENGES.md`) |

  These are conservative starting numbers (spec §39: "start conservative"),
  chosen without production usage data — revisit once real traffic exists.
  `prune_rate_limit_events(interval)` (service-role only) deletes ledger rows
  older than the interval given (default 2 days, safely past the widest
  1-day window above); nothing calls it automatically today — wire it into
  `scripts/worker.ts` or a `pg_cron` job when one exists.

  **Error mapping:** every guard raises SQLSTATE `AKRTL` (a code this
  project owns; Postgres never assigns it). `src/lib/moderation/errors.ts`
  (`isRateLimitError`, `mapModerationError`) is the one place that recognises
  it and maps it to *"You're doing that too often. Try again in a few
  minutes."* instead of a raw Postgres message reaching a form. Adopted by
  `src/app/(app)/moderation/actions.ts` today; the natural remaining call
  sites are `src/app/(app)/w/[id]/interactions.ts` (comments/shares),
  `src/app/(app)/messages/actions.ts`, the follow action, and the Duet
  request action module — none owned by this stage, flagged here for their
  owners to adopt.

## Notification preferences (spec §23, §25, Stage 12)

`profiles.notification_preferences` (migration 22, jsonb, default `{}`) —
keys `message | duet | comment | follower | system`, each an optional
boolean; a missing key means "on" (the pre-migration behavior, so existing
accounts are unaffected). Validated twice: `profiles_notification_preferences_valid`
(a CHECK constraint calling `is_valid_notification_preferences`, rejecting
any other key or a non-boolean value) at the database layer, and
`notificationPreferencesSchema` (`src/lib/validation/moderation.ts`, `.strict()`)
at the application layer for an honest client-side error before the request
even reaches Postgres.

**Enforcement lives in exactly one place:** `push_notification()` (migration
08, updated in migration 22) — the single write path for every notification
— calls `notification_category(p_type)` to map the type to one of the five
keys (or `null` for `save`/`share`, which are not gated by any preference and
always deliver, since spec §25 doesn't list a Saves/Shares toggle) and skips
the insert when the recipient has that category explicitly turned off. RLS
and application code never need their own copy of this rule.

## Moderation (spec §26, Stage 12)

**Report states** (`report_status`, migration 01) — `open → reviewing →
actioned | dismissed`. This already matched the spec's shape 1:1 (`reviewing`
~ "under review", `actioned` ~ "resolved"); no enum change was needed.
`claim_report(report_id)` optionally moves `open → reviewing` (a "someone is
on this" UI nicety — `resolve_report`/`dismiss_report` don't require a prior
claim, they can act directly from `open`).

**Moderator flag, not a table.** `profiles.is_moderator boolean default
false` (migration 23) — a single bit of information, no per-moderator scope
tiers in v1, checkable from a RLS `using` clause without a join via
`is_moderator(profile_id default auth.uid())`. No self-service path exists
anywhere in this schema to become a moderator; promote/demote by hand
(Supabase SQL editor or a future internal tool). `profiles.suspended_until`
(also migration 23) is the second server-owned column added alongside it.
Both are protected from the account owner by
`profiles_guard_moderation_columns` (a `BEFORE UPDATE` guard mirroring
`audio_assets_guard_update`'s shape) even though `profiles_update_own` RLS
has no column-level restriction of its own — the guard forces both columns
back to their prior value unless the write is flagged `is_service_request()`,
which `resolve_report` does via `set_config('akinti.system', 'on', true)`,
exactly like `complete_audio_job` does for `audio_assets`.

**`resolve_report(report_id, action, note?, suspend_until?)`** — moderator
only (re-checked server-side via `is_moderator()`, independent of any
app-layer gate). Never called automatically on a single report (spec §26).
v1 actions:

| Action | Effect |
|---|---|
| `none` | Reviewed, no action taken |
| `hide_wave` | Sets `waves.hidden_at` (migration 23) — invisible to everyone but the creator and moderators (`can_view_wave`, updated in migration 23); still counts toward `wave_count`, distinct from a soft delete |
| `hide_comment` | Sets `comments.deleted_at` — reuses the creator's own soft-delete path rather than a second "hidden" column, since the visibility effect a moderator wants is identical |
| `warn_user` | Sends a `system`-type notification to the resolved target account (via `push_notification`) |
| `suspend_user` | Sets `profiles.suspended_until` (default 7 days from now, or `suspend_until` if given) on the resolved target account |

For `warn_user`/`suspend_user`, the "target account" is resolved from
whichever of the report's four target columns is set: the reported profile
directly, or the author/creator/sender of the reported comment/Wave/message.
`dismiss_report(report_id, note?)` closes a report with no action, logged as
`moderation_actions.action = 'none'` — distinct from `resolve_report(...,
'none')` only in the resulting status (`dismissed` vs `actioned`), so the
audit trail can tell "reviewed, nothing to do" apart from "reviewed,
explicitly decided no action was warranted".

**`moderation_actions`** — append-only audit trail, one row per
resolve/dismiss call (`report_id`, `moderator_id`, `action`, `note`,
`created_at`). RLS: `select` only, gated by `is_moderator()`; there is no
insert/update/delete policy for `authenticated` at all — the only writer is
`resolve_report`/`dismiss_report` (SECURITY DEFINER, bypasses RLS the same
way `push_notification` already does for `notifications`).

**`/moderation` route protection.** Moderators only; everyone else gets a
`notFound()` (404), not a 403 — the route's existence isn't itself
information. This is UX, not the authorization boundary: `reports_select_moderator`/
`moderation_actions_select_moderator` RLS (keyed off `is_moderator()`)
already return nothing for a non-moderator regardless of what the page does,
so a route-matcher gap leaks nothing.

**Suspension enforcement.** `requireUser()` (`src/lib/auth/server.ts`) — the
one call site every protected page already routes through — checks
`profiles.suspended_until` after confirming a session and redirects an
actively-suspended account to `/suspended` instead of the page it asked for.
`/suspended` itself reads `getCurrentUser()` directly rather than
`requireUser`/`requireOnboarded`, to avoid an immediate redirect loop back to
itself; it's also in `isPublicRoute`'s allowlist so the proxy's own
onboarding gate doesn't bounce a suspended-and-not-onboarded account between
`/suspended` and `/onboarding`. A signed-in visitor whose suspension has
since expired (or who navigates there without ever having been suspended) is
redirected home instead of shown a stale message.

## Security fixes landed in Stage 12 (unrelated to the deliverables above)

Found during this stage's review pass, fixed in the same migration set:

- **`audio_assets` removed from the `supabase_realtime` publication**
  (migration 19, `20260903140000_realtime_audio_assets_security_fix.sql`).
  Supabase Realtime's `postgres_changes` protocol broadcasts the *entire*
  row to any subscriber, ignoring column-level `GRANT`s — so `audio_assets`
  being in the publication (migration 16) leaked `original_path`/
  `processed_path` (deliberately locked out of ordinary reads by migration
  15, spec §33) to anyone who could see the row via `audio_assets_select`.
  Confirmed unused: grepping `src/` for `postgres_changes` shows only
  `notifications` and `messages` channels are ever opened;
  `ProcessingBanner.tsx` polls `processing_status` instead.
- **`rising_creators()` made `SECURITY DEFINER`** (migration 20,
  `20260903140100_rising_creators_security_definer.sql`). It read
  `public.follows` with invoker rights, so `follows_select` RLS silently
  narrowed its `recent_followers` aggregate per viewer instead of producing
  one deterministic Explore → Rising ranking (spec §10). Fixed the same way
  every predicate in migration 10 is; the output is still filtered through
  `can_view_profile(p.id)` so blocking/visibility rules hold on what comes
  back, only the internal aggregate stopped being viewer-dependent.
- **`waves.comment_permission`/`profiles.comment_permission` narrowed to a
  `CommentAudience` type** (`"everyone" | "followers" | "nobody"`, excluding
  `"following"`) in `src/types/database.ts`/`src/types/domain.ts` — both
  columns are `permission_audience` narrowed by a CHECK constraint that
  already excluded `'following'` (`profiles_comment_permission_values`,
  migration 02; `waves_comment_permission_values`, migration 04), which the
  TypeScript types didn't reflect. The Zod schemas already validated this
  correctly (`COMMENT_AUDIENCES` in `src/lib/validation/{profiles,waves}.ts`);
  this closes the gap at the type layer too.

## Secrets

`SUPABASE_SERVICE_ROLE_KEY` is read only in `src/lib/supabase/admin.ts`
(`requireServiceRoleKey()`), which throws if called from `typeof window !==
"undefined"`. It is never inlined into client bundles — only
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are meant to reach
the browser (RLS is what protects data behind the anon key, not secrecy of
the key itself). `.env.local` is git-ignored; `.env.example` documents the
three variables with empty values.

**AKINTI Pro billing (Wave F, docs/BILLING.md):** `IYZICO_API_KEY`/
`IYZICO_SECRET_KEY`/`IYZICO_MERCHANT_ID` and `PADDLE_API_KEY`/
`PADDLE_WEBHOOK_SECRET` are read only inside `src/lib/billing/{iyzico,paddle}.ts`,
both of which are `import "server-only"` modules, and never returned to a
client — a Server Action or webhook route calls them, never a Client
Component. `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` is the one intentionally public
exception (Paddle's own client-side checkout token, meant to ship to the
browser, same trust model as the Supabase anon key). No provider secret is
ever logged: every error path in `src/lib/billing/**` surfaces a
`BillingProviderError` message, never the raw request/response a provider
SDK call failed with.

## No Likes (spec §3.4) — verified, not assumed

There is still no `likes` table, column, enum value, RLS policy, RPC, or
notification type anywhere in `supabase/migrations/`, `src/types/database.ts`,
or `src/lib/db/**`, and there never will be — a Like-shaped feature was
exactly what this section warned about, and it arrived: **Echoes**
("Yankı"), a deliberate, founder-approved 2026-09-18 spec change, not a
quiet add-on. It lives in its own `echoes` table with its own
`echo_count`/notification type, see `docs/ECHOES.md` for the full shape and
the reasoning. If a future change proposes yet another Like-shaped or
gamification-adjacent feature beyond Echo, the same rule still applies: flag
it to the product owner rather than building it quietly.

## Profiles & privacy (spec §21, §25, §26 — Stage 3)

Who can see what on a profile is two separate questions with two separate
predicates (migration 10), and the UI/app layer never conflates them:

- **Identity card** (`can_view_profile`): avatar, username, display name.
  Visible to anyone **unless a block exists in either direction** — a
  private account is still findable and follow-requestable, since hiding
  the identity card entirely would make private accounts undiscoverable.
- **Content** (`can_view_profile_content`): Waves, Duets, follower/following
  lists. Visible to the owner, to everyone if the account is public, and to
  an **accepted** follower if it's private. `/u/[username]` (the profile
  page), `/u/[username]/followers` and `/u/[username]/following` all check
  this before rendering a list — the app-layer `canViewProfileContent`
  wrapper (`src/lib/db/profiles.ts`) calls the same RPC RLS uses, so a page
  can never show a locked list that a direct query would have hidden.

| Viewer | Public profile | Private profile, not following | Private profile, accepted follower | Blocked (either direction) |
|---|---|---|---|---|
| Identity card | visible | visible | visible | **hidden** — indistinguishable from "doesn't exist" |
| Waves / Duets tabs | visible | locked (`LockedContent`) | visible | n/a (identity already hidden) |
| Follower / following lists | visible | locked | visible | n/a |
| Follow | Follow → accepted | Follow → **pending** request | already following | denied server-side (`follows_insert`) |

**Blocked-either-way is a 404, not an error.** Because `can_view_profile`
folds both directions of `is_blocked_between` into one check,
`getProfileByUsername` simply returns `null` for a blocked account — the
profile page renders the same "Profile unavailable" empty state it would
for a username that never existed (`src/app/(app)/u/[username]/page.tsx`).
This is deliberate: confirming "this account exists but blocked you" is
itself a leak.

**A blocker's own blocked-list is the one place identity-card visibility is
intentionally bypassed**, and only for the blocker looking at their own
list: `blocks_select_own` RLS already proves the caller may know these ids
are blocked (`blocker_id = auth.uid()`); `listBlockedProfilesWithIdentity`
(`src/lib/db/blocks.ts`) then uses the admin client *only* to fetch basic
identity for ids that read already authorized, never to discover a block
relationship the caller didn't already have. `can_view_profile` special-casing
"viewer is the blocker" would remove the need for this and is flagged to the
schema owner as a follow-up (out of scope for this stage — no migration was
written for it here).

**Follow requests.** `follows_before_insert` (migration 12) decides
`pending` vs `accepted` server-side purely from the target's `privacy`
column — the client never sets `status`. Accepting/declining
(`respondToFollowRequest`) is restricted to the followee by
`follows_update`'s `using (followee_id = auth.uid())`; cancelling a
still-pending request is just `unfollowProfile` (delete), allowed to either
party by `follows_delete`.

**Appearance is a closed set of presets, not a color field**
(`src/lib/ui/profileTheme.ts`): every background/accent pairing is run
through the same WCAG AA contrast check (`meetsAA`, ≥4.5:1) the theme
module's own tests assert for every enum value, so there is no
theme-configuration path that can ship unreadable text. Gradients and
patterns are decorative overlays on the banner strip only — no product copy
is ever rendered directly on top of one.

**Reports** filed against a profile (`submitProfileReport`,
`src/app/(app)/u/[username]/actions.ts`) go through the same `reports`
table and `reports_guard` trigger as every other report target: always
inserted `status = 'open'`, never auto-actioned, resolution fields
forced to `null` for a client-submitted insert.

## Messaging privacy (spec §14, §22, §26 — Stage 10)

Who can message whom is one predicate, checked on every write, not just at
"start a conversation" time: **`can_message(target)`** (migration 10) is
`false` whenever the caller and target are the same account, a block exists
in either direction (`is_blocked_between`), or the target's
`profiles.message_permission` (everyone / followers / people I follow /
nobody) doesn't admit the caller. `startConversation`
(`src/app/(app)/messages/actions.ts`) checks it for an honest UI error;
`get_or_create_direct_conversation` (migration 10) re-checks it unconditionally
before opening/reusing a thread; `messages_guard_insert` (migration 12)
re-checks blocks between the sender and every other member on **every single
message send**, not only the first — so a message permission tightened or a
block placed mid-conversation takes effect immediately, even if the two
already share a thread.

**Blocking a conversation, not deleting it.** Blocking severs `follows` and
cancels pending `duet_requests` (see "Blocking" above) but does **not**
delete `conversations`/`conversation_members`/`messages` rows. A
blocked-either-way thread still opens — the app shows "You can't reply to
this conversation" and disables the composer client-side, and
`messages_guard_insert` denies the insert server-side regardless, so a direct
API call cannot bypass the disabled button. The other member's identity
(avatar/username) still needs to render in that now-locked thread even though
`can_view_profile` hides it symmetrically once blocked; `resolveOtherProfile`
(`src/app/(app)/messages/[id]/page.tsx`) falls back to the admin client for
that one lookup, on the same reasoning as `listBlockedProfilesWithIdentity`
(`src/lib/db/blocks.ts`): the viewer is already provably a member of this
exact conversation (RLS `is_conversation_member` gated the read that got them
here), so this supplies identity for an id they're already authorized to
know about — it never discovers a block relationship or a wider profile they
didn't already have access to.

**Audio messages are private, never Waves** (spec §22). They carry no title,
no visibility setting, no comment/duet permissions, and are excluded from
every feed/Explore/search query by construction (those all query `waves`,
which an audio message never touches). Access to the underlying
`audio_assets` row is granted by `can_view_audio_asset` (migration 10) two
ways: the asset's owner, or a member of a conversation containing a message
that references it — so a recipient can play a voice message but a stranger
who guesses the asset id cannot. Message audio never runs the Wave
enhancement/processing pipeline (`createMessageAudioTicket`/
`finalizeMessageAudio` mark the asset `ready` directly after a server-side
magic-byte check, the same check `finalizeUpload` uses for Waves) — no
enqueued job means no code path that could accidentally attach message audio
to a Wave or a public waveform.

**Sharing a Wave into a conversation never widens its visibility** (spec
§14). `shareWaveToConversation` re-checks `can_view_wave` before inserting
the `wave_share` message, and the message itself only stores the Wave's id —
the recipient's own `/w/[id]` visit re-runs `can_view_wave` from scratch. A
Wave made private after being shared stops rendering in the message card
(`WaveShareCard` shows "not available") for anyone who wasn't already
independently authorized to see it.

**Reporting a message** (spec §26) goes through the same `reports` table and
`reports_guard` trigger as every other target type — always filed `open`,
never auto-actioned, resolution fields forced to `null` on a client insert.

## Security test scenarios to keep passing (spec §46)

```
Private Wave, direct API access by a non-follower           → ACCESS DENIED
Private Wave, direct storage URL guess                       → ACCESS DENIED (no listener storage policy)
Private Wave, reached via a share link                       → still gated by can_view_wave
Private Wave, reached via search/Explore/Home feed queries   → never appears (RLS-filtered)
Blocked user attempts to message/comment/duet-request         → DENIED, in both directions
Blocked user attempts a direct API call bypassing the UI      → DENIED (RLS + guard triggers, not just hidden buttons)
Private profile, viewer not an accepted follower               → identity card visible, Waves/followers locked
Blocked account (either direction), profile page visited       → "Profile unavailable", same as a nonexistent username
Follow request to a private account                            → status starts `pending`, never client-settable
Non-followee attempts to accept/decline a follow request        → DENIED (`follows_update` RLS)
Blocked user sends a message via direct API call, bypassing UI → DENIED (`messages_guard_insert`, even in an existing thread)
Audio message asset id guessed by a non-member                 → ACCESS DENIED (`can_view_audio_asset`)
Wave made private after being shared into a conversation       → message card no longer resolves it, `/w/[id]` denies directly
Private/hidden/blocked-creator Wave entered into a live challenge → challenge_entries/challenge_picks row ACCESS DENIED to anon and to any other viewer (owner/moderator still see it)
```

## Audit 2026-09-04 (Stage 14 — security & performance audit)

Scope: spec §32–§35, §38, §39, §43 Stage 14, §47. Everything below was found
and fixed in this pass unless marked "reported" (owned by another stage/file
this agent doesn't touch).

### 1. `mapModerationError` adoption (spec §39) — fixed

The rate-limit guard (`AKRTL`, migration 21) was only mapped to the honest
"You're doing that too often…" copy in `src/app/(app)/moderation/actions.ts`.
Every other Server Action that inserts into a rate-limited table was letting
the raw guard rejection fall through to a generic "Something went wrong"
message instead. Adopted `mapModerationError`/`isRateLimitError` in:

- `src/app/(app)/w/[id]/interactions.ts` — `createComment`, `saveWave`,
  `unsaveWave`, `recordShare` (via the shared `describeError` helper) and
  `reportComment` (its own catch, since it doesn't call `describeError`).
- `src/app/(app)/messages/actions.ts` — every mutation that goes through
  `sendMessage`/`createAudioAsset` (via `describeError`) and `reportMessage`.
- `src/app/(app)/u/[username]/actions.ts` — `follow`, `submitProfileReport`.
- `src/app/(app)/w/[id]/duet/actions.ts` — `requestDuet` (`duet_requests`
  insert, the one rate-limited table this file writes to).
- `src/app/(app)/create/actions.ts` — `createUploadTicket` (`audio_assets`
  insert, via `describeError`).

`reports` (20/day) was not explicitly listed in the Stage 14 brief but is
rate-limited per the table above and had the exact same bug (a raw `AKRTL`
falling through to a generic message) in three report-filing actions —
fixed alongside the listed tables rather than left half-done.

### 2. `GET /api/audio/[assetId]/url` — reviewed, one gap reported to another owner

Confirmed already compliant: constant `404` on every authorization failure
(never `403`), `Cache-Control: private, no-store` on every response, a
10-minute signed-URL TTL (`SIGNED_AUDIO_URL_TTL_SECONDS`), and a UUID-shaped
`assetId` rejected before touching the database. No per-request DB write
happens before the `can_view_audio_asset` check, so there's no cheap way to
add a useful in-process throttle here — Vercel serverless instances don't
share memory, so an in-memory counter would be trivially bypassed by load
balancing across instances, and a DB-backed throttle would add a write (and
therefore latency and its own row growth) to the hottest read path in the
app (every play, on every card). **Recommendation, not implemented:** rate
limit this route at the edge/CDN (Vercel's WAF rate-limiting rules, or a
shared Redis/Upstash token bucket keyed by `auth.uid()` or IP) rather than
in application code — the same conclusion a reasonable reviewer would reach
for any high-frequency, low-mutation read endpoint.

**Separate, more urgent bug found, reported, and fixed by the `routes.ts`
owner during this pass:** `src/config/routes.ts#isPublicRoute` had no
`/api/` entry, and `src/proxy.ts`'s matcher doesn't exclude `/api/*` either.
`updateSession()` (`src/lib/supabase/middleware.ts`) therefore treated `GET
/api/audio/[assetId]/url` as a *protected* route — for an anonymous visitor,
`!userId && !isPublicRoute(pathname)` was true and the proxy 307-redirected
the request to `/login` instead of letting the route handler answer. Since
this route is the *only* way any browser ever gets a playable audio URL,
including for fully public (`visibility = 'everyone'`) Waves an anonymous
visitor is allowed to browse from `/explore`/`/w/[id]`, the practical effect
was: **a signed-out visitor could browse the app but every play attempt
failed** (the fetch followed the redirect, got the login page's HTML instead
of JSON, and `WaveCardContainer` showed "This Wave's audio could not be
loaded"). Signed-in users were unaffected (the redirect branch only fires
when there is no session). Fixed in `src/config/routes.ts` — `"/api/"` was
added to `PUBLIC_ROUTE_PREFIXES`, with a comment noting Route Handlers do
their own auth/authorization and must never receive an HTML redirect in
place of their documented JSON/404 contract.

### 3. Suspension enforcement on Server Actions (spec §26, §32) — fixed, real gap

`requireUser()` (`src/lib/auth/server.ts`) already redirected an actively
suspended account to `/suspended` — but only when called, and every
protected **page** calls it, while every **Server Action** in this codebase
calls `getCurrentUser()` directly instead (never `requireUser`, since a
`redirect()` thrown from inside a Server Action is a poor fit for this
codebase's `{ ok, error }` contract). Net effect: a suspended account could
still comment, message, follow, block/unblock, request a Duet, respond to a
Duet Request, upload/publish a Wave, and edit/delete a Wave — every mutation
surface — via a tab left open from before the suspension took effect, or a
direct call bypassing the UI entirely. This is exactly the "blocked user
attempts a direct API call bypassing the UI → DENIED" standard the table
above already holds blocking to; suspension had no equivalent.

**Fix:** `assertNotSuspended(userId): Promise<boolean>` added to
`src/lib/auth/server.ts` (returns `true` when the account may proceed), with
`SUSPENDED_ACTION_MESSAGE` as the one piece of copy every caller shows. Wired
into every mutating Server Action module: `src/app/(app)/w/[id]/interactions.ts`,
`src/app/(app)/messages/actions.ts`, `src/app/(app)/u/[username]/actions.ts`
(inside its existing `requireSignedInUser` helper), `src/app/(app)/duets/actions.ts`,
`src/app/(app)/w/[id]/duet/actions.ts`, `src/app/(app)/w/[id]/actions.ts`,
`src/app/(app)/create/actions.ts`, `src/app/(app)/create/duetActions.ts`. In
`interactions.ts`/`messages/actions.ts` this is applied uniformly through
each file's shared `requireSignedIn()` helper — including the handful of
read-only actions in `messages/actions.ts` (`loadOlderMessages`,
`loadMoreConversations`, `getSharedWaveCard`, `getDuetRequestCard`). That is
a deliberate, slightly broader-than-the-minimum choice: a suspended
account's session reaching these Server Actions at all only happens via a
stale tab or a direct bypass (a fresh page load already redirects to
`/suspended` before any of these mount), so treating the whole surface as
denied is consistent with — not more restrictive in any practical sense
than — the existing page-level redirect, and it is far simpler to reason
about than trying to split "reads still work, writes don't" per action.

### 4. Ownership checks / admin-client ordering (spec §32, §33) — reviewed, no gap found

Audited every mutating Server Action for an ownership check before
update/delete, and every `createAdminClient()` call site in `src/` for
"authorize with the RLS-scoped client first, only then use the admin
client" ordering:

- Wave edit/delete (`w/[id]/actions.ts`) — `wave.creatorId !== user.id`
  checked before either `updateWave` or the admin-client storage cleanup in
  `deleteWaveDetails`.
- Comment delete (`interactions.ts`) — author OR the Wave's creator, checked
  before `deleteCommentDb`.
- Duet Request accept/decline/cancel — `recipientId`/`requesterId` checked
  before the row transition, with `duet_requests_guard` (migration 12) as
  the real, independent backstop regardless of what the app layer believes.
- `finalizeUpload`/`finalizeMessageAudio`/`publishWave`/`publishDuetWave` —
  `asset.ownerId !== user.id` checked before any admin-client read of the
  asset's storage paths.
- `settings/safety/page.tsx` (`listBlockedProfilesWithIdentity`) and
  `messages/[id]/page.tsx` (`resolveOtherProfile`) — both use the admin
  client only to fetch *identity* for ids an RLS-scoped read already proved
  the caller may know about (their own `blocks` rows; a conversation they're
  already a member of) — matches this file's existing documented reasoning
  for both, not a new pattern.
- `moderation/page.tsx` — `isModerator(db)` checked (with `notFound()` on
  failure) before the admin-client-backed `getReportDetail` call.

No client component (`"use client"`) imports `createAdminClient`,
`@/lib/supabase/admin`, or anything from `src/lib/db` that requires the
admin client — grepped every `"use client"` file in `src/` for `admin`
imports; all ten `createAdminClient` call sites in the repo are
Server Actions, Server Components, or the one Route Handler.

**Minor, non-exploitable finding, not fixed:** `src/lib/supabase/server.ts`
exports a second, unrelated `getCurrentUser`/`requireCurrentUser` pair that
is never imported anywhere (every real call site uses
`src/lib/auth/server.ts`'s version, which is also where the suspension logic
above lives). Dead code, not a vulnerability — flagged since two
same-named auth helpers in different modules is exactly the kind of thing
that causes a future accidental wrong-import.

### 5. `src/proxy.ts` / cookies / client-side secret leakage (spec §32) — reviewed

- Matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and every
  static asset extension (images, fonts, `css`/`js`/`map`, and the audio
  extensions) — confirmed appropriate; the one gap found (`/api/*` not
  excluded) is `routes.ts`-owned and reported in section 2 above, not fixed
  here.
- Cookie options passed through `@supabase/ssr`'s `createServerClient` in
  both `src/lib/supabase/middleware.ts` and `src/lib/supabase/server.ts` are
  never overridden — `options` from `cookiesToSet` is forwarded as-is, so
  `httpOnly`/`secure`/`sameSite` stay at `@supabase/ssr`'s own defaults.
  Nothing in this codebase weakens them.
- `SUPABASE_SERVICE_ROLE_KEY` is read only in `src/lib/supabase/admin.ts`,
  which throws if evaluated in a browser context — see "Secrets" above,
  unchanged this pass.

### Performance (spec §35) — see `docs/ARCHITECTURE.md` "Performance notes (Stage 14 audit)"

Eager per-Wave signed-URL minting on `/u/[username]` (fixed), the
`Composer.tsx` recorder bundle (fixed), the unused `wavesurfer.js` dependency
(removed), feed pagination/ordering (reviewed, one correctness note
reported), and the `/explore`/`/u/[username]`/`/w/[id]` caching question
(reviewed, not safely cacheable as built — reported) are documented there
rather than duplicated in this file.

## Audit 2026-09-05 (`docs/qa/review2/REVIEW.md`, commit `059c634`) — backend findings fixed

### 1. Challenge entries/picks leaked private Waves (P0) — fixed

`challenge_entries_select`/`challenge_picks_select`
(`20260905130000_challenges.sql`) gated only on the challenge's `status in
('live', 'closed')`, and both tables are granted `select` to `anon`. A
private, moderator-hidden, or blocked-creator Wave entered into a live
challenge was therefore readable — `user_id` + `wave_id` — by a signed-out
visitor or a blocked account, a new discovery surface the "reached via
search/Explore/Home feed queries → never appears" row above didn't cover.
Fixed in `20260905150000_challenge_entries_visibility.sql`: both policies
now additionally require `can_view_wave(wave_id)` on the general read
branch, matching `comments_select`'s shape; the `user_id = auth.uid()` and
`is_moderator()` escapes are unchanged. `list_challenge_entries()`
(SECURITY INVOKER) and `listChallengePicks` (`src/lib/db/challenges.ts`, a
plain `.from().select()`) both ride on this RLS directly, so no function
body needed to change. Same migration also fixes review2 #17 (P2):
`enter_challenge()`'s idempotency lookup ran before its
`can_enter_challenge` authorization check and was unscoped by caller, so a
direct RPC call could probe another user's entry for a wave/challenge pair
RLS would otherwise hide — the check now runs first and the lookup is
scoped to `user_id = auth.uid()`. Regression-guarded by
`scripts/verify-live-challenges.ts`'s `rls:private-entry-visibility` check.

### 2. Account deletion left every recording in storage (P1) — fixed

`deleteAccount` (`src/app/(app)/settings/actions.ts`) called
`auth.admin.deleteUser(user.id)` and relied on the `profiles -> auth.users`
cascade, which only removes database rows — nothing removed the account's
objects in the private `audio` bucket or the public `avatars` bucket, so
every recording an account ever uploaded stayed in storage indefinitely
with no row left pointing at it. Fixed by listing and removing
`audio/<uid>/**` and `avatars/<uid>/**` (`src/lib/storage/userObjects.ts` —
paginated, recursive since `audio/<uid>/<assetId>/<file>` nests one level
deeper than `avatars/<uid>/<file>`, batched removal) with the admin client
**before** `deleteUser` is called; if either bucket's cleanup fails, the
account is not deleted and the action returns a `formError` instead, the
same "storage failure never silently leaves an orphan, but also never masks
itself as success" standard `deleteWaveDetails` (`w/[id]/actions.ts`)
already holds for a single Wave's cleanup.
