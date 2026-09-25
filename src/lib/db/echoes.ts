/**
 * `echoes` (Wave E, 2026-09-18, `docs/ECHOES.md`) — a lightweight, visible
 * appreciation signal ("Yankı" in Turkish). Same privacy model as `saves`
 * (`src/lib/db/saves.ts`, the file this one deliberately mirrors line for
 * line): private to the person who echoed by RLS — only the aggregate
 * `waves.echo_count` is public.
 */

import { unwrap, unwrapMaybe } from "./types";
import type { Db } from "./types";

export async function echoWave(db: Db, profileId: string, waveId: string): Promise<void> {
  const result = await db
    .from("echoes")
    .upsert(
      { profile_id: profileId, wave_id: waveId },
      // `ignoreDuplicates` makes this ON CONFLICT DO NOTHING rather than DO
      // UPDATE. Echoing an already-echoed Wave has to be a no-op (docs/ECHOES.md:
      // "Echoing is idempotent and reversible"), and the DO UPDATE form cannot
      // be: `echoes` has SELECT/INSERT/DELETE policies but no UPDATE one, so the
      // conflict path failed with 42501 "new row violates row-level security
      // policy". Reachable from a double tap, a second tab, or server-rendered
      // state that was already stale.
      { onConflict: "profile_id,wave_id", ignoreDuplicates: true },
    );
  if (result.error) {
    throw result.error;
  }
}

export async function unechoWave(db: Db, profileId: string, waveId: string): Promise<void> {
  const result = await db.from("echoes").delete().eq("profile_id", profileId).eq("wave_id", waveId);
  if (result.error) {
    throw result.error;
  }
}

export async function isWaveEchoed(db: Db, profileId: string, waveId: string): Promise<boolean> {
  const result = await db
    .from("echoes")
    .select("wave_id")
    .eq("profile_id", profileId)
    .eq("wave_id", waveId)
    .maybeSingle();
  return unwrapMaybe("isWaveEchoed", result) !== null;
}

/** Batch form of `isWaveEchoed`, for hydrating a page of Wave cards without one round trip per card — mirrors `getSavedWaveIds`/`listSavedWaveIds`. */
export async function getEchoedWaveIds(db: Db, profileId: string, waveIds: readonly string[]): Promise<Set<string>> {
  if (waveIds.length === 0) {
    return new Set();
  }
  const result = await db
    .from("echoes")
    .select("wave_id")
    .eq("profile_id", profileId)
    .in("wave_id", waveIds as string[]);
  const rows = unwrap("getEchoedWaveIds", { data: result.data ?? [], error: result.error });
  return new Set(rows.map((r) => r.wave_id));
}
