import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

import { requireEnv } from "./_env.mjs";

const BASE = "http://localhost:3577";
const OUT = path.join(process.cwd(), "docs", "qa", "colour");

const EMAIL = requireEnv("QA_EMAIL");
const PASSWORD = requireEnv("QA_PASSWORD");
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
];
const THEMES = ["light", "dark"];

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const email = page.locator("#email").first();
  if ((await email.count()) === 0) return false;
  await email.fill(EMAIL);
  await page.locator("#password").first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {}),
    page.getByRole("button", { name: /^log in$/i }).first().click(),
  ]);
  await page.waitForTimeout(1500);
  return !page.url().includes("/login");
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const label = `${viewport.name}-${theme}`;
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        colorScheme: theme,
        permissions: ["microphone"],
      });
      const page = await context.newPage();
      await signIn(page);
      await page.goto(`${BASE}/create`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, `${label}-record-idle.png`), fullPage: true });

      const armButton = page.getByRole("button", { name: /arm the microphone/i }).first();
      if (await armButton.count()) {
        await armButton.click().catch(() => {});
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(OUT, `${label}-record-armed.png`), fullPage: true });

        const startButton = page.getByRole("button", { name: /^start recording$/i }).first();
        if (await startButton.count()) {
          await startButton.click().catch(() => {});
          await page.waitForTimeout(4200);
          await page.screenshot({ path: path.join(OUT, `${label}-record-live.png`), fullPage: true });
        } else {
          process.stdout.write(`  [${label}] "Start recording" button not found after arming\n`);
        }
      } else {
        process.stdout.write(`  [${label}] "Arm the microphone" button not found\n`);
      }

      process.stdout.write(`[${label}] done\n`);
      await context.close();
    }
  }

  await browser.close();
}

run().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
