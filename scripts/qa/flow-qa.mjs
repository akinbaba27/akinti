/**
 * Flow QA (docs/FLOW.md).
 *
 * Isolated Chromium (never the shared MCP browser), own `next start` server,
 * fake mic flags, real Supabase, the shared QA account. Walks the golden
 * path at 390x844 (touch) and 1280x800 (desktop), writes screenshots and a
 * short screen recording to docs/qa/flow/, and reports console errors,
 * failed requests and serious axe violations.
 *
 * Usage:
 *   npm run build
 *   npx next start -p 3588 &
 *   node scripts/qa/flow-qa.mjs --base http://localhost:3588
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : "http://localhost:3588";
const ROOT = "c:/Users/alppr/akın proje/app";
const OUT = path.join(ROOT, "docs", "qa", "flow");

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

const consoleErrors = [];
const failedRequests = [];
const axeResults = [];
const notReached = [];
const findings = [];

function note(label, ok, detail) {
  findings.push({ label, ok, detail });
  process.stdout.write(`  [${ok ? "OK" : "FAIL"}] ${label}${detail ? " -- " + detail : ""}\n`);
}

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

async function shoot(page, name) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
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

/** Canvas pixel hash — cheap proxy for "did the trace repaint". */
async function traceHash(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-flow-trace] canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]) >>> 0;
    return hash;
  });
}

async function currentWaveTitle(page) {
  return page.locator('[data-flow-active="true"] h1').first().textContent().catch(() => null);
}

async function walk(browser, viewport, kind) {
  const label = `${viewport.name}`;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    permissions: ["microphone"],
    hasTouch: kind === "touch",
    isMobile: kind === "touch",
    recordVideo: { dir: OUT, size: { width: viewport.width, height: viewport.height } },
  });
  const page = await context.newPage();
  watch(page, label);

  process.stdout.write(`\n[${label}] ${viewport.width}x${viewport.height} (${kind})\n`);

  const signedIn = await signIn(page);
  note(`${label}: sign in`, signedIn);

  if (!(await go(page, `${BASE}/flow`))) {
    note(`${label}: navigate to /flow`, false);
    await context.close();
    return;
  }
  await shoot(page, `${label}-01-initial`);

  const emptyState = await page.getByText(/Nothing new to play yet|Flow couldn't load/).count();
  if (emptyState > 0) {
    note(`${label}: renders empty/error state (no candidates for this account)`, true);
    await audit(page, `${label} empty state`);
    await context.close();
    return;
  }

  const hasTrace = (await page.locator("[data-flow-trace]").count()) > 0;
  note(`${label}: Flow renders a Wave with a trace`, hasTrace);
  if (!hasTrace) {
    await context.close();
    return;
  }

  const titleBefore = await currentWaveTitle(page);
  const active = () => page.locator('[data-flow-active="true"]');

  // First gesture: tap the transport to start listening (no autoplay without a gesture).
  const transport = active().getByRole("button", { name: /Tap to start listening|^Play$/ }).first();
  await transport.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const startedLabel = await active().getByRole("button", { name: /^Pause$/ }).count();
  note(`${label}: first gesture starts audio (transport shows Pause)`, startedLabel > 0);

  const hashA = await traceHash(page);
  await page.waitForTimeout(400);
  const hashB = await traceHash(page);
  note(`${label}: trace repaints while playing (canvas pixels changed between frames)`, hashA !== null && hashA !== hashB, `${hashA} -> ${hashB}`);

  await shoot(page, `${label}-02-playing`);

  // Swipe up to advance (mouse-drag exercises the same Pointer Event path a
  // touch swipe does). The INP-style budget is measured from the pointerup
  // that actually decides the swipe to the DOM reflecting the new active
  // Wave — not from the start of the synthetic drag, which itself takes
  // longer than 200ms to dispatch through Playwright and would measure the
  // test harness, not the app.
  const box = await page.locator('[role="region"][aria-label="Flow"]').first().boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const startY = box.y + box.height * 0.8;
    const endY = box.y + box.height * 0.1;

    await page.evaluate(() => {
      window.__flowSwipeAt = null;
      document
        .querySelector('[role="region"][aria-label="Flow"]')
        ?.addEventListener("pointerup", () => { window.__flowSwipeAt = performance.now(); }, { capture: true, once: true });
    });

    await page.mouse.move(cx, startY);
    await page.mouse.down();
    await page.mouse.move(cx, endY, { steps: 8 });
    await page.mouse.up();

    const titleAfterSwipe = await currentWaveTitle(page);
    const swipeMs = await page.evaluate(() => {
      const at = window.__flowSwipeAt;
      return at === null ? null : performance.now() - at;
    });
    note(`${label}: swipe up advances to the next Wave`, titleAfterSwipe !== titleBefore, `"${titleBefore}" -> "${titleAfterSwipe}"`);
    note(
      `${label}: swipe response under 200ms (INP-style, pointerup to DOM update)`,
      swipeMs !== null && swipeMs < 200,
      swipeMs === null ? "no pointerup observed" : `${swipeMs.toFixed(1)}ms`,
    );
  } else {
    note(`${label}: swipe up advances to the next Wave`, false, "no bounding box for the Flow region");
  }
  await shoot(page, `${label}-03-after-swipe`);

  if (kind === "desktop") {
    const titleBeforeWheel = await currentWaveTitle(page);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(300);
    const titleAfterWheel = await currentWaveTitle(page);
    note(`${label}: wheel swipe advances`, titleAfterWheel !== titleBeforeWheel, `"${titleBeforeWheel}" -> "${titleAfterWheel}"`);

    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(300);
    const titleAfterKey = await currentWaveTitle(page);
    note(`${label}: keyboard ArrowUp goes back`, titleAfterKey !== titleAfterWheel, `"${titleAfterWheel}" -> "${titleAfterKey}"`);
  }

  // Double tap (double click) to replay.
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.waitForTimeout(1500); // let some real playback time accrue first
    await page.mouse.dblclick(cx, cy);
    await page.waitForTimeout(300);
    const timeLabel = await active().locator("p.type-mono-sm").first().textContent().catch(() => null);
    note(`${label}: double tap replays (readout resets near 0:00)`, !!timeLabel && /^0:0[0-2]/.test(timeLabel.trim()), timeLabel ?? "no readout found");
  }
  await shoot(page, `${label}-04-after-replay`);

  // Duet: the hero action opens the request flow.
  const duetButton = active().getByRole("button", { name: /Request a Duet/i }).first();
  const duetEnabled = (await duetButton.count()) > 0 && (await duetButton.isEnabled().catch(() => false));
  if (duetEnabled) {
    await Promise.all([
      page.waitForURL(/\/duet$/, { timeout: 5000 }).catch(() => {}),
      duetButton.click(),
    ]);
    note(`${label}: Duet opens the request flow`, page.url().includes("/duet"), page.url());
    await shoot(page, `${label}-05-duet`);
    await page.goBack().catch(() => {});
  } else {
    note(`${label}: Duet button present (disabled for this Wave, not counted as failure)`, (await duetButton.count()) > 0);
  }

  await audit(page, `${label} flow`);

  const errorsHere = consoleErrors.filter((e) => e.label === label);
  note(`${label}: zero console errors`, errorsHere.length === 0, `${errorsHere.length} error(s)`);

  await context.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });

  await walk(browser, { name: "mobile", width: 390, height: 844 }, "touch");
  await walk(browser, { name: "desktop", width: 1280, height: 800 }, "desktop");

  await browser.close();

  const report = {
    base: BASE,
    findings,
    consoleErrors,
    failedRequests,
    axeResults,
    notReached,
  };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2), "utf8");

  const failed = findings.filter((f) => !f.ok);
  process.stdout.write(`\n${findings.length - failed.length}/${findings.length} checks passed.\n`);
  if (failed.length > 0) {
    process.stdout.write("Failed checks:\n");
    for (const f of failed) process.stdout.write(`  - ${f.label}${f.detail ? " (" + f.detail + ")" : ""}\n`);
  }
  if (consoleErrors.length > 0) {
    process.stdout.write(`Console errors: ${consoleErrors.length}\n`);
  }
  for (const a of axeResults) {
    if (a.serious.length > 0) {
      process.stdout.write(`Axe serious violations (${a.label}): ${JSON.stringify(a.serious)}\n`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
