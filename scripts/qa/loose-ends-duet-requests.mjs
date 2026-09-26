/**
 * Loose-ends QA: `DuetRequestsView` rebuilt as rail-hung rows with hairline
 * separators (DESIGN.md §12 — no card, no pill, no shadow), behaviour
 * unchanged. Runs its own Chromium (never the shared MCP browser, per
 * CLAUDE.md) against its own `next start` on port 3555 (never 3533 —
 * waveE-pwa owns that one), and captures the populated `/duets` page (both
 * tabs) at 390x844 and 1280x800.
 *
 * The signed-in QA account needs at least one row in each tab to actually
 * show the rebuilt row/action styling — `scripts/qa/provision-duets-qa.mjs`-
 * equivalent provisioning happens in `runChecks` below via the service-role
 * REST API before navigating, and everything it creates is torn down in a
 * `finally` block regardless of pass/fail.
 *
 * Usage:
 *   npm run build
 *   npm run start -- -p 3555
 *   node scripts/qa/loose-ends-duet-requests.mjs [--base http://localhost:3555]
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "@playwright/test";

import { requireEnv } from "./_env.mjs";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : "http://localhost:3555";
const OUT = path.join(process.cwd(), "docs", "qa", "loose-ends");

const EMAIL = requireEnv("QA_EMAIL");
const PASSWORD = requireEnv("QA_PASSWORD");

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
];

/* ------------------------------------------------------------------------ */
/* .env.local loader (same approach as scripts/verify-live-messaging.ts)    */
/* ------------------------------------------------------------------------ */

function loadEnvFile() {
  for (const name of [".env.local", ".env"]) {
    const filePath = path.resolve(process.cwd(), name);
    if (!existsSync(filePath)) continue;
    const contents = readFileSync(filePath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Provisioning: two throwaway Duet Requests against the real QA account    */
/* (one where it is the recipient, one where it is the requester), plus the */
/* throwaway counterpart account and Waves each request needs.              */
/* ------------------------------------------------------------------------ */

async function restPost(baseUrl, headers, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${urlPath} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

async function findUserIdByEmail(baseUrl, headers, email) {
  const res = await fetch(`${baseUrl}/auth/v1/admin/users?page=1&per_page=200`, { headers });
  if (!res.ok) throw new Error(`list users failed: HTTP ${res.status}`);
  const body = await res.json();
  const match = (body.users ?? []).find((u) => u.email === email);
  if (!match) throw new Error(`no auth user found for ${email} — cannot provision Duet Request QA data`);
  return match.id;
}

async function provisionDuetRequests(baseUrl, adminHeaders, qaUserId) {
  const probeId = crypto.randomUUID();
  const password = `Vv${probeId.replace(/-/g, "")}!`;
  const counterpartEmail = `loose-ends-duet-${probeId}@akinti.internal`;

  const counterpart = await restPost(baseUrl, adminHeaders, "/auth/v1/admin/users", {
    email: counterpartEmail,
    password,
    email_confirm: true,
  });
  const counterpartId = counterpart.id;

  const [counterpartAsset] = await restPost(baseUrl, adminHeaders, "/rest/v1/audio_assets", {
    owner_id: counterpartId,
    original_path: `verify/${probeId}-counterpart.wav`,
    mime_type: "audio/wav",
    byte_size: 1,
  });
  const [counterpartWave] = await restPost(baseUrl, adminHeaders, "/rest/v1/waves", {
    creator_id: counterpartId,
    audio_asset_id: counterpartAsset.id,
    title: "Loose ends QA — counterpart wave",
    creation_type: "recorded",
  });

  const [qaAsset] = await restPost(baseUrl, adminHeaders, "/rest/v1/audio_assets", {
    owner_id: qaUserId,
    original_path: `verify/${probeId}-qa.wav`,
    mime_type: "audio/wav",
    byte_size: 1,
  });
  const [qaWave] = await restPost(baseUrl, adminHeaders, "/rest/v1/waves", {
    creator_id: qaUserId,
    audio_asset_id: qaAsset.id,
    title: "Loose ends QA — my wave",
    creation_type: "recorded",
  });

  // Sent: QA requests a Duet on the counterpart's Wave.
  await restPost(baseUrl, adminHeaders, "/rest/v1/duet_requests", {
    wave_id: counterpartWave.id,
    requester_id: qaUserId,
    recipient_id: counterpartId,
    message: "Loose ends QA screenshot — sent request",
  });

  // Received: the counterpart requests a Duet on QA's own Wave.
  await restPost(baseUrl, adminHeaders, "/rest/v1/duet_requests", {
    wave_id: qaWave.id,
    requester_id: counterpartId,
    recipient_id: qaUserId,
    message: "Loose ends QA screenshot — received request",
  });

  return { counterpartId, counterpartWaveId: counterpartWave.id, qaWaveId: qaWave.id };
}

async function teardown(baseUrl, adminHeaders, provisioned) {
  if (!provisioned) return;
  // Deleting the counterpart cascades their own Wave/audio asset and both
  // duet_requests rows they are a party to; the QA account's throwaway Wave
  // (and its audio asset, `on delete restrict` from `waves.audio_asset_id`)
  // needs its own explicit cleanup since the QA account itself is real and
  // must not be touched.
  await fetch(`${baseUrl}/auth/v1/admin/users/${provisioned.counterpartId}`, {
    method: "DELETE",
    headers: adminHeaders,
  }).catch(() => {});
  await fetch(`${baseUrl}/rest/v1/waves?id=eq.${provisioned.qaWaveId}`, {
    method: "DELETE",
    headers: adminHeaders,
  }).catch(() => {});
}

/* ------------------------------------------------------------------------ */
/* Browser                                                                   */
/* ------------------------------------------------------------------------ */

async function go(page, url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("load").catch(() => {});
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(800);
    }
  }
}

async function shoot(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  process.stdout.write(`  saved ${name}.png\n`);
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
  await page.waitForTimeout(2500);
  if (page.url().includes("/login")) {
    const alert = await page.locator("[role='alert']").first().textContent().catch(() => null);
    if (alert) process.stdout.write(`  sign-in blocked: ${alert.trim()}\n`);
    return false;
  }
  return true;
}

const consoleErrors = [];

function watch(page, label) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    consoleErrors.push({ label, text: message.text() });
  });
  page.on("pageerror", (error) => {
    consoleErrors.push({ label, text: `pageerror: ${error.message}` });
  });
}

async function run() {
  loadEnvFile();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set (see .env.local).");
  }
  const adminHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };

  await mkdir(OUT, { recursive: true });

  const qaUserId = await findUserIdByEmail(supabaseUrl, adminHeaders, EMAIL);
  const provisioned = await provisionDuetRequests(supabaseUrl, adminHeaders, qaUserId);
  process.stdout.write(`Provisioned throwaway Duet Requests for ${EMAIL} (${qaUserId}).\n`);

  const browser = await chromium.launch();
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        colorScheme: "light",
      });
      const page = await context.newPage();
      watch(page, viewport.name);

      process.stdout.write(`\n[${viewport.name}] ${viewport.width}x${viewport.height}\n`);

      const signedIn = await signIn(page);
      if (!signedIn) {
        throw new Error(`sign-in failed for ${EMAIL} at ${viewport.name}`);
      }

      await go(page, `${BASE}/duets`);
      await shoot(page, `${viewport.name}-duets-received`);

      await page.getByRole("tab", { name: /^sent$/i }).click();
      await page.waitForTimeout(400);
      await shoot(page, `${viewport.name}-duets-sent`);

      await context.close();
    }
  } finally {
    await browser.close().catch(() => {});
    await teardown(supabaseUrl, adminHeaders, provisioned);
    process.stdout.write("\nTore down throwaway Duet Request QA data.\n");
  }

  if (consoleErrors.length > 0) {
    process.stdout.write(`\n${consoleErrors.length} console error(s):\n`);
    for (const err of consoleErrors) process.stdout.write(`  [${err.label}] ${err.text}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("\nNo console errors. Screenshots saved under docs/qa/loose-ends/.\n");
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
