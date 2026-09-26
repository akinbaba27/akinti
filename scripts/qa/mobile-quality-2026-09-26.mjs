/**
 * Mobile-first quality sweep (docs/PLATFORM_HARDENING_2026-09-26.md).
 *
 * Objective, measurable checks against `docs/research/mobile-guidelines.md`
 * rather than opinions, at the 390px design target and again at 1280px:
 *
 *  - horizontal overflow (`scrollWidth > clientWidth` on documentElement) —
 *    rule: no horizontal page scroll, 16px side gutters
 *  - tap targets under 44x44 among the controls actually on screen
 *  - whether the current route is indicated in the nav (can a user tell where
 *    they are)
 *  - leaked engineering language, re-checked after the audit removed it
 *
 * Usage:
 *   npm run build && npx next start -p 3634
 *   node scripts/qa/mobile-quality-2026-09-26.mjs --base http://localhost:3634
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { requireEnv } from "./_env.mjs";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : "http://localhost:3634";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "docs", "qa", "mobile-quality-2026-09-26");

const EMAIL = requireEnv("QA_EMAIL");
const PASSWORD = requireEnv("QA_PASSWORD");

/** Minimum comfortable touch target, `mobile-guidelines.md`. */
const MIN_TAP = 44;

const ENGINEERING_TELLS =
  /spec §|\bRLS\b|\bRPC\b|server-side|deterministic|Meaningful|\bRaw\b|\[object Object\]|\bundefined\b|\bNaN\b/;

const rows = [];

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {}),
    page.locator('button[type="submit"]').first().click(),
  ]);
  await page.waitForTimeout(1500);
  return !page.url().includes("/login");
}

const ROUTES = [
  ["flow", "/flow"],
  ["home", "/"],
  ["explore", "/explore"],
  ["tracks", "/tracks"],
  ["search", "/search"],
  ["create", "/create"],
  ["challenges", "/challenges"],
  ["duets", "/duets"],
  ["notifications", "/notifications"],
  ["messages", "/messages"],
  ["profile", "/u/akin"],
  ["analytics", "/analytics"],
  ["settings", "/settings"],
  ["settings-pro", "/settings/pro"],
  ["settings-account", "/settings/account"],
  ["saved", "/settings/content/saved"],
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const [viewportName, viewport, isMobile] of [
  ["mobile", { width: 390, height: 844 }, true],
  ["desktop", { width: 1280, height: 800 }, false],
]) {
  const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: "en-US" });
  const page = await ctx.newPage();
  if (!(await signIn(page))) {
    process.stdout.write(`could not sign in for ${viewportName}\n`);
    await ctx.close();
    continue;
  }
  process.stdout.write(`\n=== ${viewportName} ${viewport.width}x${viewport.height} ===\n`);

  for (const [label, url] of ROUTES) {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(350);

    const measured = await page.evaluate(
      ({ minTap, pathname }) => {
        const doc = document.documentElement;
        const overflow = doc.scrollWidth - doc.clientWidth;

        // Widest element actually sticking out, to make an overflow actionable.
        let culprit = null;
        if (overflow > 1) {
          for (const el of Array.from(document.querySelectorAll("*"))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.right <= doc.clientWidth + 1 && r.left >= -1) continue;
            const desc = `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(/\s+/).slice(0, 2).join(".") : ""}`;
            if (!culprit || r.width > culprit.width) {
              culprit = { desc, width: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right) };
            }
          }
        }

        const small = [];
        for (const el of Array.from(document.querySelectorAll("button, a[href], [role=button], input[type=checkbox], input[type=radio]"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none") continue;
          if (r.width >= minTap && r.height >= minTap) continue;
          const name = (el.innerText || el.getAttribute("aria-label") || el.tagName).replace(/\s+/g, " ").trim().slice(0, 32);
          small.push({ name, w: Math.round(r.width), h: Math.round(r.height) });
        }

        // Does any nav link mark itself as current for this route?
        const current = Array.from(document.querySelectorAll("nav a, nav button, [role=tablist] a, [role=tablist] button"))
          .filter((el) =>
            el.getAttribute("aria-current") === "page" ||
            el.getAttribute("aria-selected") === "true" ||
            (el.getAttribute("href") === pathname && el.getAttribute("aria-current") !== null),
          ).length;

        return {
          overflow,
          culprit,
          small: small.slice(0, 6),
          smallCount: small.length,
          currentMarked: current,
          text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1500),
        };
      },
      { minTap: MIN_TAP, pathname: new URL(page.url()).pathname },
    );

    const leak = ENGINEERING_TELLS.exec(measured.text);
    const problems = [];
    if (measured.overflow > 1) problems.push(`overflow +${measured.overflow}px (${measured.culprit?.desc ?? "?"})`);
    if (measured.smallCount > 0) problems.push(`${measured.smallCount} tap target(s) < ${MIN_TAP}px`);
    if (leak) problems.push(`copy leak "${leak[0]}"`);
    if (viewportName === "mobile" && measured.currentMarked === 0) problems.push("no nav item marked current");

    rows.push({ viewport: viewportName, label, url, ...measured, leak: leak?.[0] ?? null, problems });
    const safe = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await page.screenshot({ path: path.join(OUT, `${viewportName}-${safe}.png`) }).catch(() => {});
    process.stdout.write(
      `  [${problems.length === 0 ? "ok  " : "FLAG"}] ${label.padEnd(18)} ${problems.join("; ") || "clean"}\n`,
    );
  }
  await ctx.close();
}

await browser.close();
await writeFile(path.join(OUT, "mobile-quality.json"), JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), minTap: MIN_TAP, rows }, null, 2), "utf8");
const flagged = rows.filter((r) => r.problems.length > 0);
process.stdout.write(`\n${rows.length - flagged.length}/${rows.length} clean\n`);
