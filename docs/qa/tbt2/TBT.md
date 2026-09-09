# TBT re-measurement — Flow / Explore (2026-09-09, follow-up to fixQA2)

`docs/qa/fixQA2/TBT.md` applied a real fix (`WaveCardContainer.tsx`: `ShareSheet`
`next/dynamic` + `hasOpenedShare` gate, commit `f9d03a4`) but its own numbers
came from a host running several concurrent agents, and it explicitly could
not tell fix-effect from run-to-run noise (~2x spread between identical
"after" runs). This is a re-run of the same methodology on a quiet host —
this session was the only agent running against this machine.

## Method

Own `chromium.launch()` (never the shared MCP browser), own
`npm run build` + `npx next start -p 3910`. **Important precondition**: the
build had to be taken *after* today's Supabase key rotation — `NEXT_PUBLIC_*`
vars are inlined at build time everywhere they're referenced, including
server-side code, so a build made before the anon key changed still carries
the old (now-disabled) key baked in and every login fails. Rebuilt, then
proceeded.

A throwaway account (`e2e+tbt2-*@akinti.test`) was created via the Supabase
admin API and onboarded through the real UI (same pattern as
`e2e/helpers/flows.ts`), matching fixQA2's method. Lighthouse (`^13.4.1`,
Node API) attached to that already-authenticated Chromium instance via
`--remote-debugging-port`, `disableStorageReset: true`, mobile emulation
390×844, `throttlingMethod: "devtools"`, performance category only. 3 runs
per route (both routes, no "before" state needed — the fix is already
merged). Raw JSON per run under `docs/qa/tbt2/lighthouse/`, full numbers in
`docs/qa/tbt2/results.json`. The throwaway account was deleted after the run.

## Numbers

| Route | Run | Perf score | TBT | LCP |
|---|---|---|---|---|
| /flow | 1 | 0.96 | 203ms | 1,553ms |
| /flow | 2 | 0.85 | 594ms | 489ms |
| /flow | 3 | 0.97 | 201ms | 279ms |
| /explore | 1 | 0.86 | 523ms | 1,869ms |
| /explore | 2 | 0.73 | 1,602ms | 1,911ms |
| /explore | 3 | 0.93 | 326ms | 1,111ms |

**Medians:** Flow TBT 203ms (full2 baseline: 2,100ms — 10x lower). Explore
TBT 523ms (full2 baseline: 1,330ms — 2.5x lower).

## Reading this

- **Flow**: consistently far under the full2 baseline in every run (worst
  run 594ms vs. baseline 2,100ms). The fix holds.
- **Explore**: median (523ms) is solidly better than baseline and inside
  Lighthouse's "needs improvement" band (<600ms), but one run (1,602ms) is
  worse than the "poor" threshold and close to full2's original number.
  Same variance pattern fixQA2 already flagged (`mainthread-work-breakdown`
  showing ~10-way chunk-split parse overhead) — not reproduced in 2 of 3
  runs here, so most likely still host/scheduler noise rather than a
  regression, but the outlier is real enough that Explore isn't as
  cleanly resolved as Flow. If TBT work continues, this is the next place
  to look (fixQA2's own suggestion: whether Next's automatic code-splitting
  is producing more, smaller chunks than useful here).
- No code was changed this pass — this was measurement only, confirming
  `f9d03a4`'s effect is real for Flow and directionally real but noisier for
  Explore.

## Environment

Windows, `npm run build` (production), `next start -p 3910`, sole active
process on the host during measurement (no other agents/dev servers
running).
