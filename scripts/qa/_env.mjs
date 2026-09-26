/**
 * Shared credential loading for `scripts/qa/*.mjs`.
 *
 * Every script in this folder used to carry the shared QA account's real
 * password as a literal fallback, which put a working credential in the repo
 * and in git history. That value was rotated on 2026-09-26; the replacement
 * lives only in `.env.local` (gitignored via `.env*.local`), which is also
 * where `QA_EMAIL` lives.
 *
 * `node scripts/qa/foo.mjs` does not load `.env.local` the way `next dev` or
 * `tsx --env-file-if-exists` would, so this module reads it directly — the same
 * few lines of parsing `scripts/apply-migrations.ts` and `scripts/worker.ts`
 * already do rather than pulling in `dotenv`. Values already present in
 * `process.env` always win, so CI or a one-off `QA_PASSWORD=… node …` still
 * overrides the file.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Repo root, resolved from this file rather than `process.cwd()`, so these scripts work from any directory. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let loaded = false;

function loadEnvFile() {
  if (loaded) return;
  loaded = true;
  for (const name of [".env.local", ".env"]) {
    const filePath = path.join(ROOT, name);
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

/**
 * Reads a required variable, loading `.env.local` first. Exits with an
 * instruction rather than falling back to anything, so a missing value is an
 * obvious setup error instead of a silent default.
 */
export function requireEnv(name) {
  loadEnvFile();
  const value = process.env[name];
  if (!value) {
    process.stderr.write(
      `${name} is required. Set QA_EMAIL and QA_PASSWORD for the shared QA account in .env.local (or the environment) before running this script.\n`,
    );
    process.exit(1);
  }
  return value;
}
