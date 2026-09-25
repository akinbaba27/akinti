/**
 * Full-audit Turkish-locale sweep (docs/AUDIT_2026-09-25.md).
 *
 * Isolated Chromium against a local `next start`, locale forced to Turkish,
 * over the same routes the English sweep covers. Looks for the two failure
 * modes that matter here: English copy leaking into a Turkish session, and
 * raw message keys / engineering language rendering as UI text.
 *
 * Usage:
 *   npm run build && npx next start -p 3622
 *   node scripts/qa/full-audit-tr-2026-09-25.mjs --base http://localhost:3622
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : "http://localhost:3622";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "docs", "qa", "audit-2026-09-25");

const EMAIL = process.env.QA_EMAIL ?? "cullukgamer@gmail.com";
const PASSWORD = process.env.QA_PASSWORD ?? "Akinti-Test-2026";

/**
 * Words that would only appear in a Turkish session if an English string
 * leaked. Deliberately excludes the product's own untranslated vocabulary —
 * Wave, Duet, Echo, Flow, AKINTI, Pro, Atisma, Cypher are domain terms
 * (`src/config/terminology.ts`) and are supposed to read the same in both
 * locales.
 */
const ENGLISH_LEAKS = [
  "Settings", "Profile", "Notifications", "Messages", "Search", "Explore", "Home",
  "Sign in", "Sign out", "Log out", "Log in", "Save", "Saved", "Share", "Comment",
  "Comments", "Follow", "Followers", "Following", "Challenges", "Tracks", "Analytics",
  "Loading", "Try again", "Something went wrong", "Not found", "Page not found",
  "Privacy", "Account", "Appearance", "Safety", "Audio", "Content",
  "Unheard", "Record", "Publish", "Upload", "Cancel", "Delete", "Edit",
];

/** Engineering language and template leakage that must never reach any locale. */
const LEAK_PATTERNS = [
  /\b[A-Z][A-Za-z]+Page\.[a-zA-Z]+/,       // NotFoundPage.title
  /\b[A-Z][A-Za-z]+\.[a-z][A-Za-z]*\b(?=\s|$)/, // Namespace.key shaped
  /spec §|RLS|RPC\b|server-side|deterministic/,
  /\bundefined\b|\bNaN\b|\[object Object\]/,
  /MISSING_MESSAGE/,
];

const findings = [];
const consoleErrors = [];

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

const ROUTES = [
  ["flow", "/flow"], ["home", "/"], ["explore", "/explore"], ["search", "/search"],
  ["create", "/create"], ["tracks", "/tracks"], ["challenges", "/challenges"],
  ["duets", "/duets"], ["notifications", "/notifications"], ["messages", "/messages"],
  ["analytics", "/analytics"], ["profile", "/u/akin"],
  ["settings", "/settings"], ["settings-account", "/settings/account"],
  ["settings-privacy", "/settings/privacy"], ["settings-appearance", "/settings/appearance"],
  ["settings-notifications", "/settings/notifications"], ["settings-audio", "/settings/audio"],
  ["settings-safety", "/settings/safety"], ["settings-content", "/settings/content"],
  ["settings-pro", "/settings/pro"], ["notfound", "/definitely-not-a-route-xyz-tr"],
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: "tr-TR",
  extraHTTPHeaders: { "Accept-Language": "tr-TR,tr;q=0.9" },
});
const page = await ctx.newPage();
watch(page, "tr");

const signedIn = await signIn(page);
process.stdout.write(`signed in: ${signedIn}\n\n`);

for (const [label, url] of ROUTES) {
  const before = consoleErrors.length;
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);

  const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
  const flat = text.replace(/\s+/g, " ");

  const english = ENGLISH_LEAKS.filter((w) => new RegExp(`(^|[^A-Za-zÇĞİÖŞÜçğıöşü])${w}([^A-Za-zÇĞİÖŞÜçğıöşü]|$)`).test(flat));
  const leaks = LEAK_PATTERNS.filter((re) => re.test(flat)).map((re) => String(re));

  findings.push({ label, url, english, leaks, newConsoleErrors: consoleErrors.length - before, sample: flat.slice(0, 220) });
  const flag = english.length || leaks.length ? "FLAG" : "ok  ";
  process.stdout.write(`  [${flag}] ${label.padEnd(24)} english=${english.length ? english.join(",") : "-"} leaks=${leaks.length}\n`);
  await page.screenshot({ path: path.join(OUT, `tr-${label}.png`) }).catch(() => {});
}

await ctx.close();
await browser.close();

await writeFile(path.join(OUT, "tr.json"), JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), findings, consoleErrors }, null, 2), "utf8");
const flagged = findings.filter((f) => f.english.length || f.leaks.length);
process.stdout.write(`\n${findings.length - flagged.length}/${findings.length} routes clean; console errors: ${consoleErrors.length}\n`);
for (const e of consoleErrors.slice(0, 8)) process.stdout.write(`  console [${e.label}] ${e.text}\n`);
