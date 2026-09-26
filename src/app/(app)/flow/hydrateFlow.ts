/**
 * `get_flow_page`'s ranking (`{ waveId, bucket }[]`) → `FlowWave[]`, batched
 * exactly like `hydrateWaveCards` (`src/lib/feed/hydrate.ts`) does for
 * Home/Explore — one round trip per related table across the whole page,
 * never one per Wave. Order is preserved: `getWavesByIds` does not
 * guarantee it, so the ranking's own order drives the output, not the
 * fetch's.
 */

import { resolveWavePeaks } from "@/lib/audio/peaks";
import { getAudioAssetsByIds } from "@/lib/db/audioAssets";
import { getProfilesByIds } from "@/lib/db/profiles";
import type { Db } from "@/lib/db/types";
import { getWavesByIds, listEchoedWaveIds, listSavedWaveIds } from "@/lib/db/waves";
import type { FlowWave } from "@/components/flow";

export interface RankedFlowId {
  readonly waveId: string;
  readonly bucket: number;
}

export async function hydrateFlowWaves(
  db: Db,
  ranked: readonly RankedFlowId[],
  viewerId: string,
): Promise<FlowWave[]> {
  if (ranked.length === 0) {
    return [];
  }

  const waveIds = ranked.map((entry) => entry.waveId);
  const waves = await getWavesByIds(db, waveIds);
  const waveById = new Map(waves.map((wave) => [wave.id, wave]));

  const creatorIds = [...new Set(waves.map((wave) => wave.creatorId))];
  const assetIds = [...new Set(waves.map((wave) => wave.audioAssetId))];
  const [creators, assets, savedWaveIds, echoedWaveIds] = await Promise.all([
    getProfilesByIds(db, creatorIds),
    getAudioAssetsByIds(db, assetIds),
    listSavedWaveIds(db, viewerId, waveIds),
    listEchoedWaveIds(db, viewerId, waveIds),
  ]);
  const creatorById = new Map(creators.map((creator) => [creator.id, creator]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const assetByWaveId = new Map(waves.map((wave) => [wave.id, assetById.get(wave.audioAssetId)]));

  const items: FlowWave[] = [];
  const seenWaveIds = new Set<string>();
  for (const { waveId, bucket } of ranked) {
    // Defense in depth against review3 finding 18 (`get_flow_page`'s
    // `invitations` CTE could emit a Wave already present in the ranked
    // stream): `FlowScreen` keys its windowed items on `wave.id`, so any
    // duplicate here is a React duplicate-key collision — never trust the
    // RPC's output alone for uniqueness.
    if (seenWaveIds.has(waveId)) continue;
    const wave = waveById.get(waveId);
    if (!wave) continue;
    const creator = creatorById.get(wave.creatorId);
    const asset = assetByWaveId.get(wave.id);
    // Data-integrity edge case (RLS hid the creator/asset, or it no longer
    // resolves) — skip rather than render a broken Wave, matching
    // `hydrateWaveCards`'s own rule.
    if (!creator || !asset) continue;
    seenWaveIds.add(waveId);

    items.push({
      id: wave.id,
      bucket,
      title: wave.title,
      publishedAt: wave.publishedAt,
      creatorId: creator.id,
      creator: {
        username: creator.username,
        displayName: creator.displayName ?? undefined,
        avatarUrl: creator.avatarUrl,
      },
      creationType: wave.creationType,
      duetMode: wave.duet.mode,
      cypherOrder: wave.duet.cypherOrder,
      genre: wave.tags[0] ?? null,
      audioAssetId: asset.id,
      peaks: resolveWavePeaks(asset.peaks?.data, asset.id, asset.peaks?.bits),
      duration: asset.durationMs ? asset.durationMs / 1000 : undefined,
      metrics: {
        plays: wave.counts.plays,
        replays: wave.counts.replays,
        comments: wave.counts.comments,
        saves: wave.counts.saves,
        shares: wave.counts.shares,
        duets: wave.counts.duets,
      },
      isSaved: savedWaveIds.has(wave.id),
      isEchoed: echoedWaveIds.has(wave.id),
      echoCount: wave.counts.echoes,
      canRequestDuet: wave.creatorId !== viewerId && wave.duetPermission !== "nobody",
      isInvitation: bucket === 5,
    });
  }
  return items;
}
