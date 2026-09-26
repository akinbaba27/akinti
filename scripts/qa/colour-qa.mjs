/**
 * Colour v2 QA (docs/design/COLOR_V2.md implementation pass).
 *
 * Isolated Chromium (never the shared MCP browser), own `next start` server,
 * fake mic flags for Record. Walks the golden path at 390x844 and 1280x800,
 * in both light and dark colour schemes, writes screenshots to
 * docs/qa/colour/, and reports console errors, failed requests and serious
 * axe violations.
 *
 * Usage:
 *   npm run build
 *   npx next start -p 3577 &
 *   node <this file> --base http://localhost:3577
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { requireEnv } from "./_env.mjs";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : "http://localhost:3577";
const OUT = path.join("c:/Users/alppr/akın proje/app", "docs", "qa", "colour");

const EMAIL = requireEnv("QA_EMAIL");
const PASSWORD = requireEnv("QA_PASSWORD");

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
];
const THEMES = ["light", "dark"];

const consoleErrors = [];
const failedRequests = [];
const axeResults = [];
const notReached = [];

function watch(page, label) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Next dev/prod HMR + a known third-party favicon 404 are not product bugs.
    if (text.includes("Failed to load resource") && text.includes("favicon")) return;
    consoleErrors.push({ label, text });
  });
  page.on("pageerror", (error) => {
    consoleErrors.push({ label, text: `pageerror: ${error.message}` });
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    if (failure.includes("ERR_ABORTED")) return;
    failedRequests.push({ label, url: request.url(), failure });
  });
}

async function go(page, url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("load").catch(() => {});
      return true;
    } catch (error) {
      if (attempt === 2) {
        notReached.push({ url, error: String(error) });
        return false;
      }
      await page.waitForTimeout(800);
    }
  }
  return false;
}

async function shoot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  process.stdout.write(`  saved ${name}.png\n`);
}

async function audit(page, label) {
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
}

async function signIn(page) {
  await go(page, `${BASE}/login`);
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

async function walkTheme(browser, viewport, theme) {
  const label = `${viewport.name}-${theme}`;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    colorScheme: theme,
    permissions: ["microphone"],
  });
  const page = await context.newPage();
  watch(page, label);

  process.stdout.write(`\n[${label}] ${viewport.width}x${viewport.height}\n`);

  const signedIn = await signIn(page);
  process.stdout.write(`  signed in: ${signedIn}\n`);

  // --- Home -------------------------------------------------------------
  if (await go(page, `${BASE}/`)) {
    await shoot(page, `${label}-home`);
    await audit(page, `home (${label})`);
  }

  // --- Explore ------------------------------------------------------------
  let waveId = null;
  if (await go(page, `${BASE}/explore`)) {
    await page.waitForTimeout(1000);
    await shoot(page, `${label}-explore`);
    await audit(page, `explore (${label})`);
    const href = await page.locator("a[href^='/w/']").first().getAttribute("href").catch(() => null);
    if (href) waveId = href.split("/w/")[1]?.split(/[/?#]/)[0] ?? null;
  }

  // --- Wave page ----------------------------------------------------------
  if (waveId && (await go(page, `${BASE}/w/${waveId}`))) {
    await page.waitForTimeout(800);
    await shoot(page, `${label}-wave`);
    await audit(page, `wave (${label})`);

    // Persistent player: start playback, then navigate away.
    const playButton = page.getByRole("button", { name: /^play/i }).first();
    if (await playButton.count()) {
      await playButton.click().catch(() => {});
      await page.waitForTimeout(600);
      if (await go(page, `${BASE}/explore`)) {
        await page.waitForTimeout(500);
        await shoot(page, `${label}-persistent-player`);
      }
    }
  } else {
    notReached.push({ url: `${BASE}/w/<id>`, error: "no Wave link found on Explore" });
  }

  // --- Record: idle / armed / live ----------------------------------------
  if (await go(page, `${BASE}/create`)) {
    await page.waitForTimeout(600);
    await shoot(page, `${label}-record-idle`);
    await audit(page, `record idle (${label})`);

    const recordButton = page.getByRole("button", { name: /^record/i }).first();
    if (await recordButton.count()) {
      await recordButton.click().catch(() => {});
      await page.waitForTimeout(500);
      await shoot(page, `${label}-record-armed`);

      // Armed state usually needs a second tap/press-and-hold to go live;
      // try a second click, tolerate it being a no-op.
      await recordButton.click().catch(() => {});
      await page.waitForTimeout(1200);
      await shoot(page, `${label}-record-live`);
    } else {
      notReached.push({ url: `${BASE}/create (record button)`, error: "record control not found" });
    }
  }

  // --- Profile --------------------------------------------------------------
  if (signedIn) {
    const meLink = page.locator("a[href^='/u/']").first();
    let username = await meLink.getAttribute("href").catch(() => null);
    username = username ? username.split("/u/")[1]?.split(/[/?#]/)[0] : null;
    if (username && (await go(page, `${BASE}/u/${username}`))) {
      await page.waitForTimeout(600);
      await shoot(page, `${label}-profile`);
      await audit(page, `profile (${label})`);
    } else {
      notReached.push({ url: `${BASE}/u/<username>`, error: "no profile link found" });
    }
  }

  // --- Challenges -------------------------------------------------------
  if (await go(page, `${BASE}/challenges`)) {
    await page.waitForTimeout(600);
    await shoot(page, `${label}-challenges`);
    await audit(page, `challenges (${label})`);
    const href = await page.locator("a[href^='/challenges/']").first().getAttribute("href").catch(() => null);
    if (href && (await go(page, `${BASE}${href}`))) {
      await page.waitForTimeout(600);
      await shoot(page, `${label}-challenge-detail`);
    }
  }

  // --- Settings -----------------------------------------------------------
  if (await go(page, `${BASE}/settings`)) {
    await page.waitForTimeout(600);
    await shoot(page, `${label}-settings`);
    await audit(page, `settings (${label})`);
  }

  // --- Kit (bonus: the full palette in one screen) ------------------------
  if (await go(page, `${BASE}/kit`)) {
    await page.waitForTimeout(600);
    await shoot(page, `${label}-kit`);
    await audit(page, `kit (${label})`);
  }

  await context.close();
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      await walkTheme(browser, viewport, theme);
    }
  }

  await browser.close();

  const report = { base: BASE, consoleErrors, failedRequests, axeResults, notReached };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  process.stdout.write("\n--- console errors ---\n");
  process.stdout.write(
    consoleErrors.length ? consoleErrors.map((e) => `  [${e.label}] ${e.text}`).join("\n") + "\n" : "  none\n",
  );
  process.stdout.write("--- failed requests ---\n");
  process.stdout.write(
    failedRequests.length
      ? failedRequests.map((r) => `  [${r.label}] ${r.failure} ${r.url}`).join("\n") + "\n"
      : "  none\n",
  );
  process.stdout.write("--- not reached ---\n");
  process.stdout.write(
    notReached.length ? notReached.map((n) => `  ${n.url}: ${n.error}`).join("\n") + "\n" : "  none\n",
  );
  process.stdout.write("--- axe ---\n");
  for (const result of axeResults) {
    process.stdout.write(`  ${result.label}: ${result.total} violations, ${result.serious.length} serious/critical\n`);
    for (const violation of result.serious) {
      process.stdout.write(
        `    ${violation.id} (${violation.impact}) ${violation.help}\n      ${violation.nodes.join("\n      ")}\n`,
      );
    }
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
