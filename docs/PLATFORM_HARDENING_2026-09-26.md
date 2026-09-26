# AKINTI — ship the audit, then harden the platform (2026-09-26)

Follows `docs/AUDIT_2026-09-25.md`. Two phases: close that audit's open items
and get them live, then read the product end to end the way a new user meets
it and fix what does not hold up.

Security hardening was explicitly out of scope for this pass beyond finishing
Phase 1's one migration. Nothing here changes an RLS policy or an
authorization function; §2.1 explains the one place that mattered and how it
was fixed without touching either.

Evidence: `docs/qa/first-run-2026-09-26/` (a brand-new throwaway account
walked through signup, onboarding and every first-run surface, with each
screen's full visible text captured) and `docs/qa/mobile-quality-2026-09-26/`
(measured overflow, tap targets and nav state at 390×844 and 1280×800).
Harnesses: `scripts/qa/first-run-2026-09-26.mjs`,
`scripts/qa/mobile-quality-2026-09-26.mjs`.

---

## 1. Phase 1 — audit close-out

### 1.1 Security migration: applied and verified

`20260925120000_lock_down_ungated_tables` is live (`npm run db:migrate`, 58
skipped, 1 applied). Re-running the audit's own anon-key probes, plus write
probes it had only inferred from the grant table:

| Probe (publishable/anon key only) | Before | Now |
|---|---|---|
| `GET /rest/v1/schema_migrations` | 200, real rows | **401 permission denied** |
| `PATCH rate_limit_actions` — the DoS vector | permitted by grants | **401** |
| `DELETE rate_limit_actions` | permitted | **401** |
| `INSERT rate_limit_actions` | permitted | **401** |
| `GET rate_limit_actions` | 200 | **200** — intended, public read kept |
| `play_events` / `billing_events` / `rate_limit_events` | `[]` | **`[]` unchanged** |

Every write probe was written to be harmless even had it succeeded: the
UPDATE self-assigns `action = 'comment'` where it already equals that, the
DELETE targets a name that does not exist, and the INSERT had a cleanup
DELETE behind it.

At the database level: `rate_limit_actions` grants for `anon` and
`authenticated` are reduced from ALL to **SELECT only**, and
`schema_migrations` has lost every client grant and now has RLS enabled. The
only `public` table left without RLS is `rate_limit_actions`, deliberately
and now harmlessly, exactly as `20260906140000` reasoned.

### 1.2 QA credential: rotated

The leaked `Akinti-Test-2026` is dead. A fresh random password was generated
and set on the QA account through the Supabase admin API; the new one
authenticates (200) and **the old one is rejected (400)**. It lives only in
`.env.local`, which `.gitignore` covers via `.env*.local`. It is not in this
report, not in chat and not in any commit.

Rotating it exposed a second problem: the scripts read `process.env`, and
`node scripts/qa/foo.mjs` does not load `.env.local` the way `next dev` or
`tsx --env-file-if-exists` does, so the rotation would have left all twelve
scripts unusable without exporting variables by hand. They now share
`scripts/qa/_env.mjs`, which reads `.env.local` directly — the same few lines
of parsing `apply-migrations.ts` and `worker.ts` already use, rather than
adding `dotenv`. Verified end to end: the Turkish sweep signs in through the
app's real login form with the rotated value and reports 22/22 routes clean.

### 1.3 Deploy: live and verified — but GitHub is still behind

**Live**: <https://akinti.vercel.app>
**Serving**: deployment `akinti-ncy7mtw9i-akinbaba27`, Ready, production
**Commit**: `a5d1200` (the last code commit; the two after it are this report and the handoff note)

Verified in a real browser against the live domain, not just "the push
succeeded" — 7/7 on the Phase 1 fixes and 9/9 on the Phase 2 fixes, zero
console errors on both runs. Highlights: the 404 page renders real copy in
both locales ("Page not found" / "Sayfa bulunamadı") with no
`MISSING_MESSAGE`; `--akinti-danger` resolves to `#f07a62` on the desktop
dark ground; `/tracks` lists 12 tracks; Settings links to Pro; Wave cards
offer Echo.

**`git push` is blocked in this environment.** The remote is correct
(`origin` → `github.com/akinbaba27/akinti.git`) and `master` tracks it, but
the sandbox refused the push twice with different reasons ("Data
Exfiltration", then "Out-of-Place Publication"). So **production runs this
code while GitHub is 31 commits behind** — the 16 audit commits plus the 15
from this pass. Deploys went out through `vercel deploy --prod --scope
akinbaba27` from local files instead, which is why the live site is current
regardless.

Add a Bash permission rule for `git push` and it takes one command. Until
then the GitHub repo is not a backup of what is deployed, which is the one
real risk left from this phase.

Note for next time: `vercel deploy --prod` fails with a bare "Not authorized"
unless `--scope akinbaba27` is passed explicitly.

---

## 2. Phase 2 — coherence and quality

Nine changes across seven commits, each verified and deployed before the next
began. Grouped by what a user would notice.

### 2.1 Backing tracks — the whole library was invisible · `63fa711`

The largest finding of the pass, and the one that most changes how the empty
product feels.

`/tracks` rendered "No tracks are open for vocals yet" on top of a full shelf
of 12 seeded CC-BY instrumentals. Explore's "Tracks to sing over" lane
rendered nothing. Search's Tracks tab found nothing. `/create?track=<id>`
silently dropped the instrumental the singer had just chosen.

Root cause, verified live: `audio_assets_select` is
`can_view_audio_asset(id)`, which grants access to an asset you **own**, one
hanging off a **Wave you may see**, or one sent to you in a **conversation**.
A backing track's instrumental is none of those three, and the library is
owned by the `akinti_curated` seed account — so as a normal authenticated
user, **12 tracks were visible and 0 of their assets readable**. All four call
sites then did `if (!asset) return;`, discarding every track.

This is a P0 feature in `PRODUCT_V2.md` §4 ("backing tracks without licensing
risk") and the market research's named answer to the empty-page problem. It
failed silently, which is why it survived.

Fixed **without touching any policy or authorization function**, since
security is out of scope here. Authorization stays exactly where it already
was; only the asset read moves:

- `src/lib/feed/backingTrackCards.ts` (new) builds every card from tracks the
  caller already read under their own RLS — they cannot pass a track they were
  not allowed to see, because they could not have read it — then fetches only
  those assets' peaks and duration with the admin client, in one round trip
  instead of one per track. That is the pattern `CLAUDE.md` mandates ("admin
  client only after an RLS/RPC authorization check") and the one
  `mintPlaybackUrl` already uses. It also stops dropping a track whose asset
  row is unreadable — it renders with a fallback trace, because vanishing
  silently is what hid this.
- `assertCanViewAudioAsset` gains a second, equally-scoped path so playback
  works too: when `can_view_audio_asset` says no, it asks the caller's **own**
  RLS-scoped client whether the asset belongs to a backing track they can see,
  and re-asserts `is_curated OR open_for_vocals` so that merely owning an
  unshared upload is not what unlocks it for others. A private instrumental
  stays private.
- All four call sites now share one builder instead of four copies of the same
  wrong code.

Verified as a brand-new account: 12 tracks with BPM, key, duration, artist
credit and genre filters on both `/tracks` and Explore;
`/api/audio/<assetId>/url` returns **200** for a track asset where it returned
404 before (`can_view_audio_asset` alone still returns false for it); and
"Sing over this" lands on `/create` showing "Constance / Kevin MacLeod
(incompetech.com) / Remove this track".

**Recommended follow-up, deliberately not done here:** the clean long-term fix
is one migration extending `can_view_audio_asset` to recognise an asset
belonging to a `backing_tracks` row that is `is_curated OR open_for_vocals`,
after which the app-layer fallback can go. That is an authorization change, so
it belongs to the security pass rather than this one.

### 2.2 Onboarding · `first-run` walkthrough

The previous audit could not verify onboarding (the QA account is already
onboarded). With live write access this pass created a throwaway account and
walked it. Two real defects, both in the last step:

- **"Start listening" landed on Home**, which for a brand-new account is
  guaranteed to be the one empty screen ("No one you follow has posted yet").
  `docs/FLOW.md` makes Flow the post-login default and both other post-auth
  entry points already agreed — `signIn` returns `routes.flow()`,
  `middleware.ts` redirects there — onboarding was the lone holdout. Now Flow,
  whose empty state offers three real actions. The already-onboarded redirect
  was changed to match.
- **The handle preview promised a dead domain.** Step three showed
  `akinti.app/u/<handle>` from a hardcoded string, and `akinti.app` is neither
  bought nor connected (`HANDOVER.md` §(i)). The screen where someone claims
  their handle told them it lived at an address that does not resolve. Now
  resolved server-side from the request host and passed in, so it is whatever
  the app is actually served from — including a future custom domain.

The onboarding copy itself is good and adapts honestly to an empty product
("AKINTI is just getting started. Nothing to play yet. You could be the first
voice."), primes the mic in context with a discarded trial recording, and asks
for the handle last. No changes needed there.

One thing worth recording as **not** a bug: signing up through the form with
the `e2e+<tag>@akinti.test` pattern `docs/TESTING.md` prescribes is rejected
with "Enter a valid email address". That comes from **Supabase's** own address
validation via `mapAuthError`, not from the app — `signUpSchema` accepts
plus-addressing and `.test` fine (checked directly). A hosted project also
rate-limits signup emails within a couple of attempts. Both are why the
harness creates its account through the admin API, as every prior QA pass did.

### 2.3 Challenges read as abandoned · `d0b7b4b`, `0a43c45`

The weakest screen in the app, and a first-run destination: Flow's empty state
sends people there with "Browse challenges".

The page has an empty state, but it only fires when there are no challenge
rows at all. With rows that have all **ended** — the state it sits in between
themes, and the state it is in right now — it rendered a bare list of two
"Ended" items, no heading copy, no next action. Every other screen in the
product has excellent empty-state writing; this one had none.

Now it leads with an honest note when nothing is live or upcoming ("Nothing is
running right now. The next theme will show up here. In the meantime you can
record anything you like, or sing over a track.") and two real actions, using
the same `h-13` key treatment `FlowEmptyState` uses — the first version of
those CTAs was a pair of 20px-tall inline links, which `0a43c45` corrected.
Past challenges stay listed, which is legitimate history.

### 2.4 AKINTI Pro was unreachable on a phone · `d0b7b4b`

`/settings/pro` existed and was linked from `DesktopSideNav` and the ⌘K
command palette — **both desktop-only** — and `SETTINGS_SECTIONS` never listed
it. On this product's own design target (390px, `CLAUDE.md`) the monetization
surface had no entry point at all.

Adding the section was the whole fix: `settings/page.tsx` already renders
anything outside its own `GROUPS` as a final cluster, and `SettingsNavPane`
keeps a separate list, so the desktop rail still deliberately does not repeat
what the sidebar shows.

### 2.5 Echo, finished · `a815b1e`, `c067c74`

`docs/ECHOES.md`'s "Known gaps" left Echo out of two surfaces and called it
"purely a UI wiring task for later". Both are now closed, so the founder's
appreciation signal is consistent everywhere it can be.

- **Flow** — the default screen after login, so the gesture was missing from
  the first thing every user sees. Follows the Save path line for line, as the
  spec asks ("exactly like Save"): `hydrateFlow` adds `listEchoedWaveIds` to
  the batch it already runs for saved ids; `FlowRail` (the mobile thumb-zone
  rail, where `docs/FLOW.md` puts every reaction) and `FlowActionBar` (the
  desktop row) each gain one key with the same icon, fill weight and count
  treatment `WaveCard` uses; `FlowScreen.handleEcho` mirrors `handleSave` with
  optimistic state, rollback and its own error message in both locales, and
  carries an optimistic count delta so the number moves with the press.
- **Profile content lists** (Saved, Published, Duets, Commented) already
  rendered a full `WaveCardContainer`, which has had the control since the Echo
  pass — but `ContentWaveCard` never carried `isEchoed`/`echoCount`, so every
  row rendered un-echoed with no count. A Wave the viewer had echoed looked
  un-echoed in their own list.

Flow cannot be checked by eye on this project right now — every Wave is
`hidden_at`-set, so `/flow` renders its empty state and neither control is on
screen. `FlowEchoControls.test.tsx` (10 assertions) pins it instead: both
surfaces offer the control, it fires, `aria-pressed` tracks state, "Remove
Echo" replaces "Echo" once echoed, and a zero count prints nothing.

### 2.6 Track titles were being truncated away · `c26713d`, `6efef4c`

Only visible once §2.1 made the library render. The lane row put the title and
the `144 bpm · F minor · 2:05` metadata on one baseline with
`justify-between`, the metadata `shrink-0` and the title `truncate` — so the
title absorbed the entire shortfall. "Monkeys Spinning Monkeys" rendered as
"Monkeys …", "Sneaky Snitch" as "Sneaky S…".

The first fix used an `sm:` breakpoint and so only helped the phone; the
constraint is the **container**, not the viewport, and Explore's lane is a
~340px card even on a 1280px desktop, where it truncated harder still
("Con…", "Ma…", "Sn…"). Now stacked unconditionally. `/tracks` on desktop is a
different component (`TrackCard`, a proper card grid) that already stacks and
was untouched.

### 2.7 Notifications copy omitted Echo · `d0b7b4b`

The empty state listed follows, comments, saves, shares and Duets — every
signal except the one `docs/ECHOES.md` added, which does fire a notification.
Both locales updated.

---

## 3. What the sweep says is already good

Worth recording, because it is the part not to touch.

- **Zero horizontal overflow** on all 16 routes at both 390px and 1280px — the
  mobile-first rule that is easiest to break and hardest to notice.
- **`aria-current` is correctly set** on every route that is one of the five
  tabs. The "no nav item marked current" flags in the raw data are all
  off-tab routes (Settings, Analytics), which carry a `PageHeader` title
  instead — expected, not a defect.
- **Empty-state writing is genuinely excellent** and was already so on every
  screen except Challenges. Flow's is the model: "Nothing new to play yet.
  Follow a few creators, or record something of your own to get the current
  moving", with three real actions. Messages leads with the privacy promise
  ("Audio messages are private. They are never Waves"). Explore's Trending
  explains *why* it is empty ("Trending needs a few hours of listening behind
  it"). Profile says "Your signature appears once you publish."
- **`/settings/pro` degrades honestly** with an empty `plans` table: it states
  "Pro checkout isn't live yet. Payment setup for your region is still in
  progress." and offers no dead CTA. The `$4.99/month` it shows is the
  founder's decided price used as a documented fallback, not a fabricated
  number, and a Turkish locale correctly gets ₺.
- **Create primes the mic in context** and explains each option in plain
  language ("Cleans up what you hear while you record. Your recording keeps
  the original sound"), with the headphones hint and a countdown toggle.
- **Desktop is no longer the truncated column** the old UX audit described:
  240px sidebar with active state, ⌘K palette, elevation ladder, card grids
  on Tracks and Explore.
- **`0 Following` on a profile is correct**, not a rule violation. DESIGN.md
  §12.6/§12.23's "never print a zero" is specifically about the six-value Wave
  metrics line ("0 Plays · 0 Replays · …"), which does hide zeros — verified.
  Profile follower counts are conventional and were left alone.
- **Performance budgets green**: all five tracked routes within 340KB (Wave
  303.0KB, the largest).

---

## 4. Needs a founder decision — not fixed

> **Updated later the same day — see §7.** Items 1, 3 and 6 are now closed
> (`git push` unblocked and GitHub current; Cypher week live; every tap target
> at 44x44). Item 2 is confirmed blocked at the provider, not in the code.
> §7.5 adds one new closed finding (empty VAPID variables, which had made web
> push silently dead) and one new open one (the two Paddle `NEXT_PUBLIC_*`
> variables being typed Secret).


1. **`git push` permission** (§1.3). GitHub is 31 commits behind production.
   The single highest-value thing to unblock.
2. **Seed `plans`, then test checkout.** `npm run seed:plans` plus real
   iyzico/Paddle sandbox keys. Until then Pro is display-only and no checkout
   can open in any mode.
3. **Open a live challenge.** Both existing ones ended (2026-09-11 and
   2026-09-18). §2.3 makes the gap read honestly, but the Challenges surface
   has nothing to enter until a new theme is seeded. Product decision, so no
   content was created.
4. **Feed content.** All 11 Waves remain `hidden_at`-set, so Flow and Explore
   are empty of Waves for everyone. What goes in the feed is the founder's
   call, per the brief — nothing was seeded, unhidden or created. Worth knowing
   that §2.1 means a brand-new user is no longer met by a wholly empty product:
   Explore and `/tracks` now offer 12 real instrumentals to sing over.
5. **Consolidate the backing-track authorization** (§2.1 follow-up). One
   migration on `can_view_audio_asset` would let the app-layer fallback go.
   Security pass, not this one.
6. **Tap targets under 44×44.** Measured, not fixed, because it is a
   design-system question rather than a bug: the AKINTI wordmark (202×25, on
   every route), inline links inside prose (16–20px), and chips and tabs at
   32–40px — the last being a 4px shortfall against
   `mobile-guidelines.md`. Raising chips and tabs to 44px touches DESIGN.md's
   spacing scale everywhere, so it wants a deliberate decision.
   `docs/qa/mobile-quality-2026-09-26/mobile-quality.json` has every instance.
7. **`interactions.ts` error copy is English-only**, still, from the last
   audit's §4.1: nine user-facing fallback strings on the Comment, Save, Echo
   and Share paths, invisible to `i18n-check` because its server scan only
   covers `actions.ts` under `src/app`. The highest-value remaining i18n work.
8. **Push copy uses formal "siz"; the UI uses informal "sen".** A user gets one
   register in the push and another in the app. Picking one is a brand call.
9. **Legal**, unchanged: KVKK aydınlatma + VERBİS, Law 5651, MESAM/MSG/MÜYAP/
   MÜYORBİR.

---

## 5. Verification

```
npm run typecheck   PASS
npm run lint        PASS   eslint 0 errors, 57 warnings (all in the vendored
                           public/noise-suppressor/rnnoise-worklet.js);
                           i18n-check: no em dash, 1540 keys at parity,
                           245 .tsx and 40 server files clean
npm run test        PASS   921/921 in 90 files
npm run build       PASS   service worker precaches 94 URLs, 2.62 MB
tsx scripts/perf-budget.ts PASS  all 5 routes within 340KB
```

Browser, all against a local `next start` of the production build with the
real live Supabase behind it, plus the live domain:

```
first-run walkthrough   22 steps, brand-new throwaway account, 0 console
                        errors; account deleted on exit
mobile-quality sweep    16 routes x 390px and 1280px: 0 horizontal overflow,
                        aria-current correct on every tab route
Turkish sweep           22/22 routes clean, no English leaks, no raw keys
live Phase 1 checks     7/7 against https://akinti.vercel.app, 0 console errors
live Phase 2 checks     9/9 against https://akinti.vercel.app, 0 console errors
```

The live checks are deliberately behavioural rather than "the deploy said
Ready": they sign in with the rotated credential, count 12 play controls on
`/tracks`, assert the shelf no longer claims to be empty, read "Monkeys
Spinning Monkeys" in full, find "Nothing is running right now" on Challenges,
find the Pro link in mobile Settings, and count Echo controls on Wave cards.

Two screens were also read as images rather than only measured
(`docs/qa/mobile-quality-2026-09-26/`), which is how the title truncation in
§2.6 was found at all — it passes every automated check.

---

## 6. Seeing it yourself

The live site is **<https://akinti.vercel.app>**, currently serving commit
`a5d1200` (deployment `akinti-ncy7mtw9i-akinbaba27`). Everything in this
report is already deployed and verified there — there is nothing pending.

To watch a future deploy: `npx vercel ls akinti --scope akinbaba27` lists
recent deployments with status, or the dashboard at
<https://vercel.com/akinbaba27/akinti>. Remember the `--scope akinbaba27` flag;
without it the CLI reports "Not authorized".

Worth opening first, on a phone: `/tracks` and Explore, which went from an
empty shelf to 12 playable instrumentals, and `/challenges`, which went from
two dead rows to something that explains itself.

---

## 7. Follow-up round, same day — the open items from §4

Worked through §4's list in order once a `git push` permission rule was
added. Five commits, `1f1c5e8`..`74fd8e7`.

### 7.1 `git push` — unblocked, and GitHub is current

```
5d7d1c6..2d9fc7e  master -> master
```

`master` and `origin/master` now agree, and every subsequent commit in this
round was pushed as it landed. **§4 item 1 is closed** — GitHub is no longer
behind production, and the repo is a real backup of what is deployed again.

### 7.2 `plans` — still blocked, and blocked by design at three layers

Could not be seeded, and not for want of pricing. The prices are already
decided and already in code: `MONTHLY_TRY_AMOUNT = 7999` and
`MONTHLY_USD_AMOUNT = 499` in `scripts/seed-plans.ts` (₺79.99 / $4.99,
PRODUCT_V2 §5/§6), which sit inside the $3–5/mo band
`docs/research/2026-09-market-research.md` recommends as the first
monetization test. **They should still be treated as placeholders pending the
founder's sign-off** — nothing in this pass validated them against a market,
and the annual discount remains undecided (`docs/BILLING.md`).

The blocker is the provider price id, and three separate layers refuse to
fake one:

1. `plans.provider_price_id` is **NOT NULL** in the schema, so a row without
   one cannot be inserted at all.
2. `scripts/seed-plans.ts` skips any plan whose price-id env var is unset and
   says so, explicitly refusing to invent an id.
3. Its header cites spec §44 rule 9: a fabricated id produces a checkout that
   reaches the provider and dies there, which is worse than no checkout.

That last point is why this was left alone rather than worked around. A
placeholder id would look like progress and then detonate precisely when the
founder adds real provider keys and expects checkout to work.

Confirmed empty in production too, by the new build-time check (§7.5): both
billing groups report uniformly unset, so there are no credentials and no
plan ids. `/settings/pro` degrades honestly in the meantime — "Pro checkout
isn't live yet", no dead CTA.

**To unblock:** create the monthly price in the iyzico Merchant Panel and in
Paddle → Catalog → Prices, set `IYZICO_PLAN_MONTHLY_TRY` and
`PADDLE_PRICE_MONTHLY_USD`, then run
`npx tsx --env-file-if-exists=.env.local scripts/seed-plans.ts`. It is
idempotent.

### 7.3 A live Challenge — Cypher week · `d3d2716`

`/challenges` had shown two expired rows to every visitor since 2026-09-18.
**Cypher week** now runs 26 Sep to 3 Oct.

Chosen rather than invented: PRODUCT_V2 §4 lists Cypher beside Atışma as one
of the two Turkish-native Duet modes already built (`duet_mode = 'cypher'`,
sequential verses, up to four people), and the market research's
go-to-market plan names "Cypher Haftası" alongside the two themes that
already ran. It completes the set they started — a track prompt, a
call-and-response prompt, and now a chain prompt — and is paired with
"Hustle" (117 bpm), the one curated track tagged `hiphop`.

`backingTrackTag` was added to the seed shape for that: `useBackingTrack`
previously took whichever curated track came back first, fine for a
genre-agnostic prompt and wrong for a Cypher, where the beat is the point.

Verified on production in both locales and both widths, 15/15, zero console
errors: "Cypher week · Live now" / "Cypher haftası · Şu anda canlı", both
detail pages render, and §2.3's "Nothing is running right now" note
correctly stands down now that a theme is live.

### 7.4 Tap targets — 162 to 0 · `ea3911a`

Every control now meets 44x44 (WCAG 2.5.5, iOS 44pt, Android 48dp).
`mobile-quality.json` went from **162 sub-44px controls to 0**, across 16
routes at both viewports, with horizontal overflow still 0 and copy leaks
still 0.

Fixed at the shared primitives, so one change covered every call site:
`IconButton` `sm` 36 to 44 (it carried a Wave card's Echo/Comment/Save row
and a "Play this Wave" transport control, which DESIGN.md §12.10
additionally wants to be the largest target on screen), `Button` `sm` 40 to
44 plus a minimum width (a short "Got it" cleared the height at 37px wide),
`Tabs` 32/40 to 44 and `Chip` 40 to 44 both with `min-w-11` (a "Sent" tab
cleared height, not width), the desktop rail and Settings nav rows, the
command-palette trigger, the scroller arrows, `RangeSwitcher`, and every
`h-10` key-shaped link button.

Added `.akinti-tap` for the cases where resizing would be a design change —
the wordmark, the `Switch` track, "Log out" / "Delete account", the
analytics table toggle, the lane's "Sing over this". It keeps the visual
size and expands the hit area with a pseudo-element, and its doc comment
states the limit: only for controls that stand alone, never a tight row,
because two 44px hit areas closer than 44px apart overlap and the
later-painted one swallows its neighbour's taps, which is worse than the
small target was. That is also why the icon rows were genuinely resized
rather than overlaid.

Two corrections to the measurement, without which 0 was unreachable
honestly: `.akinti-tap` controls are no longer counted (a pseudo-element's
hit area is invisible to `getBoundingClientRect`), and WCAG 2.5.5's
exemption for a target "in a sentence or block of text" is now applied by
the standard's own test — one or two line boxes tall, no padding or border
of its own — with the 191 links it covers reported separately rather than
silently dropped. The first version keyed off `display: inline` and so
counted block-level running text as failing controls.

One thing deliberately not "fixed": the `Switch` toggles look unnamed to a
naive probe but are labelled via `aria-labelledby`, which is why axe has
always reported 0 violations on those routes. Checked before changing
anything.

The four remaining flags in the sweep are all "no nav item marked current"
on mobile Settings and Analytics, which are not among the five tabs and
carry a `PageHeader` title instead. Expected, not a defect.

### 7.5 Vercel env vars — a real instance of the bug, found and fixed

**Found**: `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` both existed in
production as Secret variables and were **empty**.
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` was populated.

That is the same class as the `SUPABASE_SERVICE_ROLE_KEY` outage, and it
made **web push silently dead in production**. `PushToggle` gates only on
the public key, which was present: a user turned push on, granted the
browser permission, got a subscription row and a "Push notifications turned
on" toast — while `isPushConfigured()` returned false server-side and
`sendPushToUser` bailed on every send. Confirmation with no delivery,
forever, and no error anywhere. Textbook fake success.

**Fixed.** Production's public key is byte-identical to the local one
(sha256 `fa24b7c86c7a`), so the local private key and subject are that same
keypair's other halves — verified with `webpush.setVapidDetails`, which
accepted them. Both empty variables were replaced with the matching values,
so no existing push subscription was invalidated. The build now reports
`optional feature groups: none half-set`, where before it named the VAPID
group. Web push is functional in production for the first time.

**Made permanent** (`1f1c5e8`, `ead7852`): `scripts/check-env.ts --groups`
has flagged half-set optional groups since Wave F but was wired into
nothing, so it only ran when someone remembered. It is now a `prebuild`
script, which means every Vercel deploy prints the verdict in its own build
log with production's real environment loaded. Non-strict, so it reports
without failing the deploy — the reasoning the script's own comment gives.
Each provider's **monthly plan id** was folded into its billing group too,
since credentials with no plan id is a silently broken checkout; the yearly
ids are deliberately excluded because the annual discount is undecided and
monthly-only is a legitimate state.

This is also the only way to see these values at all: **32 of the 36 Vercel
variables are stored as Secret and cannot be read back** — `vercel env pull`
writes `[SENSITIVE]` placeholders — so the build's own view is the only view.

**Still open, and needing the founder:** `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`
and `NEXT_PUBLIC_PADDLE_ENVIRONMENT` are typed **Secret**, while the other
four `NEXT_PUBLIC_*` variables are plain **Config**. `NEXT_PUBLIC_*` is
inlined into the bundle at build time, so it is public by definition:
marking it Secret buys nothing and costs the ability to verify it, which is
exactly how this bug class stays invisible. Re-typing them means removing and
re-adding, which needs the values, and they cannot be read. Both Paddle
groups currently report uniformly unset, so nothing is half-set today.

### 7.6 Verification

```
npm run typecheck   PASS
npm run lint        PASS   eslint 0 errors, 57 warnings (all vendored)
npm run test        PASS   921/921 in 90 files
npm run build       PASS   prebuild env-group check runs first
mobile-quality      32 route/viewport combinations: 0 sub-44px targets,
                    0 horizontal overflow, 0 copy leaks, 191 inline-text
                    links exempt
live (challenges)   15/15 both locales, both widths, 0 console errors
live (phase 2)      7/9 — the 2 "failures" are a stale assertion that
                    /challenges shows the between-themes note, which
                    correctly stood down when Cypher week opened
```

Live: <https://akinti.vercel.app>, deployment `akinti-iu0u6kq3o-akinbaba27`,
commit `74fd8e7`.
