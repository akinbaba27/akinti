/**
 * `saves` (bookmarks). Private to the saver by RLS — only the aggregate
 * `waves.save_count` is public (spec s14).
 */

import type { Page, Wave } from "@/types/domain";

import { toWave } from "./mappers";
import type { Db } from "./types";
import { buildPage, clampLimit, decodeCursor, encodeCursor, keysetFilter, unwrap, unwrapMaybe } from "./types";

export async function saveWave(db: Db, profileId: string, waveId: string): Promise<void> {
  const result = await db
    .from("saves")
    .upsert(
      { profile_id: profileId, wave_id: waveId },
      // `ignoreDuplicates` makes this ON CONFLICT DO NOTHING rather than DO
      // UPDATE. Saving an already-saved Wave has to be a no-op, and the DO
      // UPDATE form cannot be: `saves` has SELECT/INSERT/DELETE policies but no
      // UPDATE one, so the conflict path failed with 42501 "new row violates
      // row-level security policy". Reachable from a double tap, a second tab,
      // or server-rendered state that was already stale.
      { onConflict: "profile_id,wave_id", ignoreDuplicates: true },
    );
  if (result.error) {
    throw result.error;
  }
}

export async function unsaveWave(db: Db, profileId: string, waveId: string): Promise<void> {
  const result = await db.from("saves").delete().eq("profile_id", profileId).eq("wave_id", waveId);
  if (result.error) {
    throw result.error;
  }
}

export async function isWaveSaved(db: Db, profileId: string, waveId: string): Promise<boolean> {
  const result = await db
    .from("saves")
    .select("wave_id")
    .eq("profile_id", profileId)
    .eq("wave_id", waveId)
    .maybeSingle();
  return unwrapMaybe("isWaveSaved", result) !== null;
}

/** Batch form of `isWaveSaved`, for hydrating a page of Wave cards (spec §25 Content tabs) without one round trip per card. */
export async function getSavedWaveIds(db: Db, profileId: string, waveIds: readonly string[]): Promise<Set<string>> {
  if (waveIds.length === 0) {
    return new Set();
  }
  const result = await db
    .from("saves")
    .select("wave_id")
    .eq("profile_id", profileId)
    .in("wave_id", waveIds as string[]);
  const rows = unwrap("getSavedWaveIds", { data: result.data ?? [], error: result.error });
  return new Set(rows.map((r) => r.wave_id));
}

/** Profile → Saved (spec s14/s25). Two-step: save rows, then their Waves. */
export async function listSavedWaves(
  db: Db,
  profileId: string,
  params: { limit?: number; cursor?: string | null } = {},
): Promise<Page<Wave>> {
  const limit = clampLimit(params.limit);
  // `saves` has no surrogate id (its primary key is `(profile_id, wave_id)`);
  // scoped to one `profile_id` here, `wave_id` is itself unique per row, so it
  // is a valid tiebreaker for the `(created_at, wave_id)` composite cursor.
  let query = db
    .from("saves")
    .select("wave_id, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .order("wave_id", { ascending: false })
    .limit(limit + 1);
  if (params.cursor) {
    query = query.or(keysetFilter("created_at", "wave_id", decodeCursor(params.cursor)));
  }
  const result = await query;
  const rows = unwrap("listSavedWaves", { data: result.data ?? [], error: result.error });
  const page = buildPage(rows, limit, (r) => encodeCursor(r.created_at, r.wave_id));

  if (page.items.length === 0) {
    return { items: [], nextCursor: page.nextCursor };
  }
  const waveIds = page.items.map((r) => r.wave_id);
  const wavesResult = await db.from("waves").select("*").in("id", waveIds).is("deleted_at", null);
  const waveRows = unwrap("listSavedWaves:waves", { data: wavesResult.data ?? [], error: wavesResult.error });
  const byId = new Map(waveRows.map((w) => [w.id, toWave(w)]));
  // Preserve save order; a Wave the saver could no longer see is skipped.
  const items = page.items.map((r) => byId.get(r.wave_id)).filter((w): w is Wave => w !== undefined);
  return { items, nextCursor: page.nextCursor };
}
