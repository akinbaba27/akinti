/**
 * AKINTI environment validation.
 *
 * Two contexts, because the two processes need different things:
 *
 *  - "web"    — the Next.js app. `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`
 *    only. The app is designed to degrade to an honest "backend not configured"
 *    UI when these are absent (`isSupabaseConfigured()`,
 *    `src/lib/supabase/config.ts` — see `docs/SECURITY.md` "Never a fake
 *    login"), so a missing key is a loud warning, not a crash, EXCEPT in a
 *    real production boot (`NODE_ENV=production`, and either running on
 *    Vercel or `REQUIRE_SUPABASE=1` was set deliberately) — there, a silently
 *    unconfigured backend is exactly the "fake success" spec rule 9 forbids,
 *    so it fails loudly instead.
 *  - "worker" — `scripts/worker.ts`. It cannot do anything useful without a
 *    live Supabase project (`createAdminClient()` needs the URL, and
 *    `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS for job claiming — see
 *    `src/lib/supabase/admin.ts`), so a missing variable is always a hard
 *    failure, in every environment.
 *
 * Used from three places:
 *  1. `npm run check-env` / `npm run check-env:worker` — a manual sanity
 *     check for `.env.local` before `npm run dev` / `npm run worker`.
 *  2. `src/instrumentation.ts` — calls `assertWebEnvAtBoot()` once when the
 *     Next.js server starts (see "Instrumentation" in Next's docs — this
 *     never runs during `next build`, only at `next dev`/`next start` boot).
 *  3. `Dockerfile.worker`'s entrypoint — calls this script with `--worker`
 *     before starting the worker loop, so a missing secret fails the
 *     container immediately with a clear message instead of an obscure crash
 *     on the first claimed job.
 */

const WEB_REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

const WORKER_REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export type EnvContext = "web" | "worker";

export interface EnvCheckResult {
  context: EnvContext;
  required: readonly string[];
  missing: readonly string[];
  ok: boolean;
}

function isSet(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export function checkEnv(context: EnvContext): EnvCheckResult {
  const required = context === "worker" ? WORKER_REQUIRED : WEB_REQUIRED;
  const missing = required.filter((name) => !isSet(name));
  return { context, required, missing, ok: missing.length === 0 };
}

/**
 * Optional feature groups where a HALF-set group is worse than an unset
 * one: each name below only degrades cleanly (a clear "unavailable" error,
 * never a crash — `docs/BILLING.md`, `src/lib/push/send.ts`'s header
 * comment, `src/lib/audio/sidecarPipeline.ts`) when every variable in its
 * group is either all present or all absent. Missing just one silently
 * breaks the feature instead (review3 finding 34) — e.g. without
 * `SIDECAR_URL` the worker defaults to `http://127.0.0.1:8011`
 * (`src/lib/audio/sidecarPipeline.ts`), so on a separately-hosted worker
 * every `pitch_snap`/`self_harmony` job fails and retries forever
 * (`scripts/worker.ts`'s header comment on those two presets having no
 * local fallback).
 */
export const ENV_GROUPS = [
  /*
   * Each billing group includes its provider's MONTHLY plan/price id, because
   * credentials without a plan id is a silently broken checkout in exactly the
   * way this whole check exists to catch: `startCheckout` has everything it
   * needs to talk to the provider and nothing to charge for, and
   * `scripts/seed-plans.ts` refuses to insert a `plans` row without a real id
   * (it will not fabricate one — spec §44 rule 9), so `plans` stays empty and
   * the Pro screen offers no checkout at all.
   *
   * The YEARLY ids are deliberately NOT here. `docs/BILLING.md` is explicit
   * that the annual discount is undecided, so monthly-only is a legitimate
   * steady state and flagging it would be a false alarm.
   */
  {
    name: "iyzico billing",
    vars: ["IYZICO_API_KEY", "IYZICO_SECRET_KEY", "IYZICO_MERCHANT_ID", "IYZICO_PLAN_MONTHLY_TRY"],
  },
  {
    name: "paddle billing",
    vars: [
      "PADDLE_API_KEY",
      "PADDLE_WEBHOOK_SECRET",
      "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN",
      "PADDLE_PRICE_MONTHLY_USD",
    ],
  },
  { name: "web push (VAPID)", vars: ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] },
  { name: "sidecar (separately-hosted worker)", vars: ["SIDECAR_URL", "SIDECAR_TIMEOUT_MS", "SIDECAR_RETRIES"] },
] as const satisfies ReadonlyArray<{ name: string; vars: readonly string[] }>;

export interface EnvGroupCheckResult {
  name: string;
  vars: readonly string[];
  set: readonly string[];
  missing: readonly string[];
  /** True when the group is fully set OR fully unset — false only for a half-set group. */
  ok: boolean;
}

/** Checks every group in `ENV_GROUPS` for "complete or absent" — never called from `assertWebEnvAtBoot`, since a half-set optional group degrades rather than crashing; surfaced instead via the CLI's `--groups`/`--strict-groups` flags. */
export function checkEnvGroups(): EnvGroupCheckResult[] {
  return ENV_GROUPS.map((group) => {
    const set = group.vars.filter(isSet);
    const missing = group.vars.filter((name) => !isSet(name));
    return { name: group.name, vars: group.vars, set, missing, ok: set.length === 0 || missing.length === 0 };
  });
}

function formatMissing(result: EnvCheckResult): string {
  const lines = [
    `[check-env] Missing required environment variable(s) for the ${result.context} context:`,
    ...result.missing.map((name) => `  - ${name}`),
    "See .env.example for the full list, and docs/DEPLOYMENT.md for where each value comes from.",
  ];
  return lines.join("\n");
}

/**
 * True when a missing Supabase key must be treated as a hard failure for the
 * web app: a real production boot, not a preview/dev/CI build with no
 * backend configured yet.
 */
export function requiresSupabaseAtBoot(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    (Boolean(process.env.VERCEL) || process.env.REQUIRE_SUPABASE === "1")
  );
}

/**
 * Called once from `src/instrumentation.ts#register()` at server startup.
 * Never called during `next build`. Warns in dev/unconfigured-production
 * (the app degrades on its own — see `isSupabaseConfigured()`), throws when
 * `requiresSupabaseAtBoot()` is true so a real deployment never silently
 * boots half-configured.
 */
export function assertWebEnvAtBoot(): void {
  const result = checkEnv("web");
  if (result.ok) {
    return;
  }

  const message = formatMissing(result);
  if (requiresSupabaseAtBoot()) {
    console.error(message);
    throw new Error(
      `check-env: refusing to boot in production without ${result.missing.join(", ")}`,
    );
  }

  console.warn(message);
}

/* ------------------------------------------------------------------------ */
/* CLI                                                                       */
/* ------------------------------------------------------------------------ */

function isMainModule(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("check-env.ts") || entry.endsWith("check-env.js");
}

/** `--groups`: report every half-set optional feature group. `--strict-groups` additionally exits 1 if any are found (opt-in — a half-set group degrades rather than crashing, so this is never on by default). */
function runGroupsCli(strict: boolean): boolean {
  const groupResults = checkEnvGroups();
  const halfSet = groupResults.filter((group) => !group.ok);

  if (halfSet.length === 0) {
    console.log("[check-env] optional feature groups: none half-set (each is fully configured or fully unset).");
    return true;
  }

  console.error("\n[check-env] half-set optional feature group(s) — set every variable in the group, or none:");
  for (const group of halfSet) {
    console.error(`  ${group.name}: set ${group.set.join(", ") || "(none)"} — missing ${group.missing.join(", ")}`);
  }
  return !strict;
}

function runCli(): void {
  const context: EnvContext = process.argv.includes("--worker") ? "worker" : "web";
  const strictGroups = process.argv.includes("--strict-groups");
  const checkGroups = strictGroups || process.argv.includes("--groups");

  const result = checkEnv(context);
  const groupsOk = checkGroups ? runGroupsCli(strictGroups) : true;

  if (result.ok) {
    console.log(`[check-env] ${context}: all required environment variables are set.`);
  } else {
    console.error(formatMissing(result));
  }

  if (!result.ok || !groupsOk) {
    process.exit(1);
  }
}

if (isMainModule()) {
  runCli();
}
