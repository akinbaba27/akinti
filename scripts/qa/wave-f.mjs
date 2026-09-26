/**
 * Wave F (AKINTI Pro) QA: the settings/pro screen states, the ink Pro mark,
 * and the Enhance paywall moment.
 *
 * Runs its own Chromium (never the shared MCP browser, per CLAUDE.md)
 * against a real `next build && next start` on port 3599 (never 3333, the
 * founder's own dev server; never 3588). Creates one throwaway auth user +
 * a throwaway `plans` row + one `subscriptions` row with the service role
 * to exercise the active state and the Pro mark, then deletes all three in
 * a `finally` block.
 *
 * Usage:
 *   npm run build
 *   npm run start -- -p 3599
 *   node --env-file=.env.local scripts/qa/wave-f.mjs [--base http://localhost:3599]
 */

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : "http://localhost:3599";
const OUT = path.join(process.cwd(), "docs", "qa", "waveF");
const TONE_WAV = path.join(process.cwd(), "e2e", "fixtures", "tone.wav");

/**
 * Credentials come from the environment only. The shared QA account's password
 * used to be a literal fallback in every script in this folder, which put a
 * real, working credential in the repo (and in git history). Fail fast with an
 * instruction instead, so a missing variable is an obvious setup error rather
 * than a silent fall back to a committed secret.
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`${name} is required. Set QA_EMAIL and QA_PASSWORD for the shared QA account before running this script.
`);
    process.exit(1);
  }
  return value;
}

const EMAIL = requireEnv("QA_EMAIL");
const PASSWORD = requireEnv("QA_PASSWORD");

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
];

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

const consoleErrors = [];
function watch(page, label) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    consoleErrors.push({ label, text: message.text() });
  });
  page.on("pageerror", (error) => {
    consoleErrors.push({ label, text: `pageerror at ${page.url()}: ${error.message}\n${error.stack ?? ""}` });
  });
}

async function go(page, url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("load").catch(() => {});
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(800);
    }
  }
}

async function shoot(page, name) {
  await page.waitForTimeout(500);
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  process.stdout.write(`  saved ${name}.png\n`);
}

const axeResults = [];
async function audit(page, label) {
  const analysis = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = analysis.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  axeResults.push({ label, total: analysis.violations.length, serious: serious.map((v) => v.id) });
  record(`${label}: axe clean (serious/critical)`, serious.length === 0, serious.map((v) => v.id).join(", "));
}

async function signIn(page, email, password) {
  await go(page, `${BASE}/login`);
  const email_ = page.locator("#email").first();
  if ((await email_.count()) === 0) return false;
  await email_.fill(email);
  await page.locator("#password").first().fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {}),
    page.getByRole("button", { name: /^log in$/i }).first().click(),
  ]);
  await page.waitForTimeout(2000);
  return !page.url().includes("/login");
}

/** capture -> upload a fixture WAV -> review -> enhance. All client-side, no upload to storage needed. */
/** An uploaded file skips "review" entirely (`CreateFlow.tsx#handleUploaded` goes straight to `setStep("enhance")`) — no Continue click needed to arrive. */
async function reachEnhanceStage(page) {
  await go(page, `${BASE}/create`);
  const uploadToggle = page.getByRole("button", { name: /upload a file/i }).first();
  if ((await uploadToggle.count()) > 0) {
    await uploadToggle.click().catch(() => {});
  }
  const fileInput = page.locator('input[type="file"]').first();
  if ((await fileInput.count()) === 0) return false;
  await fileInput.setInputFiles(TONE_WAV);
  await page.waitForTimeout(800);

  return (await page.getByText(/pitch snap/i).count()) > 0;
}

async function throwawaySubscriptionFixture(admin) {
  const email = `wavef-qa-${randomUUID()}@akinti.internal`;
  const password = `Qa-${randomUUID()}!1`;
  const username = `wavefqa${Date.now()}`;

  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: "Wave F QA" },
  });
  if (userError || !created?.user) {
    throw new Error(`throwaway user creation failed: ${userError?.message ?? "no user"}`);
  }
  const userId = created.user.id;

  // handle_new_user() (migration 02) inserts the profiles row synchronously;
  // mark it onboarded so src/lib/supabase/middleware.ts's proxy gate lets it
  // reach a protected route at all.
  await admin.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", userId);

  // A throwaway `plans` row — `subscriptions.plan_id` is a NOT NULL FK, and
  // this dev environment has no real seeded plan yet (`scripts/seed-plans.ts`
  // has not been run). Reuse a real seeded row instead of inserting a
  // second one if one already exists, since `plans.code` is unique.
  const { data: existingPlan } = await admin
    .from("plans")
    .select("id")
    .eq("code", "pro_monthly_usd")
    .maybeSingle();

  let planId = existingPlan?.id ?? null;
  let createdPlan = false;
  if (!planId) {
    const { data: plan, error: planError } = await admin
      .from("plans")
      .insert({
        code: "pro_monthly_usd",
        provider: "paddle",
        provider_price_id: "qa_throwaway_price_wavef",
        amount: 499,
        currency: "USD",
        interval: "month",
      })
      .select("id")
      .single();
    if (planError || !plan) {
      throw new Error(`throwaway plan creation failed: ${planError?.message ?? "no plan"}`);
    }
    planId = plan.id;
    createdPlan = true;
  }

  const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: subscription, error: subError } = await admin
    .from("subscriptions")
    .insert({
      user_id: userId,
      plan_id: planId,
      provider: "paddle",
      provider_subscription_id: `qa_throwaway_sub_${randomUUID()}`,
      status: "active",
      current_period_end: currentPeriodEnd,
    })
    .select("id")
    .single();
  if (subError || !subscription) {
    throw new Error(`throwaway subscription creation failed: ${subError?.message ?? "no row"}`);
  }

  return {
    userId,
    username,
    email,
    password,
    planId,
    createdPlan,
    subscriptionId: subscription.id,
    currentPeriodEnd,
    async cleanup() {
      await admin.from("subscriptions").delete().eq("id", subscription.id);
      if (createdPlan) await admin.from("plans").delete().eq("id", planId);
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    },
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set (run with --env-file=.env.local).");
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const browser = await chromium.launch();
  let fixture = null;

  try {
    for (const viewport of VIEWPORTS) {
      // Force en-US: this machine's own OS/browser locale is Turkish, which
      // `detectProCurrency()` (`src/components/pro/pricing.ts`) correctly
      // reads as TRY — real, intended behaviour, not a bug — but the honest
      // "payments not set up yet" state only shows for the USD/Paddle path,
      // so it needs an explicit non-Turkish locale to exercise here.
      const context = await browser.newContext({ viewport, locale: "en-US" });
      const page = await context.newPage();
      watch(page, viewport.name);
      page.setDefaultTimeout(15000);

      const signedIn = await signIn(page, EMAIL, PASSWORD);
      record(`${viewport.name}: sign in as the existing QA account`, signedIn);
      if (signedIn) {
        await go(page, `${BASE}/settings/pro`);
        await shoot(page, `${viewport.name}-01-not-subscribed`);

        const startPro = await page.getByRole("button", { name: /^start pro$/i }).count();
        const notSetUp = await page.getByText(/payments are not set up yet/i).count();
        record(`${viewport.name}: not-subscribed screen renders`, startPro > 0 || notSetUp > 0);
        // No PADDLE env vars are set in this environment, so a USD (default
        // browser locale) visitor should see the honest "not set up" state,
        // never a broken Start Pro key.
        record(`${viewport.name}: honest "payments not set up yet" state`, notSetUp > 0);
        await audit(page, `${viewport.name}-not-subscribed`);

        const reachedEnhance = await reachEnhanceStage(page);
        record(`${viewport.name}: reached Enhance stage with the two Pro sounds listed`, reachedEnhance);
        if (reachedEnhance) {
          await page.getByText(/pitch snap/i).first().click();
          await page.waitForTimeout(400);
          const sheetVisible = await page.getByRole("dialog").filter({ hasText: "AKINTI Pro" }).count();
          record(`${viewport.name}: tapping a Pro sound opens the ProGate sheet`, sheetVisible > 0);
          await shoot(page, `${viewport.name}-02-enhance-pro-sheet`);
          if (sheetVisible > 0) await audit(page, `${viewport.name}-enhance-pro-sheet`);
        }
      }

      await context.close();
    }

    // --- Active state + Pro mark, throwaway user (desktop viewport) -------
    fixture = await throwawaySubscriptionFixture(admin);
    record("throwaway user + plan + subscription created", true, fixture.userId);

    const context = await browser.newContext({ viewport: VIEWPORTS[1] });
    const page = await context.newPage();
    watch(page, "throwaway");
    page.setDefaultTimeout(15000);

    const throwawaySignedIn = await signIn(page, fixture.email, fixture.password);
    record("throwaway user: sign in", throwawaySignedIn);

    if (throwawaySignedIn) {
      await go(page, `${BASE}/settings/pro`);
      await shoot(page, "desktop-03-active");
      const rendersActive = await page.getByText(/renews on/i).count();
      const cancelKey = await page.getByRole("button", { name: /cancel at period end/i }).count();
      record("active state: shows a renewal date and Cancel at period end", rendersActive > 0 && cancelKey > 0);
      await audit(page, "active-state");

      await go(page, `${BASE}/u/${fixture.username}`);
      await shoot(page, "desktop-04-profile-pro-mark");
      const proMark = await page.getByTitle("AKINTI Pro").count();
      record("Pro mark renders on the throwaway user's own profile", proMark > 0);
      await audit(page, "profile-pro-mark");
    }

    await context.close();
  } finally {
    if (fixture) {
      await fixture.cleanup();
      process.stdout.write(`cleaned up throwaway user ${fixture.userId}\n`);
    }
    await browser.close().catch(() => {});
  }

  process.stdout.write("\n--- console errors ---\n");
  for (const entry of consoleErrors) process.stdout.write(`[${entry.label}] ${entry.text}\n`);
  record("zero console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} logged`);

  process.stdout.write("\n--- axe ---\n");
  for (const entry of axeResults) {
    process.stdout.write(`${entry.label}: ${entry.total} total, serious/critical: ${entry.serious.join(", ") || "none"}\n`);
  }

  const failed = results.filter((r) => !r.pass);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[wave-f qa] fatal error:", err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
