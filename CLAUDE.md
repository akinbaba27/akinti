@AGENTS.md

# AKINTI — working rules for every agent (v2, Sept 2026)

AKINTI is an audio-first social app: people record or upload their voice, songs and compositions ("Waves"); others Play, Replay, Save, Comment, Share, Echo ("Yankı" — `docs/ECHOES.md`, a deliberate, conscious override of the original "No Likes" decision, added 2026-09-18) and request collaborative **Duets**. No image or video posts. Mobile-first responsive web app (Next.js 16.3 App Router, React 19, TypeScript, Tailwind 4, Supabase Postgres/Auth/Storage/Realtime, Node worker with ffmpeg 9 + Python DSP sidecar). Brand: **AKINTI**. UI language: English now, Turkish first-class next (all strings must survive `latin-ext`, see design §3.2).

The founder's standard: **sellable, premium, human, error-free**. "Works on paper" is failure.

## Source-of-truth documents (read before touching anything)
- Product decisions: `docs/PRODUCT_V2.md` (overrides `PRODUCT.md` and `akın icin md.md` where they conflict).
- Visual system: `docs/design/DESIGN.md` (concept, type, colour, waterline, motion, components, copy, **§12 Never do**), tokens in `docs/design/DESIGN_DNA.json`, screens in `docs/design/SCREENS.md`, references in `docs/design/REFERENCES.md`.
- Mobile rules: `docs/research/mobile-guidelines.md` (60-rule checklist; every screen must pass).
- Library decisions: `docs/research/libraries.md` (what to adopt, what never to add).
- Evidence: `docs/research/2026-09-market-research.md`, `docs/research/teardown/TEARDOWN.md`, `docs/research/ux-audit/REPORT.md`.
- Engineering: `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/AUDIO_ARCHITECTURE.md`, `docs/DUET_SPEC.md`, `docs/CHALLENGES.md`, `docs/ECHOES.md`, `docs/SECURITY.md`, `docs/TESTING.md`, `docs/DEPLOYMENT.md`.

When documents conflict: DESIGN.md wins on anything visual; PRODUCT_V2.md wins on scope; SECURITY.md wins on authorization.

## Design rules that are non-negotiable (summary of DESIGN.md)
- One drawing primitive: the **waterline**. Audio, separators, progress and history are all traces. No cards (one exception: Explore creator tile). No shadows, no glass, no gradients (except the 24px edge fade on a full-bleed trace), no pills, no coloured left borders.
- Colour (amended 6 Sept 2026 by the founder, see `docs/design/COLOR_V2.md`, which wins over DESIGN.md §4): tinted water grounds (`--akinti-paper` `#E9EFEC` / `#0F1614`), deep teal `--akinti-current` as the brand hue for traces, keys, links and progress, sand as a sparing warm counterpoint, mode/genre trace hues (Atışma reed green, Cypher four fixed hues, genre tints). Previous rule: paper `#EFEFEC` / graphite `#131412` grounds, ink scale, hairlines. **Signal (`#DE3C11` light / `#FF5C33` dark) appears only where audio is live**: played trace, record lamp, live level, unheard mark, open-for-Duet mark. Never on tabs, follow buttons, links, badges, settings. No indigo/violet/purple anywhere. Semantic colour is ink-based.
- Type: **Archivo Variable** (display expanded `wdth 112`, UI normal) + **Martian Mono** for numerals only. `subsets: ['latin','latin-ext']` on every `next/font/google` call; `<html lang>` set; `tabular-nums` for all counts and timecodes; never animate weight; never uppercase Turkish; no Inter/Geist/Space Grotesk/Poppins/Montserrat/serif display.
- Radius encodes role (`0/2/6/10/14/16/24`); never one radius everywhere. Layout hangs on a single left rail; nothing centred.
- Motion: linear for anything bound to audio time; press feedback physical; no stagger, no fade-slide-up everywhere, no infinite animation except the record lamp; honour `prefers-reduced-motion`.
- Icons: Phosphor, one weight. No emoji as icons, no sparkles, no mixed sets.
- Copy: sentence case, no exclamation marks, no em dash in user-visible strings, one middle dot per metadata line, never print a zero metric, no engineering language in the UI (no "RLS", "RPC", "spec §", "server-side", "deterministic").
- Transport controls (play, record, stop) are the largest touch targets on their screen.
- Empty states are left-aligned, contain real next actions, never an icon in a grey circle above centred text. Skeletons have no shimmer and no fake waveform.
- No gamification (streaks, badges, confetti). No autoplay without a gesture. No optimistic UI on audio upload state.

## Mobile rules that are non-negotiable (summary of mobile-guidelines.md)
- 390px viewport is the design target; test at 390×844 and 1280×800 minimum. `100dvh`, safe-area insets, keyboard avoidance.
- Time to first sound under 10s; record → hear polished result → publish under 90s with no reading.
- Mic permission is primed in context, never on app open. Denied state is a real screen with recovery steps.
- Singing capture: `echoCancellation:false`, `autoGainControl:false`, `noiseSuppression:false` by default; monitor latency shown honestly; headphones hint once.
- iOS Safari: WAV fallback recorder (`extendable-media-recorder`), Web Audio unlocked on gesture, Media Session for lock screen, no reliance on background playback.
- Performance budgets: mobile LCP < 2.5s, INP < 200ms; recorder, DSP preview and wavesurfer loaded only on routes that need them (`next/dynamic`).
- Skeleton over spinner; optimistic UI for social actions only; every async action has loading, error with retry, and empty states.

## Engineering conventions
- Keep the verified backend (schema, RLS, auth, storage, worker, metrics). Rebuild the experience layer on top of it. Never bypass RLS; admin client only after an RLS/RPC authorization check.
- Server Actions return `{ ok, fieldErrors?, formError?, message?, data? }`; never throw to the client; map rate-limit and moderation errors with `src/lib/moderation/errors.ts`.
- Strict TypeScript, no `any`, no TODO/FIXME, no placeholders, no fake success, no `test.skip`. Zod-validate every input.
- Playback: exactly one global playback store and one `<audio>` (wavesurfer v7 backed). Plays are counted server-side only.
- Terminology from `src/config/terminology.ts`; routes from `src/config/routes.ts`. Never hardcode.
- New dependency only if `docs/research/libraries.md` recommends it or you justify it in your report. Never add: next-pwa, opus-recorder, recordrtc, Storybook, Stripe (Turkey), wavesurfer < 7.
- Migrations: timestamped file + `down/` file; apply to the live project with `npm run db:migrate`; update `src/types/database.ts` and `docs/DATABASE.md`.
- Commits: small, scoped, conventional (`feat(scope): …`), `git add <explicit paths>` only, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never stage `.env.local`, `.omc/`, screenshots outside `docs/`.

## Verification before claiming done
`npm run typecheck && npm run lint && npm run test && npm run build` green; for UI work an isolated Playwright run (`chromium.launch()`, not the shared MCP browser) at 390×844 and 1280×800 with screenshots saved under `docs/qa/<wave>/`; zero console errors and zero failed requests on the golden path; axe has no serious violations; the DESIGN.md §12 list and the mobile checklist are walked explicitly in the report.

## Multi-agent discipline
- Fable (the manager) never writes application code; agents do. Each agent gets explicit file ownership; never edit files owned by a concurrent agent; report needed changes instead.
- Do not use the shared Playwright MCP browser for audits; run your own isolated browser script.
- Do not spawn sub-agents unless the brief says so. Do not wait on background Monitors.
- Report in the shape: what changed, evidence (commands, screenshots), what is not done and why.

## Commands
`npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run e2e` (`E2E_SUPABASE=1` for live), `npm run worker` / `worker:once`, `npm run sidecar`, `npm run db:migrate`, `npm run verify:live`, `npm run check-env`.
