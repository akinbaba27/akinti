/**
 * Wave E PWA verification: service worker registration, manifest validity,
 * the offline fallback, and the Settings push-notification toggle actually
 * writing a `push_subscriptions` row.
 *
 * Runs its own Chromium (never the shared MCP browser, per CLAUDE.md)
 * against a real `next build && next start` on port 3533 (never 3511/3522).
 *
 * Usage:
 *   npm run build
 *   npm run start -- -p 3533
 *   node scripts/qa/wave-e-pwa.mjs [--base http://localhost:3533]
 */

import { execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";

import { requireEnv } from "./_env.mjs";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : "http://localhost:3533";
const OUT = path.join(process.cwd(), "docs", "qa", "waveE-pwa");

const EMAIL = requireEnv("QA_EMAIL");
const PASSWORD = requireEnv("QA_PASSWORD");

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function shoot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
}

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const email = page.locator("#email").first();
  if ((await email.count()) === 0) return false;
  await email.fill(EMAIL);
  await page.locator("#password").first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {}),
    page.getByRole("button", { name: /^log in$/i }).first().click(),
  ]);
  await page.waitForTimeout(2000);
  return !page.url().includes("/login");
}

async function run() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  try {
    await runChecks(browser);
  } finally {
    await browser.close().catch(() => {});
  }

  const failed = results.filter((r) => !r.pass);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
  if (failed.length > 0) process.exitCode = 1;
}

async function runChecks(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["notifications"],
  });
  await context.grantPermissions(["notifications"]);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("console", (msg) => process.stdout.write(`  [console.${msg.type()}] ${msg.text()}\n`));
  page.on("pageerror", (err) => process.stdout.write(`  [pageerror] ${err.message}\n`));

  // Sign in first: the SW-controlled reload and the offline test both need
  // a real, never-redirected authenticated page to test against, and the
  // push toggle needs a session regardless. Doing this first also means the
  // "others"/"pages" runtime cache never gets polluted with a `/login`
  // redirect target the way testing signed-out did.
  const signedIn = await signIn(page);
  record("sign-in", signedIn);
  await context.grantPermissions(["notifications"], { origin: new URL(BASE).origin }).catch(() => {});

  // --- Service worker registration -----------------------------------
  await page.goto(`${BASE}/duets`, { waitUntil: "domcontentloaded" });
  const swSnapshot = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return null;
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.map((r) => ({
      scope: r.scope,
      installing: r.installing?.state ?? null,
      waiting: r.waiting?.state ?? null,
      active: r.active?.state ?? null,
    }));
  });
  process.stdout.write(`  sw registrations right after load: ${JSON.stringify(swSnapshot)}\n`);
  // Wait for full activation (not just "registered") — `navigator.
  // serviceWorker.ready` resolves only once a worker has taken control,
  // which for an 88-file/2.81MB precache can take longer than a flat delay,
  // especially on a machine also running other agents' processes.
  const swState = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return { supported: false };
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 45000)),
    ]);
    return {
      supported: true,
      registered: Boolean(registration),
      scriptURL: registration?.active?.scriptURL ?? null,
    };
  });
  record(
    "service worker registers",
    swState.supported && swState.registered,
    JSON.stringify(swState),
  );
  await shoot(page, "01-duets-sw-registered");

  // The page that triggered registration is never itself controlled by that
  // worker (only subsequent navigations are) — reload so the offline test
  // below actually exercises the SW's fetch handler and fallback.
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  record("page is controlled by the service worker after reload", controlled);

  // --- Manifest ---------------------------------------------------------
  try {
    const manifestRes = await page.request.get(`${BASE}/manifest.webmanifest`);
    const manifestOk = manifestRes.ok();
    const manifest = manifestOk ? await manifestRes.json() : null;
    const manifestValid =
      manifestOk &&
      manifest?.name &&
      manifest?.display === "standalone" &&
      Array.isArray(manifest?.icons) &&
      manifest.icons.some((i) => i.purpose === "maskable") &&
      manifest.icons.some((i) => i.sizes === "192x192") &&
      manifest.icons.some((i) => i.sizes === "512x512");
    record("manifest is valid", Boolean(manifestValid), JSON.stringify(manifest));
  } catch (err) {
    record("manifest is valid", false, String(err));
  }

  // --- Push toggle --------------------------------------------------------
  try {
    let pushRowAppeared = false;
    let pushError = null;
    if (signedIn) {
      await page.goto(`${BASE}/settings/notifications`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      await shoot(page, "03-settings-notifications-before");

      const notificationPermission = await page.evaluate(() =>
        "Notification" in window ? Notification.permission : "unsupported",
      );
      process.stdout.write(`  Notification.permission in page: ${notificationPermission}\n`);

      const pushSwitch = page.getByRole("switch", { name: /push notifications/i }).first();
      const switchVisible = (await pushSwitch.count()) > 0;
      record("push toggle renders", switchVisible);
      const switchEnabled = switchVisible && (await pushSwitch.isEnabled());
      record("push toggle is enabled", switchEnabled, `permission=${notificationPermission}`);

      if (switchEnabled) {
        await pushSwitch.click();
        await page.waitForTimeout(6000).catch(() => {});
        await shoot(page, "04-settings-notifications-after-toggle");
        const toggleError = await page.locator("[role='alert']").first().textContent().catch(() => null);
        if (toggleError) record("push toggle error banner", false, toggleError.trim());

        const admin = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
        );
        const { data: authUsers } = await admin.auth.admin.listUsers();
        const testUser = authUsers?.users?.find((u) => u.email === EMAIL);
        if (testUser) {
          const { data: subs, error } = await admin
            .from("push_subscriptions")
            .select("*")
            .eq("user_id", testUser.id);
          pushError = error?.message ?? null;
          pushRowAppeared = (subs?.length ?? 0) > 0;
        }
      }
    }
    record("push_subscriptions row appears live", pushRowAppeared, pushError ?? "");
  } catch (err) {
    record("push_subscriptions row appears live", false, String(err));
  }

  // --- Offline fallback ---------------------------------------------------
  // Last on purpose: real Windows process kill of whatever is bound to the
  // server port, not Playwright/CDP network emulation. Both
  // `context.setOffline()` and `Network.emulateNetworkConditions` proved
  // unreliable here — the Service Worker's own `fetch()` calls run in a
  // separate execution context/target that neither actually blocks (proven
  // by requests still reaching the real, live `next start` server: a
  // never-visited real route rendered its true content, and a nonexistent
  // path got a genuine 404 from the server — not from any cache). Killing
  // the server outright makes "the network genuinely fails" true for the
  // worker's own fetches too, which is the only way to honestly exercise
  // `fallbacks.entries` in `src/app/sw.ts`.
  try {
    const port = new URL(BASE).port || "80";
    execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));

    let navError = null;
    let navStatus = null;
    try {
      const response = await page.goto(`${BASE}/qa-offline-fallback-probe-${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      navStatus = response?.status() ?? null;
    } catch (err) {
      navError = String(err);
    }
    const offlineText = await page.locator("body").innerText().catch(() => "");
    process.stdout.write(`  offline nav: url=${page.url()} status=${navStatus} error=${navError}\n`);
    record(
      "offline fallback renders",
      offlineText.includes("You're offline"),
      navError ?? offlineText.slice(0, 160),
    );
    await shoot(page, "05-offline-fallback");
  } catch (err) {
    record("offline fallback renders", false, String(err));
  }
}

const watchdog = setTimeout(() => {
  console.error("watchdog: script did not finish within 120s, forcing exit");
  process.exit(1);
}, 120000);

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
