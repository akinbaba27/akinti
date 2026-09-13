# TBT re-measurement — Explore only (2026-09-13, follow-up to tbt2)

`docs/qa/tbt2/TBT.md` found Explore's median TBT solidly improved (523ms vs.
the full2 baseline of 1,330ms) but flagged one run at 1,602ms as an
unresolved outlier — worse than Lighthouse's "poor" threshold and close to
the original baseline. This pass asks only one question: is that spike a
real, repeating problem, or host noise that a small sample happened to
catch once. No code changed.

## Method

Same methodology as `docs/qa/tbt2/TBT.md`: own `chromium.launch()` (never
the shared MCP browser), own `npx next start -p 3910` against the existing
production build (`.next`, built 2026-09-09 — postdates both the last `src/`
commit and the Supabase key rotation, so no stale-key rebuild trap this
time), a throwaway account (`e2e+tbt3-*@akinti.test`) created via the
Supabase admin API and onboarded through the real UI, Lighthouse
(`^13.4.1`, Node API) attached over CDP, mobile emulation 390×844,
`throttlingMethod: "devtools"`, performance category only,
`disableStorageReset: true`. 3 runs, Explore only — Flow was already
confirmed stable (3/3 consistent) in tbt2 and isn't in question here. Sole
active process on the host during measurement. Raw JSON per run under
`docs/qa/tbt3/lighthouse/`, summary in `docs/qa/tbt3/results.json`. The
throwaway account was deleted after the run.

## Numbers

| Route | Run | Perf score | TBT | LCP |
|---|---|---|---|---|
| /explore | 1 | 0.83 | 682ms | 1,607ms |
| /explore | 2 | 0.87 | 524ms | 1,707ms |
| /explore | 3 | 0.88 | 476ms | 1,415ms |

Median this pass: 524ms.

### Combined with tbt2 (6 runs total)

| Source | Run | TBT |
|---|---|---|
| tbt2 | 1 | 523ms |
| tbt2 | 2 | **1,602ms** |
| tbt2 | 3 | 326ms |
| tbt3 | 1 | 682ms |
| tbt3 | 2 | 524ms |
| tbt3 | 3 | 476ms |

Sorted: 326, 476, 523, 524, 682, 1,602ms. Median across all 6: **523.5ms**.
Only **1 of 6** runs is above 1,000ms.

## Reading this

- None of the 3 new runs came close to reproducing the 1,602ms spike — the
  worst of this batch (682ms) is still inside the "needs improvement" band
  (<1,000ms poor threshold), not the "poor" band the original outlier hit.
- Across all 6 runs collected on this quiet host (tbt2 + tbt3), only one
  run exceeded 1,000ms. That's consistent with host/scheduler noise
  producing an occasional outlier on an otherwise stable ~500-600ms
  baseline, not a repeating regression — the bar this pass was checking
  against (2+ runs above 1,000ms) was not met.
- **Conclusion: closing this out.** Explore's TBT is treated as settled at
  ~500-600ms median (Lighthouse "needs improvement", not "poor"), a real
  ~2.5x improvement over the full2 baseline (1,330ms). No further TBT work
  planned for Explore unless a future, unrelated change to that route's
  bundle reopens the question.
- `docs/HANDOVER.md` §(a)/(j) P1 #4 updated to reflect this as resolved.

## Environment

Windows, existing production build (`next build`, 2026-09-09), `next start
-p 3910`, sole active process on the host during measurement (no other
agents/dev servers running).
