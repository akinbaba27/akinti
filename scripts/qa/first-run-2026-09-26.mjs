/**
 * First-run walkthrough (docs/PLATFORM_HARDENING_2026-09-26.md).
 *
 * Signs up a brand-new throwaway account through the real form, walks
 * onboarding, then visits every surface a first-time user would reach with an
 * empty follow graph and no content of their own — which is exactly the state
 * the live project is in right now (all Waves hidden, both challenges expired).
 *
 * Captures the full visible text of each step, so empty-state and onboarding
 * copy can be read and judged rather than guessed at, plus a screenshot per
 * step and any console error.
 *
 * The account uses the documented throwaway pattern
 * (`e2e+<tag>@akinti.test`, docs/TESTING.md) so
 * `npm run cleanup:test-accounts` can always sweep it, and this script deletes
 * it itself on the way out unless `--keep` is passed.
 *
 * Usage:
 *   npm run build && npx next start -p 3630
 *   node scripts/qa/first-run-2026-09-26.mjs --base http://localhost:3630
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : "http://localhost:3630";
const KEEP = args.includes("--keep");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "docs", "qa", "first-run-2026-09-26");

/** Minimal .env.local reader, same approach as scripts/qa/_env.mjs. */
function env(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    const p = path.join(ROOT, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      if (t.slice(0, eq).trim() !== name) continue;
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return v;
    }
  }
  return undefined;
}

const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

const stamp = Date.now();
const EMAIL = `e2e+firstrun-${stamp}@akinti.test`;
const USERNAME = `firstrun${String(stamp).slice(-7)}`;
const PASSWORD = `Fr-${stamp}-Aa9!`;

const steps = [];
const consoleErrors = [];

function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.text().includes("favicon")) return;
    consoleErrors.push({ label, text: m.text().slice(0, 300) });
  });
  page.on("pageerror", (e) => consoleErrors.push({ label, text: `pageerror: ${e.message}`.slice(0, 300) }));
}

async function capture(page, label) {
  await page.waitForTimeout(500);
  const text = (await page.evaluate(() => document.body?.innerText ?? "")).replace(/[ \t]+/g, " ").trim();
  const h1 = await page.locator("h1").first().innerText().catch(() => "");
  // Every button/link a first-time user could act on, in DOM order.
  const actions = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button, a[href]"))
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        label: (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 60),
        href: el.getAttribute("href"),
        disabled: el.hasAttribute("disabled"),
      }))
      .filter((a) => a.label && a.label !== "Skip to content"),
  );
  const safe = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  await page.screenshot({ path: path.join(OUT, `${safe}.png`), fullPage: true }).catch(() => {});
  steps.push({ label, url: page.url().replace(BASE, ""), h1, text, actions });
  process.stdout.write(`\n${"=".repeat(72)}\n[${label}]  ${page.url().replace(BASE, "")}\n${"=".repeat(72)}\n${text.slice(0, 1600)}\n`);
  return text;
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: "en-US",
  permissions: ["microphone"],
});
const page = await ctx.newPage();
watch(page, "first-run");

let userId = null;
try {
  /* -------------------------------------------------- 1. landing / signup */
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await capture(page, "01 anonymous landing");

  await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await capture(page, "02 signup form");

  // The account itself is created through the admin API rather than this form.
  // Two reasons, neither of them an app defect: Supabase's own address
  // validation rejects the `e2e+<tag>@akinti.test` pattern `docs/TESTING.md`
  // prescribes (the app surfaces that correctly as "Enter a valid email
  // address" via `mapAuthError`), and a hosted project rate-limits signup
  // emails hard enough that a couple of attempts exhaust the quota. Every
  // prior QA pass created its throwaway account the same way.
  const adminHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { username: USERNAME },
    }),
  });
  if (!created.ok) {
    throw new Error(`admin createUser failed: ${created.status} ${(await created.text()).slice(0, 200)}`);
  }
  process.stdout.write(`\ncreated throwaway account (email withheld), username=${USERNAME}\n`);

  // From here on it is the real user path: sign in through the real form.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await capture(page, "03 first screen after first sign-in");

  /* ------------------------------------------------------ 2. onboarding */
  for (let i = 1; i <= 6; i += 1) {
    if (!page.url().includes("/onboarding")) break;
    await capture(page, `04 onboarding step ${i}`);
    // Advance with whatever the primary forward control is.
    const next = page
      .getByRole("button", { name: /continue|next|done|finish|get started|start|skip/i })
      .first();
    if (!(await next.count())) break;
    await next.click().catch(() => {});
    await page.waitForTimeout(1600);
  }
  if (page.url().includes("/onboarding")) await capture(page, "04 onboarding final state");

  /* ------------------------------- 3. the empty product, as a new user */
  const tour = [
    ["05 flow (empty)", "/flow"],
    ["06 home (empty)", "/"],
    ["07 explore (empty)", "/explore"],
    ["08 search (idle)", "/search"],
    ["09 create", "/create"],
    ["10 tracks", "/tracks"],
    ["11 challenges (none live)", "/challenges"],
    ["12 duets (empty)", "/duets"],
    ["13 notifications (empty)", "/notifications"],
    ["14 messages (empty)", "/messages"],
    ["15 own profile (empty)", `/u/${USERNAME}`],
    ["16 analytics (no data)", "/analytics"],
    ["17 settings hub", "/settings"],
    ["18 settings pro (no plans)", "/settings/pro"],
    ["19 saved (empty)", "/settings/content/saved"],
  ];
  for (const [label, url] of tour) {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await capture(page, label);
  }
} finally {
  await writeFile(
    path.join(OUT, "first-run.json"),
    JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), email: EMAIL, username: USERNAME, steps, consoleErrors }, null, 2),
    "utf8",
  );
  await browser.close();

  // Sweep the throwaway account unless asked to keep it.
  if (!KEEP && SUPABASE_URL && SERVICE_KEY) {
    const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
    const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: h });
    if (list.ok) {
      const { users } = await list.json();
      const u = users.find((x) => (x.email ?? "").toLowerCase() === EMAIL.toLowerCase());
      userId = u?.id ?? null;
      if (userId) {
        const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: h });
        process.stdout.write(`\ncleanup: deleted throwaway account ${del.ok ? "ok" : `FAILED ${del.status}`}\n`);
      } else {
        process.stdout.write("\ncleanup: throwaway account not found (nothing to delete)\n");
      }
    }
  } else if (KEEP) {
    process.stdout.write(`\ncleanup: skipped (--keep). Account left behind: ${EMAIL}\n`);
  }

  process.stdout.write(`\nsteps captured: ${steps.length}; console errors: ${consoleErrors.length}\n`);
  for (const e of consoleErrors.slice(0, 10)) process.stdout.write(`  console [${e.label}] ${e.text}\n`);
}
