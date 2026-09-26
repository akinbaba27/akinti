/**
 * Full-audit route sweep (docs/AUDIT_2026-09-25.md).
 *
 * Isolated Chromium (never the shared MCP browser), against a local
 * `next start` of the production build, with the real live Supabase behind
 * it. Signs in as the shared QA account, then walks every route in
 * `src/config/routes.ts` at 390x844 and 1280x800, recording console errors,
 * failed requests and serious/critical axe violations per route, plus a
 * screenshot of each. Finishes with a signed-out pass over the public
 * surface.
 *
 * Usage:
 *   npm run build && npx next start -p 3620
 *   node scripts/qa/full-audit-2026-09-25.mjs --base http://localhost:3620
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

import { requireEnv } from "./_env.mjs";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : "http://localhost:3620";
// Resolved from this file, not a hardcoded absolute path: the older scripts in
// this folder still point at `c:/Users/alppr/...`, the previous machine.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "docs", "qa", "audit-2026-09-25");

const EMAIL = requireEnv("QA_EMAIL");
const PASSWORD = requireEnv("QA_PASSWORD");

const consoleErrors = [];
const failedRequests = [];
const axeFindings = [];
const routeResults = [];

function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (text.includes("favicon")) return;
    consoleErrors.push({ label, text: text.slice(0, 400) });
  });
  page.on("pageerror", (e) => {
    consoleErrors.push({ label, text: `pageerror: ${e.message}`.slice(0, 400) });
  });
  page.on("requestfailed", (r) => {
    const failure = r.failure()?.errorText ?? "unknown";
    if (failure.includes("ERR_ABORTED")) return;
    failedRequests.push({ label, url: r.url(), failure });
  });
  page.on("response", (r) => {
    if (r.status() >= 400) {
      failedRequests.push({ label, url: r.url(), failure: `HTTP ${r.status()}` });
    }
  });
}

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator("input[type=email]").first().fill(EMAIL);
  await page.locator("input[type=password]").first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {}),
    page.locator("button[type=submit]").first().click(),
  ]);
  await page.waitForTimeout(1500);
  return !page.url().includes("/login");
}

async function visit(page, viewport, label, url) {
  const before = { c: consoleErrors.length, f: failedRequests.length };
  let status = "ok";
  try {
    const res = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (res && res.status() >= 400) status = `HTTP ${res.status()}`;
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  } catch (e) {
    status = `nav-error: ${String(e).slice(0, 120)}`;
  }
  await page.waitForTimeout(400);

  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 1500) ?? "").catch(() => "");
  const h1 = await page.locator("h1").first().innerText().catch(() => "");

  let serious = [];
  try {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    serious = r.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
  } catch {
    // axe can fail mid-redirect; recorded as no findings rather than crashing the sweep.
  }
  if (serious.length) axeFindings.push({ viewport, label, url, serious });

  const safe = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  await page.screenshot({ path: path.join(OUT, `${viewport}-${safe}.png`) }).catch(() => {});

  routeResults.push({
    viewport,
    label,
    url,
    status,
    finalUrl: page.url().replace(BASE, ""),
    h1: h1.slice(0, 80),
    newConsoleErrors: consoleErrors.length - before.c,
    newFailedRequests: failedRequests.length - before.f,
    serious: serious.length,
    textSample: text.replace(/\s+/g, " ").slice(0, 400),
  });
  const line = `  [${viewport}] ${label.padEnd(26)} ${status.padEnd(9)} axe:${serious.length} err:${consoleErrors.length - before.c} net:${failedRequests.length - before.f}\n`;
  process.stdout.write(line);
}

const ROUTES = [
  ["flow", "/flow"],
  ["home", "/"],
  ["explore", "/explore"],
  ["search-empty", "/search"],
  ["search-query", "/search?q=a"],
  ["create", "/create"],
  ["tracks", "/tracks"],
  ["challenges", "/challenges"],
  ["challenge-detail", "/challenges/opening-week"],
  ["duets", "/duets"],
  ["notifications", "/notifications"],
  ["messages", "/messages"],
  ["analytics", "/analytics"],
  ["analytics-health", "/analytics/health"],
  ["profile-own", "/u/akin"],
  ["profile-followers", "/u/akin/followers"],
  ["profile-following", "/u/akin/following"],
  ["hashtag", "/hashtag/test"],
  ["settings", "/settings"],
  ["settings-account", "/settings/account"],
  ["settings-privacy", "/settings/privacy"],
  ["settings-appearance", "/settings/appearance"],
  ["settings-notifications", "/settings/notifications"],
  ["settings-content", "/settings/content"],
  ["settings-content-saved", "/settings/content/saved"],
  ["settings-content-waves", "/settings/content/waves"],
  ["settings-content-duets", "/settings/content/duets"],
  ["settings-content-commented", "/settings/content/commented"],
  ["settings-audio", "/settings/audio"],
  ["settings-safety", "/settings/safety"],
  ["settings-follow-requests", "/settings/follow-requests"],
  ["settings-pro", "/settings/pro"],
  ["moderation", "/moderation"],
  ["kit", "/kit"],
];

const VIEWPORTS = [
  ["mobile", { width: 390, height: 844 }, true],
  ["desktop", { width: 1280, height: 800 }, false],
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

for (const [name, viewport, isMobile] of VIEWPORTS) {
  process.stdout.write(`\n=== ${name} ${viewport.width}x${viewport.height} ===\n`);
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch: isMobile,
    permissions: ["microphone"],
    locale: "en-US",
  });
  const page = await context.newPage();
  watch(page, `${name}:auth`);
  const signedIn = await signIn(page);
  process.stdout.write(`  signed in: ${signedIn}\n`);
  if (!signedIn) {
    await context.close();
    continue;
  }
  for (const [label, url] of ROUTES) {
    await visit(page, name, label, url);
  }
  await context.close();
}

{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "en-US",
  });
  const page = await context.newPage();
  watch(page, "anon");
  process.stdout.write(`\n=== signed-out (mobile) ===\n`);
  const anonRoutes = [
    ["login", "/login"],
    ["signup", "/signup"],
    ["forgot", "/forgot-password"],
    ["explore-anon", "/explore"],
    ["home-anon", "/"],
  ];
  for (const [label, url] of anonRoutes) {
    await visit(page, "anon", label, url);
  }
  await context.close();
}

await browser.close();

const report = {
  base: BASE,
  generatedAt: new Date().toISOString(),
  routeResults,
  consoleErrors,
  failedRequests,
  axeFindings,
};
await writeFile(path.join(OUT, "sweep.json"), JSON.stringify(report, null, 2), "utf8");
process.stdout.write(
  `\nconsole errors: ${consoleErrors.length}\nfailed requests: ${failedRequests.length}\naxe serious routes: ${axeFindings.length}\nwrote ${path.join(OUT, "sweep.json")}\n`,
);
