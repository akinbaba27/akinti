/**
 * desktop-screens2 QA: Create/Enhance/Publish, Messages, Settings,
 * Notifications desktop redesign.
 *
 * Isolated Chromium (never the shared MCP browser), own `next start` server
 * (port 3788, separate from the founder's 3333). Real Supabase test account.
 * Screenshots at 1440x900, 1920x1080 and 390x844, dark + light, plus a hover,
 * a toast and a keyboard-hint capture. Writes to docs/qa/desktop-screens2/.
 *
 * Signs in exactly once and reuses that authenticated page for every
 * viewport/theme combination (`setViewportSize`/`emulateMedia` on the same
 * page rather than a fresh browser context + fresh login each time) — a
 * fresh Supabase sign-in per shot is both slow and a real risk of tripping
 * auth rate limiting, which is what made an earlier version of this script
 * hang indefinitely on an uncaught error with the browser left open.
 * Every interaction below is wrapped so a single missing element/timeout
 * can never abort the whole run.
 *
 * Usage:
 *   npx next start -p 3788 &
 *   node scripts/qa/desktop-screens2.mjs --base http://localhost:3788
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { requireEnv } from "./_env.mjs";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : "http://localhost:3788";
const OUT = path.join("c:/Users/alppr/akın proje/app", "docs", "qa", "desktop-screens2");

const EMAIL = requireEnv("QA_EMAIL");
const PASSWORD = requireEnv("QA_PASSWORD");

const DESKTOP_1440 = { name: "1440", width: 1440, height: 900 };
const DESKTOP_1920 = { name: "1920", width: 1920, height: 1080 };
const MOBILE = { name: "390", width: 390, height: 844 };

const consoleErrors = [];
const failedRequests = [];
const axeResults = [];
const notReached = [];
const softErrors = [];

function watch(page, labelRef) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("Failed to load resource") && text.includes("favicon")) return;
    consoleErrors.push({ label: labelRef.current, text });
  });
  page.on("pageerror", (error) => {
    consoleErrors.push({ label: labelRef.current, text: `pageerror: ${error.message}` });
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    if (failure.includes("ERR_ABORTED")) return;
    failedRequests.push({ label: labelRef.current, url: request.url(), failure });
  });
}

async function go(page, url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
      return true;
    } catch (error) {
      if (attempt === 1) {
        notReached.push({ url, error: String(error) });
        return false;
      }
      await page.waitForTimeout(500);
    }
  }
  return false;
}

async function shoot(page, name, fullPage = true) {
  try {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage, timeout: 15000 });
    process.stdout.write(`  saved ${name}.png\n`);
  } catch (error) {
    softErrors.push({ label: name, text: `screenshot failed: ${String(error)}` });
    process.stdout.write(`  ! screenshot failed ${name}: ${String(error).slice(0, 120)}\n`);
  }
}

async function audit(page, label) {
  try {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    axeResults.push({
      label,
      total: results.violations.length,
      serious: serious.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.slice(0, 4).map((node) => node.target.join(" ")),
      })),
    });
  } catch (error) {
    softErrors.push({ label, text: `axe failed: ${String(error)}` });
  }
}

/** Best-effort: never lets a missing element or a slow animation abort the run. */
async function tryHover(page, locator, timeout = 5000) {
  try {
    if ((await locator.count()) === 0) return false;
    await locator.first().hover({ timeout });
    return true;
  } catch (error) {
    softErrors.push({ label: "hover", text: String(error).slice(0, 200) });
    return false;
  }
}

async function tryClick(page, locator, timeout = 5000) {
  try {
    if ((await locator.count()) === 0) return false;
    await locator.first().click({ timeout });
    return true;
  } catch (error) {
    softErrors.push({ label: "click", text: String(error).slice(0, 200) });
    return false;
  }
}

async function signIn(page) {
  await go(page, `${BASE}/login`);
  const email = page.locator("#email").first();
  if ((await email.count()) === 0) return false;
  await email.fill(EMAIL);
  await page.locator("#password").first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}),
    page.getByRole("button", { name: /^log in$/i }).first().click(),
  ]);
  await page.waitForTimeout(1500);
  return !page.url().includes("/login");
}

/** Changes viewport + color scheme on the SAME authenticated page — no new context, no new login. */
async function setStage(page, viewport, theme) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.emulateMedia({ colorScheme: theme });
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    await main(browser);
  } finally {
    // Guarantees the browser (and every chrome-headless-shell child process
    // it owns) always exits, even if a step above threw past its own
    // try/catch — an earlier version of this script left an open browser
    // connected after an uncaught error, which kept the whole Node process
    // alive indefinitely at idle CPU with nothing left to do.
    await browser.close().catch(() => {});
  }
}

async function main(browser) {
  const context = await browser.newContext({ deviceScaleFactor: 2, permissions: ["microphone"] });
  const page = await context.newPage();
  const labelRef = { current: "init" };
  watch(page, labelRef);

  await setStage(page, DESKTOP_1440, "dark");
  const signedIn = await signIn(page);
  process.stdout.write(`signed in: ${signedIn}\n`);

  // -----------------------------------------------------------------------
  // 1) Messages
  // -----------------------------------------------------------------------
  labelRef.current = "messages-1440-dark";
  if (await go(page, `${BASE}/messages`)) {
    await page.waitForTimeout(600);
    await shoot(page, labelRef.current);
    await audit(page, labelRef.current);

    const row = page.locator("main a[href^='/messages/']").first();
    if (await tryHover(page, row)) {
      await shoot(page, `${labelRef.current}-hover`);
      if (await tryClick(page, row)) {
        await page.waitForTimeout(600);
        await shoot(page, "messages-thread-1440-dark");
      }
    }
  }

  labelRef.current = "messages-1920-dark";
  await setStage(page, DESKTOP_1920, "dark");
  if (await go(page, `${BASE}/messages`)) {
    await page.waitForTimeout(500);
    await shoot(page, labelRef.current);
  }

  labelRef.current = "messages-390-dark";
  await setStage(page, MOBILE, "dark");
  if (await go(page, `${BASE}/messages`)) {
    await page.waitForTimeout(500);
    await shoot(page, labelRef.current);
    await audit(page, labelRef.current);
  }

  labelRef.current = "messages-1440-light";
  await setStage(page, DESKTOP_1440, "light");
  if (await go(page, `${BASE}/messages`)) {
    await page.waitForTimeout(500);
    await shoot(page, labelRef.current);
  }

  // -----------------------------------------------------------------------
  // 2) Notifications
  // -----------------------------------------------------------------------
  labelRef.current = "notifications-1440-dark";
  await setStage(page, DESKTOP_1440, "dark");
  if (await go(page, `${BASE}/notifications`)) {
    await page.waitForTimeout(500);
    await shoot(page, labelRef.current);
    await audit(page, labelRef.current);

    const row = page.locator("main ul li").first();
    if (await tryHover(page, row)) {
      await shoot(page, `${labelRef.current}-hover`);
    }

    const markAll = page.getByRole("button", { name: /mark all as read/i }).first();
    if (await tryClick(page, markAll)) {
      await page.waitForTimeout(400);
      await shoot(page, `${labelRef.current}-toast`);
    }

    const playButton = page.getByRole("button", { name: /play this wave/i }).first();
    if (await tryClick(page, playButton)) {
      await page.waitForTimeout(700);
      await shoot(page, `${labelRef.current}-inline-play`);
    }
  }

  labelRef.current = "notifications-1920-dark";
  await setStage(page, DESKTOP_1920, "dark");
  if (await go(page, `${BASE}/notifications`)) {
    await page.waitForTimeout(500);
    await shoot(page, labelRef.current);
  }

  labelRef.current = "notifications-390-dark";
  await setStage(page, MOBILE, "dark");
  if (await go(page, `${BASE}/notifications`)) {
    await page.waitForTimeout(500);
    await shoot(page, labelRef.current);
    await audit(page, labelRef.current);
  }

  labelRef.current = "notifications-1440-light";
  await setStage(page, DESKTOP_1440, "light");
  if (await go(page, `${BASE}/notifications`)) {
    await page.waitForTimeout(500);
    await shoot(page, labelRef.current);
  }

  // -----------------------------------------------------------------------
  // 3) Settings — hub, appearance (live preview), pro (card row)
  // -----------------------------------------------------------------------
  labelRef.current = "settings-hub-1440-dark";
  await setStage(page, DESKTOP_1440, "dark");
  if (await go(page, `${BASE}/settings`)) {
    await page.waitForTimeout(400);
    await shoot(page, labelRef.current);
    await audit(page, labelRef.current);

    const navItem = page.locator("nav a[href='/settings/appearance']").first();
    if (await tryHover(page, navItem)) {
      await shoot(page, `settings-nav-1440-dark-hover`);
    }
  }
  if (await go(page, `${BASE}/settings/appearance`)) {
    await page.waitForTimeout(400);
    await shoot(page, "settings-appearance-1440-dark");
    await audit(page, "settings-appearance-1440-dark");
  }
  if (await go(page, `${BASE}/settings/pro`)) {
    await page.waitForTimeout(400);
    await shoot(page, "settings-pro-1440-dark");
    await audit(page, "settings-pro-1440-dark");
  }

  labelRef.current = "settings-hub-1920-dark";
  await setStage(page, DESKTOP_1920, "dark");
  if (await go(page, `${BASE}/settings`)) {
    await page.waitForTimeout(400);
    await shoot(page, labelRef.current);
  }
  if (await go(page, `${BASE}/settings/pro`)) {
    await page.waitForTimeout(400);
    await shoot(page, "settings-pro-1920-dark");
  }

  labelRef.current = "settings-hub-390-dark";
  await setStage(page, MOBILE, "dark");
  if (await go(page, `${BASE}/settings`)) {
    await page.waitForTimeout(400);
    await shoot(page, labelRef.current);
    await audit(page, labelRef.current);
  }
  if (await go(page, `${BASE}/settings/pro`)) {
    await page.waitForTimeout(400);
    await shoot(page, "settings-pro-390-dark");
  }

  labelRef.current = "settings-hub-1440-light";
  await setStage(page, DESKTOP_1440, "light");
  if (await go(page, `${BASE}/settings`)) {
    await page.waitForTimeout(400);
    await shoot(page, labelRef.current);
  }
  if (await go(page, `${BASE}/settings/appearance`)) {
    await page.waitForTimeout(400);
    await shoot(page, "settings-appearance-1440-light");
  }

  // -----------------------------------------------------------------------
  // 4) Create — record stage, upload dropzone
  // -----------------------------------------------------------------------
  labelRef.current = "create-record-1440-dark";
  await setStage(page, DESKTOP_1440, "dark");
  if (await go(page, `${BASE}/create`)) {
    await page.waitForTimeout(700);
    await shoot(page, labelRef.current);
    await audit(page, labelRef.current);

    const recordKey = page.getByRole("button", { name: /arm the microphone|start recording/i }).first();
    if (await tryHover(page, recordKey)) {
      await shoot(page, `${labelRef.current}-hover`);
    }

    const uploadInstead = page.getByRole("button", { name: /upload a file instead|upload instead/i }).first();
    if (await tryClick(page, uploadInstead)) {
      await page.waitForTimeout(400);
      await shoot(page, "create-upload-1440-dark");
    }
  }

  labelRef.current = "create-record-1920-dark";
  await setStage(page, DESKTOP_1920, "dark");
  if (await go(page, `${BASE}/create`)) {
    await page.waitForTimeout(700);
    await shoot(page, labelRef.current);
  }

  labelRef.current = "create-record-390-dark";
  await setStage(page, MOBILE, "dark");
  if (await go(page, `${BASE}/create`)) {
    await page.waitForTimeout(700);
    await shoot(page, labelRef.current);
    await audit(page, labelRef.current);
  }

  labelRef.current = "create-record-1440-light";
  await setStage(page, DESKTOP_1440, "light");
  if (await go(page, `${BASE}/create`)) {
    await page.waitForTimeout(700);
    await shoot(page, labelRef.current);
  }

  await context.close().catch(() => {});

  const report = { base: BASE, consoleErrors, failedRequests, axeResults, notReached, softErrors };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  process.stdout.write(`\n\nconsole errors: ${consoleErrors.length}\n`);
  for (const entry of consoleErrors) process.stdout.write(`  [${entry.label}] ${entry.text}\n`);
  process.stdout.write(`failed requests: ${failedRequests.length}\n`);
  for (const entry of failedRequests) process.stdout.write(`  [${entry.label}] ${entry.url} — ${entry.failure}\n`);
  process.stdout.write(`not reached: ${notReached.length}\n`);
  for (const entry of notReached) process.stdout.write(`  ${entry.url}\n`);
  process.stdout.write(`soft errors (non-fatal): ${softErrors.length}\n`);
  for (const entry of softErrors) process.stdout.write(`  [${entry.label}] ${entry.text}\n`);
  process.stdout.write(`\naxe serious/critical violations:\n`);
  for (const entry of axeResults) {
    if (entry.serious.length === 0) continue;
    process.stdout.write(`  [${entry.label}] ${entry.serious.length}\n`);
    for (const violation of entry.serious) {
      process.stdout.write(`    ${violation.id} (${violation.impact}): ${violation.help}\n`);
      for (const node of violation.nodes) process.stdout.write(`      ${node}\n`);
    }
  }
  process.stdout.write("\ndone.\n");
}

// Last-resort watchdog: every individual step above already has its own
// short timeout, but if something still hangs (a stray unbounded await),
// this forces the process to exit rather than sitting idle forever with an
// open browser — exactly the failure mode that cost this script's first
// version a long silent hang.
const watchdog = setTimeout(() => {
  console.error("desktop-screens2 QA: watchdog timeout (10 min) — forcing exit.");
  process.exit(1);
}, 10 * 60 * 1000);
watchdog.unref?.();

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
