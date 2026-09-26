/**
 * `BackingTrack` rows → the `BackingTrackCard` shape every surface that shows
 * the instrumental library renders: Explore's "Tracks to sing over" lane,
 * `/tracks`, Search's Tracks tab and `/create?track=<id>`.
 *
 * All four used to build this inline, and all four built it the same wrong
 * way: read each track's `audio_assets` row with the caller's own
 * RLS-scoped client, then `if (!asset) return;` — silently dropping any track
 * whose asset came back null.
 *
 * Every track's asset came back null. `audio_assets_select` is
 * `can_view_audio_asset(id)`, which grants access only to an asset you own, one
 * hanging off a Wave you may see, or one sent to you in a conversation. A
 * backing track's instrumental is none of those three, and the seeded library
 * is owned by the `akinti_curated` account, so for every real user the read
 * returned nothing and the drop-on-null discarded the entire library. Verified
 * against the live project: 12 tracks visible, 0 of their assets readable, so
 * `/tracks` rendered "No tracks are open for vocals yet" on top of a full
 * shelf — and the same emptiness reached Explore, Search and Create.
 *
 * The fix keeps authorization exactly where it was. `tracks` must already have
 * come from an RLS-scoped read (`listBackingTracks`, `getBackingTrackById`,
 * `requireBackingTrack`), which is the authorization check — the caller cannot
 * pass a track they were not allowed to see, because they could not have read
 * it. Only the asset's own peaks and duration are then read with the admin
 * client, and only for those tracks. That is the pattern `CLAUDE.md` requires
 * ("admin client only after an RLS/RPC authorization check") and the same one
 * `mintPlaybackUrl` already uses to sign a playback URL.
 */

import type { BackingTrackCard } from "@/components/feed";
import { resolveWavePeaks } from "@/lib/audio/peaks";
import type { BackingTrack } from "@/types/domain";
import type { Database } from "@/types/database";

import type { SupabaseClient } from "@supabase/supabase-js";

/** The two asset columns a card needs beyond what the track row already carries. */
interface TrackAudio {
  readonly peaksData: readonly number[] | null;
  readonly peaksBits: number | undefined;
  readonly durationMs: number | null;
}

/**
 * Peaks and duration for a set of already-authorized backing tracks, in one
 * round trip rather than one per track.
 */
async function loadTrackAudio(
  admin: SupabaseClient<Database>,
  assetIds: readonly string[],
): Promise<Map<string, TrackAudio>> {
  const out = new Map<string, TrackAudio>();
  if (assetIds.length === 0) return out;

  const result = await admin
    .from("audio_assets")
    .select("id,peaks,duration_ms")
    .in("id", assetIds as string[]);
  if (result.error || !result.data) return out;

  for (const row of result.data) {
    const peaks = (row.peaks ?? null) as { data?: readonly number[]; bits?: number } | null;
    out.set(row.id, {
      peaksData: Array.isArray(peaks?.data) ? peaks.data : null,
      peaksBits: peaks?.bits,
      durationMs: row.duration_ms ?? null,
    });
  }
  return out;
}

/**
 * Builds a card per track, in the order given.
 *
 * A track whose asset row cannot be read is still rendered, with a resolved
 * fallback trace and no duration, rather than dropped: the instrumental is
 * real and playable either way, and silently vanishing is what made this bug
 * invisible for so long.
 */
export async function toBackingTrackCards(
  admin: SupabaseClient<Database>,
  tracks: readonly BackingTrack[],
): Promise<BackingTrackCard[]> {
  if (tracks.length === 0) return [];

  const audio = await loadTrackAudio(
    admin,
    tracks.map((track) => track.audioAssetId),
  );

  return tracks.map((track) => {
    const found = audio.get(track.audioAssetId);
    return {
      id: track.id,
      title: track.title,
      artistCredit: track.artistCredit,
      sourceUrl: track.sourceUrl,
      audioAssetId: track.audioAssetId,
      peaks: resolveWavePeaks(found?.peaksData ?? null, track.audioAssetId, found?.peaksBits),
      durationSeconds: found?.durationMs ? found.durationMs / 1000 : undefined,
      bpm: track.bpm,
      musicalKey: track.musicalKey,
      genreTags: track.genreTags,
    };
  });
}
