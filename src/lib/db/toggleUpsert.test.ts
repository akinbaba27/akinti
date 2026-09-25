/**
 * The three "toggle" tables (`saves`, `echoes`, `blocks`) must treat a repeat
 * of the same gesture as a no-op. Each is written with a Supabase `upsert`,
 * and the option that decides the SQL matters: without `ignoreDuplicates`,
 * supabase-js emits ON CONFLICT DO UPDATE, which needs an UPDATE row-level
 * security policy. None of these three tables has one (verified against the
 * live project: all three expose SELECT/INSERT/DELETE policies only), so the
 * DO UPDATE form failed with 42501 "new row violates row-level security
 * policy" the moment a second, redundant write arrived — from a double tap, a
 * second tab, or server-rendered state that was already stale.
 *
 * `follows`, `open_calls`, `push_subscriptions` and `challenge_picks` also
 * upsert, but each has a real UPDATE policy (and `challenge_picks`
 * deliberately replaces a row), so they are correct as DO UPDATE and are not
 * covered here.
 */

import { describe, expect, it } from "vitest";

import { blockProfile } from "./blocks";
import { echoWave } from "./echoes";
import { saveWave } from "./saves";
import type { Db } from "./types";

type RecordedUpsert = { table: string; values: unknown; options: unknown };

/** Minimal `Db` stand-in that records the one `.from(...).upsert(...)` each helper makes. */
function recordingDb(): { db: Db; calls: RecordedUpsert[] } {
  const calls: RecordedUpsert[] = [];
  const db = {
    from(table: string) {
      return {
        upsert(values: unknown, options: unknown) {
          calls.push({ table, values, options });
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as Db;
  return { db, calls };
}

describe("toggle writes use ON CONFLICT DO NOTHING", () => {
  const cases = [
    {
      name: "saveWave",
      table: "saves",
      onConflict: "profile_id,wave_id",
      run: (db: Db) => saveWave(db, "profile-1", "wave-1"),
      values: { profile_id: "profile-1", wave_id: "wave-1" },
    },
    {
      name: "echoWave",
      table: "echoes",
      onConflict: "profile_id,wave_id",
      run: (db: Db) => echoWave(db, "profile-1", "wave-1"),
      values: { profile_id: "profile-1", wave_id: "wave-1" },
    },
    {
      name: "blockProfile",
      table: "blocks",
      onConflict: "blocker_id,blocked_id",
      run: (db: Db) => blockProfile(db, "profile-1", "profile-2"),
      values: { blocker_id: "profile-1", blocked_id: "profile-2" },
    },
  ];

  for (const c of cases) {
    it(`${c.name} passes ignoreDuplicates so a repeat gesture is a no-op`, async () => {
      const { db, calls } = recordingDb();
      await c.run(db);
      expect(calls).toHaveLength(1);
      expect(calls[0].table).toBe(c.table);
      expect(calls[0].values).toEqual(c.values);
      expect(calls[0].options).toEqual({ onConflict: c.onConflict, ignoreDuplicates: true });
    });
  }
});
