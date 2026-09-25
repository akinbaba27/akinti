/**
 * Full-audit interactive flows (docs/AUDIT_2026-09-25.md), the half the
 * route sweep cannot cover: things that need clicking.
 *
 * Isolated Chromium, local `next start` of the production build, real live
 * Supabase. Targets the specific flows earlier audits flagged and never
 * re-verified: desktop sign-out redirect, every Explore secondary tab,
 * mic-permission-denied recovery, Echo end to end, and `/settings/pro` with
 * an empty `plans` table.
 *
 * Usage:
 *   npm run build && npx next start -p 3621
 *   node scripts/qa/full-audit-flows-2026-09-25.mjs --base http://localhost:3621
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : "http://localhost:3621";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "docs", "qa", "audit-2026-09-25");

const EMAIL = process.env.QA_EMAIL ?? "cullukgamer@gmail.com";
const PASSWORD = process.env.QA_PASSWORD ?? "Akinti-Test-2026";

const findings = [];
const consoleErrors = [];

function note(label, ok, detail) {
  findings.push({ label, ok, detail: detail ?? "" });
  process.stdout.write(`  [${ok ? "OK  " : "FAIL"}] ${label}${detail ? " -- " + detail : ""}\n`);
}

function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.text().includes("favicon")) return;
    consoleErrors.push({ label, text: m.text().slice(0, 300) });
  });
  page.on("pageerror", (e) => consoleErrors.push({ label, text: `pageerror: ${e.message}`.slice(0, 300) }));
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

async function shoot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `flow-${name}.png`) }).catch(() => {});
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

/* ---------------------------------------------------------------------- */
/* 1. Desktop sign-out redirect (flagged broken in an earlier audit)      */
/* ---------------------------------------------------------------------- */
{
  process.stdout.write("\n=== desktop sign-out ===\n");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  const page = await ctx.newPage();
  watch(page, "signout");
  if (await signIn(page)) {
    await page.goto(`${BASE}/settings/account`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    // The sign-out control lives in Settings; find it by accessible name.
    const candidates = page.locator("button, a").filter({ hasText: /log out|sign out|çıkış/i });
    const count = await candidates.count();
    note("sign-out control is reachable on desktop", count > 0, `${count} match(es)`);
    if (count > 0) {
      await candidates.first().click().catch(() => {});
      await page.waitForURL((u) => /\/login|^\/$/.test(u.pathname), { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const url = page.url().replace(BASE, "");
      note("sign-out lands on a signed-out page", /\/login|^\/$/.test(new URL(page.url()).pathname), `-> ${url}`);
      await shoot(page, "desktop-after-signout");
      // And that the session is actually gone, not just the URL changed.
      await page.goto(`${BASE}/settings/account`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(900);
      const blocked = new URL(page.url()).pathname.startsWith("/login");
      note("session really cleared (protected route bounces to /login)", blocked, `-> ${page.url().replace(BASE, "")}`);
    }
  } else {
    note("desktop sign-out", false, "could not sign in");
  }
  await ctx.close();
}

/* ---------------------------------------------------------------------- */
/* 2. Explore secondary tabs (6 were broken in an earlier audit)          */
/* ---------------------------------------------------------------------- */
{
  process.stdout.write("\n=== explore tabs ===\n");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
  const page = await ctx.newPage();
  watch(page, "explore-tabs");
  if (await signIn(page)) {
    await page.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const tabs = page.locator("[role=tab], nav a, button").filter({ hasText: /^(Rising|New|Duets|Tracks|Challenges|Creators|Tags|For you|Following)$/i });
    const n = await tabs.count();
    note("explore exposes secondary tabs", n > 0, `${n} tab(s)`);
    for (let i = 0; i < n; i += 1) {
      const tab = tabs.nth(i);
      const name = (await tab.innerText().catch(() => `tab-${i}`)).trim();
      const before = consoleErrors.length;
      await tab.click().catch(() => {});
      await page.waitForTimeout(900);
      const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
      const leaked = /spec §|RLS|RPC|server-side|deterministic|undefined|NaN|\w+Page\.\w+/.test(body);
      const blank = body.trim().length < 40;
      note(`explore tab "${name}" renders`, !leaked && !blank && consoleErrors.length === before,
        `len=${body.trim().length} leaked=${leaked} newErrors=${consoleErrors.length - before}`);
      await shoot(page, `explore-tab-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
    }
  }
  await ctx.close();
}

/* ---------------------------------------------------------------------- */
/* 3. Mic permission denied (a dead end was found here before)            */
/* ---------------------------------------------------------------------- */
{
  process.stdout.write("\n=== mic denied ===\n");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
  // Explicitly deny the mic for this origin.
  await ctx.clearPermissions();
  const page = await ctx.newPage();
  watch(page, "mic-denied");
  await page.addInitScript(() => {
    // Hard-deny getUserMedia the way a browser does after "Block".
    navigator.mediaDevices.getUserMedia = () => {
      const err = new Error("Permission denied");
      err.name = "NotAllowedError";
      return Promise.reject(err);
    };
  });
  if (await signIn(page)) {
    await page.goto(`${BASE}/create`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const recordBtn = page.locator("button").filter({ hasText: /record|kaydet|kayıt/i }).first();
    if (await recordBtn.count()) {
      await recordBtn.click().catch(() => {});
      await page.waitForTimeout(1800);
    }
    const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    // A real recovery screen names the problem and offers a way forward.
    const explains = /microphone|mikrofon/i.test(body);
    const recovers = /(settings|allow|permission|izin|ayarlar|upload|yükle|try again|tekrar)/i.test(body);
    note("mic-denied names the problem", explains, body.slice(0, 160));
    note("mic-denied offers a route forward (not a dead end)", recovers, "");
    await shoot(page, "mic-denied");
  }
  await ctx.close();
}

/* ---------------------------------------------------------------------- */
/* 4. Echo end to end (tap -> count up -> untap -> count down)            */
/* ---------------------------------------------------------------------- */
{
  process.stdout.write("\n=== echo end to end ===\n");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
  const page = await ctx.newPage();
  watch(page, "echo");
  if (await signIn(page)) {
    // The QA account owns Waves; its own profile lists them even while hidden.
    await page.goto(`${BASE}/u/akin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const waveLink = page.locator("a[href^='/w/']").first();
    if (await waveLink.count()) {
      const href = await waveLink.getAttribute("href");
      await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const echoBtn = page.locator("button[aria-pressed]").filter({ hasText: "" }).first();
      const byLabel = page.getByRole("button", { name: /echo|yankı/i }).first();
      const btn = (await byLabel.count()) ? byLabel : echoBtn;
      const found = await btn.count();
      note("Echo button present on Wave detail", found > 0, `wave=${href}`);
      if (found) {
        const pressedBefore = await btn.getAttribute("aria-pressed");
        await btn.click();
        await page.waitForTimeout(1800);
        const pressedAfter = await page.getByRole("button", { name: /echo|yankı/i }).first().getAttribute("aria-pressed").catch(() => null);
        note("Echo toggles aria-pressed", pressedBefore !== pressedAfter, `${pressedBefore} -> ${pressedAfter}`);
        await shoot(page, "echo-on");
        // Reload: the count and state must survive a round trip (server truth).
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1400);
        const persisted = await page.getByRole("button", { name: /echo|yankı/i }).first().getAttribute("aria-pressed").catch(() => null);
        note("Echo survives a reload", persisted === pressedAfter, `after reload: ${persisted}`);
        // Un-echo back to the original state, so the audit leaves no trace.
        const back = page.getByRole("button", { name: /echo|yankı/i }).first();
        await back.click().catch(() => {});
        await page.waitForTimeout(1800);
        const restored = await page.getByRole("button", { name: /echo|yankı/i }).first().getAttribute("aria-pressed").catch(() => null);
        note("Echo can be removed again (restored original state)", restored === pressedBefore, `${restored}`);
        await shoot(page, "echo-off");
      }
    } else {
      note("Echo end to end", false, "no Wave link found on the profile");
    }
  }
  await ctx.close();
}

/* ---------------------------------------------------------------------- */
/* 5. /settings/pro with an empty `plans` table                           */
/* ---------------------------------------------------------------------- */
{
  process.stdout.write("\n=== pro / payments ===\n");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
  const page = await ctx.newPage();
  watch(page, "pro");
  if (await signIn(page)) {
    await page.goto(`${BASE}/settings/pro`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    const honest = /(not (yet )?(set up|available)|unavailable|coming|şu an|kullanılamıyor|ayarlanmad)/i.test(body);
    const leaksPrice = /₺|\$\d/.test(body);
    note("Pro page renders without crashing on empty plans", body.trim().length > 40, `len=${body.trim().length}`);
    note("Pro page is honest about payments not being configured", honest || !leaksPrice, body.slice(0, 220));
    await shoot(page, "settings-pro");
  }
  await ctx.close();
}

await browser.close();

await writeFile(path.join(OUT, "flows.json"), JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), findings, consoleErrors }, null, 2), "utf8");
const failed = findings.filter((f) => !f.ok);
process.stdout.write(`\n${findings.length - failed.length}/${findings.length} checks passed; console errors: ${consoleErrors.length}\n`);
if (consoleErrors.length) {
  for (const e of consoleErrors.slice(0, 10)) process.stdout.write(`  console [${e.label}] ${e.text}\n`);
}
