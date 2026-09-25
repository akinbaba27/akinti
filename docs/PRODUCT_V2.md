# AKINTI — Product Plan v2 (Sept 2026)

Status: decision document for the "sellable quality" rebuild. Supersedes priorities in `PRODUCT.md` where they conflict. Evidence lives in `docs/research/*` (market research, mobile guidelines, libraries, teardown, UX audit) and `docs/design/*` (Design DNA, DESIGN.md, SCREENS.md).

## 1. Diagnosis of v1

v1 implemented the whole spec (16 stages, 481 unit tests, live Supabase, e2e green) but fails as a product:

- Looks like a generic AI-generated app (uniform cards, single accent, default type, no identity, no waveform character). See UX audit.
- No "aha" in the first session: a raw phone-mic recording sounds bad, and the only enhancement is EQ presets.
- Empty product for a first user: nothing to sing over, nobody to duet with, feeds empty, no prompts.
- Feature-complete but not delightful: everything works "on paper", nothing feels premium on a phone.

Verdict: keep the backend (schema, RLS, auth, storage, worker, metrics — all verified live) and rebuild the experience layer on top of it. Do not restart from scratch.

## 2. Positioning

**AKINTI is where your voice meets other voices.** Record or upload a Wave, hear it sound great instantly, and turn it into a Duet with someone else. Plays, Replays, Saves, Comments, Shares, Echoes (`docs/ECHOES.md`, added 2026-09-18) and Duets are the signals — deliberately not a generic reaction system, and still no streaks, badges or leaderboards.

Primary users (launch): amateur and semi-pro singers, rappers, songwriters in Turkey, 16–30, already posting covers/freestyles on TikTok/Instagram. Secondary: listeners who follow them.

Wedge vs. Smule/StarMaker/TikTok: (1) audio-first, no camera pressure; (2) async Duets and Duet chains as the core object; (3) Turkish-native modes (Atışma, Cypher, Türkü Düeti); (4) instant studio-quality polish on every recording; (5) real feedback (structured comments) alongside a single honest appreciation signal (Echo) rather than a vanity-metric wall of reaction types.

## 3. The core loop (must work flawlessly on a phone)

1. Open app → hear something good within 10 seconds (Explore autoplays a curated Wave with visible waveform).
2. Tap the record button → one-tap record with live level + pitch meter, countdown, monitoring advice → stop.
3. Hear yourself polished within 5 seconds (client-side preview: native Web Audio compressor + EQ + reverb IR; optional RNNoise WASM toggle) → choose one of 6 named sounds → publish.
4. Server worker produces the "studio" version (DeepFilterNet cleanup → optional pitch snap → preset → Matchering master → loudnorm → peaks) in under 60 seconds; Wave page shows progress honestly.
5. Others Play/Replay/Save/Comment/Share; anyone allowed can **Request a Duet** or **answer an Open Call**; Duets form chains.
6. Weekly prompts and challenges give reasons to return; streaks with a freeze; structured feedback.

## 4. Feature set for the rebuild (priority order)

### P0 — Must ship (the sellable core)
- **Design system v2** from `docs/design/DESIGN.md`: distinctive type pairing, one signature hue (not indigo/violet), waveform as identity, grain/texture rules, non-uniform radii, motion spec, dark + light.
- **All screens rebuilt mobile-first** per `docs/design/SCREENS.md`: onboarding (3 steps, skippable, mic priming), Home, Explore, Record/Upload, Enhance, Publish, Wave page, Duet request, Duet record, Profile, Messages, Notifications, Settings, Analytics.
- **Recording that feels pro**: wavesurfer v7 waveform + Record plugin, `extendable-media-recorder` WAV fallback on iOS, correct `getUserMedia` constraints for singing (AGC/echo cancellation off, noise suppression off by default), live pitch meter (pitchy), countdown, retake, trim (regions), headphones hint, Media Session for lock screen.
- **Instant polish**: client preview chain (native nodes) + 6 named sounds (Natural, Studio, Clear Voice, Warm, Deep, Atmospheric) + optional RNNoise toggle; server pipeline: DeepFilterNet3 → preset → Matchering → EBU R128 loudnorm → peaks (FastAPI sidecar next to the ffmpeg worker).
- **Backing tracks without licensing risk**: a curated royalty-free/CC0 instrumental library (tagged by genre/BPM/key) + user-uploaded instrumentals marked as "open for vocals"; sing over a track = a Duet with the track's uploader.
- **Duets as the center**: Request a Duet, **Open Call** (creator invites anyone), Duet chains (A→B→C tree view), "Duet of @creator" attribution, two Turkish modes: **Atışma** (call-and-response, alternating segments) and **Cypher** (sequential verses, up to 4 people).
- **Prompts & challenges**: weekly theme + backing track, curated Top 5, hashtag pages. (Streaks/badges are NOT in P0: `docs/design/DESIGN.md` §12 rule 35 forbids gamification; revisit as a measured experiment only if week-4 retention is below target.)
- **Structured feedback**: comment composer with optional 3 fields (what worked / pitch or timing note / one thing to try); helpful comments surface higher; no likes, no badges.
- **PWA**: Serwist, install prompt after first publish, push notifications for Duet requests/answers, offline draft (idb-keyval), safe areas, 100dvh, standalone-mode fixes for iOS.
- **Quality**: Playwright mobile emulation with fake mic, axe in CI, Lighthouse budgets (mobile LCP < 2.5s, INP < 200ms, first-load JS budget per route), visual regression on `/kit`.

### P1 — Ship right after (monetization + growth)
- **AKINTI Pro** subscription (iyzico primary, Paddle secondary): pitch snap + self-harmony + stems, unlimited saves, ad-free forever, one featured Duet slot/month, Pro badge. TRY tier priced for Turkey; USD/EUR for international.
- **Pitch score / vocal coach** (pYIN, CREPE fallback) shown after recording as encouragement, not judgment.
- **Share cards**: ffmpeg `showwaves` audiogram MP4 (9:16) with brand frame for TikTok/Instagram/WhatsApp; deep links back.
- **Creator analytics v2** and "Rising" surfaces.
- **Turkish localization** (i18n infra, TR first-class copy, genre taxonomy: pop, rap/trap, arabesk, türkü/halk, rock).

### P2 — Later
- Gifting/coins on Duets and performances (needs KYC/payout rails).
- Live "pass the mic" rooms.
- Demucs stems (GPU queue), transcripts, native wrapper (Capacitor) after a recording-latency spike.

### Explicitly not building
Likes; images/video posts; licensed karaoke catalog; voice cloning of other people; Suno/Udio-generated tracks; ads before 10k DAU; real-time synchronized duets.

## 5. Monetization plan
1. Launch free; measure activation (first Wave within 7 days) and Duet acceptance.
2. Month 2: AKINTI Pro at ₺79.99/month (~$2.5) in Turkey, $4.99 international, annual discount; paywall only on Pro-only sounds, stems, harmony, featured slot. Never paywall a previously free feature.
3. Month 4+: gifting on Duets if Pro conversion ≥ 2% and DAU ≥ 5k.

## 6. Go-to-market (Turkey first, per research §4)
Seed 300–500 real singers (conservatories, university music clubs, Discord servers, cover pages) → micro-creators (40–60 posts) + "Cypher Haftası" → talent-show spillover → genre-native weekly challenges cross-posted as audiograms → paid tests + 2–3 meetups. Budget ~₺220–300k over 90 days. Legal to-dos before scale: KVKK aydınlatma + VERBİS, terms with UGC copyright process (MESAM/MSG/MÜYAP/MÜYORBİR), 5651 readiness plan.

## 7. Quality bars (definition of "sellable")
- A stranger can open the app on a phone, record, hear a polished result and publish in under 90 seconds without reading anything.
- Every screen passes the 60-rule mobile checklist (`docs/research/mobile-guidelines.md`) and the "Never do" list in `docs/design/DESIGN.md`.
- Zero console errors, zero failed requests on the golden path; typecheck/lint/unit/e2e/axe/Lighthouse budgets green in CI.
- Independent QA (agent using a real browser with fake mic on mobile viewport) signs off each wave with screenshots; the founder reviews screenshots before the next wave.

## 8. Build plan (agent waves; Fable manages, agents write code)
- **Wave A — Foundation v2**: design tokens + typography + icons + motion primitives; `/kit` rebuilt as the living style guide; wavesurfer v7 player; layout shell (tab bar, top bar, sheets) — the rest of the app must keep working during migration.
- **Wave B — Record & Enhance**: recorder rebuild (fallback recorder, constraints, meters, countdown, trim), client polish preview, publish flow; Python sidecar (DeepFilterNet, Matchering, pYIN) + worker integration; backing-track library.
- **Wave C — Screens**: Home, Explore, Wave page, Profile, Messages, Notifications, Settings, Analytics rebuilt to SCREENS.md; empty states with next actions; prompts/challenges; structured feedback; streaks.
- **Wave D — Duets v2**: Open Calls, chains tree, Atışma and Cypher modes, duet recorder polish, share cards.
- **Wave E — PWA, performance, accessibility, i18n TR**.
- **Wave F — Pro subscription (iyzico + Paddle), pitch score, harmony**.
- After every wave: QA agent (browser, mobile emulation, screenshots) + code review agent; fix loop until green; commit; founder review of screenshots.
