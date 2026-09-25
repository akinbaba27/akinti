/**
 * Batch-hydrates a page of `Wave` rows into `WaveCardContainer`-ready cards.
 *
 * Every read here is batched across the whole page (spec s35: efficient
 * queries, never N+1 per card) except audio assets — `src/lib/db/audioAssets.ts`
 * (owned by the audio agent) exposes only a single-id read, so that one is
 * `Promise.all`'d across the page instead. This does not fetch playable audio
 * itself: `WaveCardContainer` already resolves a signed URL lazily, on first
 * play, so nothing here touches storage or preloads audio bytes.
 */

import type { WaveCardContainerWave } from "@/components/wave";
import { getAudioAssetById } from "@/lib/db/audioAssets";
import { getProfilesByIds } from "@/lib/db/profiles";
import type { Db } from "@/lib/db/types";
import { listCollaboratorsForWaves, listEchoedWaveIds, listSavedWaveIds } from "@/lib/db/waves";
import type { Wave } from "@/types/domain";

import { toCardWave } from "./toCardWave";

export async function hydrateWaveCards(
  db: Db,
  waves: readonly Wave[],
  viewerId: string | null,
): Promise<WaveCardContainerWave[]> {
  if (waves.length === 0) {
    return [];
  }

  const waveIds = waves.map((w) => w.id);
  const creatorIds = [...new Set(waves.map((w) => w.creatorId))];

  const [creators, assets, collaboratorsByWave, savedWaveIds, echoedWaveIds] = await Promise.all([
    getProfilesByIds(db, creatorIds),
    Promise.all(waves.map((w) => getAudioAssetById(db, w.audioAssetId))),
    listCollaboratorsForWaves(db, waveIds),
    viewerId ? listSavedWaveIds(db, viewerId, waveIds) : Promise.resolve(new Set<string>()),
    viewerId ? listEchoedWaveIds(db, viewerId, waveIds) : Promise.resolve(new Set<string>()),
  ]);

  const creatorById = new Map(creators.map((c) => [c.id, c]));
  const assetByWaveId = new Map(waves.map((w, index) => [w.id, assets[index]]));

  const collaboratorProfileIds = [...collaboratorsByWave.values()]
    .flat()
    .map((c) => c.profileId);
  const collaboratorProfiles =
    collaboratorProfileIds.length > 0
      ? await getProfilesByIds(db, [...new Set(collaboratorProfileIds)])
      : [];
  const collaboratorProfileById = new Map(collaboratorProfiles.map((p) => [p.id, p]));

  const cards: WaveCardContainerWave[] = [];
  for (const wave of waves) {
    const creator = creatorById.get(wave.creatorId);
    const asset = assetByWaveId.get(wave.id);
    // Data-integrity edge case (a Wave whose creator/asset RLS hid or which
    // no longer resolves) — skip rather than render a broken card.
    if (!creator || !asset) {
      continue;
    }
    cards.push(
      toCardWave(wave, creator, asset, {
        isSaved: savedWaveIds.has(wave.id),
        isEchoed: echoedWaveIds.has(wave.id),
        collaborators: collaboratorsByWave.get(wave.id),
        collaboratorProfiles: collaboratorProfileById,
      }),
    );
  }
  return cards;
}
