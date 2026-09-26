/**
 * desktop-screens3 QA: Challenges, Tracks, Duets (partial), Search, Analytics
 * desktop redesign.
 *
 * Isolated Chromium (never the shared MCP browser), own `next start` server
 * (port 3799, separate from the founder's 3333). Real Supabase test account.
 * Screenshots at 1440x900, 1920x1080 and 390x844, dark + light, plus a hover
 * and the Analytics chart. Writes to docs/qa/desktop-screens3/.
 *
 * Usage:
 *   npx next start -p 3799 &
 *   node scripts/qa/desktop-screens3.mjs --base http://localhost:3799
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : "http://localhost:3799";
const OUT = path.join("c:/Users/alppr/akın proje/app", "docs", "qa", "desktop-screens3");

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

const DESKTOP_1440 = { name: "1440", width: 1440, height: 900 };
const DESKTOP_1920 = { name: "1920", width: 1920, height: 1080 };
const MOBILE = { name: "390", width: 390, height: 844 };

const consoleErrors = [];
const failedRequests = [];
const axeResults = [];
const notReached = [];
const notes = [];

function watch(page, label) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
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

async function shoot(page, name, fullPage = true) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
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

async function newPage(browser, viewport, theme) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  const page = await context.newPage();
  const label = `${viewport.name}-${theme}`;
  watch(page, label);
  const signedIn = await signIn(page);
  process.stdout.write(`\n[${label}] ${viewport.width}x${viewport.height} signed in: ${signedIn}\n`);
  return { context, page, label };
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ---------------------------------------------------------------------
  // 1) Challenges — list/hero grid, detail two-column, hashtag grid
  // ---------------------------------------------------------------------
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1440, "dark");
    if (await go(page, `${BASE}/challenges`)) {
      await page.waitForTimeout(600);
      await shoot(page, `challenges-${label}`);
      await audit(page, `challenges (${label})`);

      const heroCard = page.locator("article a[href^='/challenges/']").first();
      if (await heroCard.count()) {
        await heroCard.hover();
        await page.waitForTimeout(200);
        await shoot(page, `challenges-${label}-hover`);
      }

      const anyChallengeLink = page.locator("a[href^='/challenges/']").first();
      if (await anyChallengeLink.count()) {
        const href = await anyChallengeLink.getAttribute("href");
        if (await go(page, `${BASE}${href}`)) {
          await page.waitForTimeout(600);
          await shoot(page, `challenge-detail-${label}`);
          await audit(page, `challenge detail (${label})`);
        }
      } else {
        notes.push("No live/upcoming/ended challenge exists to open a detail page — /challenges rendered its empty state.");
      }
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1920, "dark");
    if (await go(page, `${BASE}/challenges`)) {
      await page.waitForTimeout(600);
      await shoot(page, `challenges-${label}`);
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, MOBILE, "dark");
    if (await go(page, `${BASE}/challenges`)) {
      await page.waitForTimeout(600);
      await shoot(page, `challenges-${label}`);
      await audit(page, `challenges (${label})`);
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1440, "light");
    if (await go(page, `${BASE}/challenges`)) {
      await page.waitForTimeout(600);
      await shoot(page, `challenges-${label}`);
    }
    await context.close();
  }

  // Hashtag grid — try #pop as a reasonably common seeded tag, note if empty.
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1440, "dark");
    if (await go(page, `${BASE}/hashtag/pop`)) {
      await page.waitForTimeout(600);
      await shoot(page, `hashtag-${label}`);
      await audit(page, `hashtag (${label})`);
    }
    await context.close();
  }

  // ---------------------------------------------------------------------
  // 2) Tracks — filterable grid, hover play, sing-over-this
  // ---------------------------------------------------------------------
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1440, "dark");
    if (await go(page, `${BASE}/tracks`)) {
      await page.waitForTimeout(600);
      await shoot(page, `tracks-${label}`);
      await audit(page, `tracks (${label})`);

      const card = page.locator("article").first();
      if (await card.count()) {
        await card.hover();
        await page.waitForTimeout(200);
        await shoot(page, `tracks-${label}-hover`);
      }
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1920, "dark");
    if (await go(page, `${BASE}/tracks`)) {
      await page.waitForTimeout(600);
      await shoot(page, `tracks-${label}`);
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, MOBILE, "dark");
    if (await go(page, `${BASE}/tracks`)) {
      await page.waitForTimeout(600);
      await shoot(page, `tracks-${label}`);
      await audit(page, `tracks (${label})`);
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1440, "light");
    if (await go(page, `${BASE}/tracks`)) {
      await page.waitForTimeout(600);
      await shoot(page, `tracks-${label}`);
    }
    await context.close();
  }

  // ---------------------------------------------------------------------
  // 3) Duets — mode picker cards (needs an accepted request), requests
  //    two-pane inbox
  // ---------------------------------------------------------------------
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1440, "dark");
    if (await go(page, `${BASE}/duets`)) {
      await page.waitForTimeout(600);
      await shoot(page, `duets-${label}`);
      await audit(page, `duets (${label})`);

      const row = page.locator("button[aria-current]").first();
      if (await row.count()) {
        await row.hover();
        await page.waitForTimeout(200);
        await shoot(page, `duets-${label}-hover`);
      }

      const recordLink = page.getByRole("link", { name: /record your duet/i }).first();
      if (await recordLink.count()) {
        const href = await recordLink.getAttribute("href");
        if (href && (await go(page, `${BASE}${href}`))) {
          await page.waitForTimeout(600);
          await shoot(page, `duet-mode-picker-${label}`);
          await audit(page, `duet mode picker (${label})`);
        }
      } else {
        notes.push("No accepted Duet Request with a pending recording exists — could not reach the mode-picker cards screen.");
      }
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, MOBILE, "dark");
    if (await go(page, `${BASE}/duets`)) {
      await page.waitForTimeout(600);
      await shoot(page, `duets-${label}`);
      await audit(page, `duets (${label})`);
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1440, "light");
    if (await go(page, `${BASE}/duets`)) {
      await page.waitForTimeout(600);
      await shoot(page, `duets-${label}`);
    }
    await context.close();
  }

  // ---------------------------------------------------------------------
  // 4) Search — tabs, chips, keyboard nav
  // ---------------------------------------------------------------------
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1440, "dark");
    if (await go(page, `${BASE}/search`)) {
      await page.waitForTimeout(500);
      await shoot(page, `search-empty-${label}`);
    }
    if (await go(page, `${BASE}/search?q=a`)) {
      await page.waitForTimeout(900);
      await shoot(page, `search-results-${label}`);
      await audit(page, `search results (${label})`);

      const tab = page.getByRole("tab").nth(1);
      if (await tab.count()) {
        await tab.focus();
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(300);
        await shoot(page, `search-results-${label}-tab-keyboard`);
      }
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1920, "dark");
    if (await go(page, `${BASE}/search?q=a`)) {
      await page.waitForTimeout(900);
      await shoot(page, `search-results-${label}`);
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, MOBILE, "dark");
    if (await go(page, `${BASE}/search?q=a`)) {
      await page.waitForTimeout(900);
      await shoot(page, `search-results-${label}`);
      await audit(page, `search results (${label})`);
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1440, "light");
    if (await go(page, `${BASE}/search?q=a`)) {
      await page.waitForTimeout(900);
      await shoot(page, `search-results-${label}`);
    }
    await context.close();
  }

  // ---------------------------------------------------------------------
  // 5) Analytics — KPI tiles, chart, segmented range switcher
  // ---------------------------------------------------------------------
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1440, "dark");
    if (await go(page, `${BASE}/analytics`)) {
      await page.waitForTimeout(700);
      await shoot(page, `analytics-${label}`);
      await audit(page, `analytics (${label})`);

      const rangeButton = page.getByRole("button", { name: /30 days/i }).first();
      if (await rangeButton.count()) {
        await rangeButton.hover();
        await page.waitForTimeout(200);
        await shoot(page, `analytics-${label}-range-hover`);
      }
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1920, "dark");
    if (await go(page, `${BASE}/analytics`)) {
      await page.waitForTimeout(700);
      await shoot(page, `analytics-${label}`);
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, MOBILE, "dark");
    if (await go(page, `${BASE}/analytics`)) {
      await page.waitForTimeout(700);
      await shoot(page, `analytics-${label}`);
      await audit(page, `analytics (${label})`);
    }
    await context.close();
  }
  {
    const { context, page, label } = await newPage(browser, DESKTOP_1440, "light");
    if (await go(page, `${BASE}/analytics`)) {
      await page.waitForTimeout(700);
      await shoot(page, `analytics-${label}`);
    }
    await context.close();
  }

  await browser.close();

  const report = { base: BASE, consoleErrors, failedRequests, axeResults, notReached, notes };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  process.stdout.write(`\n\nconsole errors: ${consoleErrors.length}\n`);
  for (const entry of consoleErrors) process.stdout.write(`  [${entry.label}] ${entry.text}\n`);
  process.stdout.write(`failed requests: ${failedRequests.length}\n`);
  for (const entry of failedRequests) process.stdout.write(`  [${entry.label}] ${entry.url} — ${entry.failure}\n`);
  process.stdout.write(`not reached: ${notReached.length}\n`);
  for (const entry of notReached) process.stdout.write(`  ${entry.url}\n`);
  process.stdout.write(`notes: ${notes.length}\n`);
  for (const entry of notes) process.stdout.write(`  ${entry}\n`);
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

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
