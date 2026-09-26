/**
 * Shared hydration for Profile → Settings → Content's four tabs (spec §25:
 * Saved, Commented, Waves, Duets) — turns a page of bare `Wave` rows into
 * something `WaveCardContainer` can render directly.
 *
 * Unlike `src/lib/db/profileWaves.ts` (which pre-mints a signed playback URL
 * for the plain, non-container `WaveCard` on the profile page), this only
 * needs `audioAssetId` + `peaks`/`duration` — `WaveCardContainer` resolves
 * the signed URL itself, lazily, on first play (`GET
 * /api/audio/[assetId]/url`). No admin client, no upfront signing.
 */

import { getAudioAssetById } from "@/lib/db/audioAssets";
import { getProfilesByIds } from "@/lib/db/profiles";
import { getEchoedWaveIds } from "@/lib/db/echoes";
import { getSavedWaveIds } from "@/lib/db/saves";
import type { Db } from "@/lib/db/types";
import { listWaveCollaboratorProfiles } from "@/lib/db/waves";
import { resolveWavePeaks } from "@/lib/audio/peaks";
import type { Page, Wave, WaveCreationType } from "@/types/domain";

export interface ContentCardPerson {
  readonly username: string;
  readonly displayName?: string;
  readonly avatarUrl?: string | null;
}

export interface ContentWaveCard {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly creator: ContentCardPerson;
  readonly collaborators: ContentCardPerson[];
  readonly creationType: WaveCreationType;
  readonly audioAssetId: string;
  readonly peaks: readonly number[];
  readonly duration?: number;
  readonly metrics: {
    plays: number;
    replays: number;
    comments: number;
    saves: number;
    shares: number;
    duets: number;
  };
  readonly isSaved: boolean;
  /**
   * Echo (`docs/ECHOES.md`). These lists render a full `WaveCardContainer`,
   * which already carries the Echo control — but without these two fields it
   * rendered un-echoed with no count on every row, so a Wave the viewer had
   * echoed looked un-echoed here. The other half of the gap
   * `docs/ECHOES.md`'s "Known gaps" recorded, alongside Flow.
   */
  readonly isEchoed: boolean;
  readonly echoCount: number;
  readonly canRequestDuet: boolean;
}

/**
 * `viewerId` is whoever is looking at the list (always the signed-in owner
 * of the Settings page, but kept as a parameter rather than assumed, so this
 * stays reusable). Waves the viewer created themselves never offer "Request
 * a Duet" — `can_request_duet` would return false for them anyway (spec
 * §15: "You do not request a Duet on your own Wave"), so that case is
 * short-circuited locally instead of spending an RPC round trip on every
 * "my Waves"/"my Duets" row.
 */
export async function hydrateContentWaveCards(
  db: Db,
  viewerId: string,
  waves: readonly Wave[],
): Promise<ContentWaveCard[]> {
  if (waves.length === 0) {
    return [];
  }

  const creatorIds = [...new Set(waves.map((w) => w.creatorId))];
  const waveIds = waves.map((w) => w.id);

  const [creators, savedIds, echoedIds, collaboratorsPerWave, assets, duetFlags] = await Promise.all([
    getProfilesByIds(db, creatorIds),
    getSavedWaveIds(db, viewerId, waveIds),
    getEchoedWaveIds(db, viewerId, waveIds),
    Promise.all(waves.map((w) => listWaveCollaboratorProfiles(db, w.id).catch(() => []))),
    Promise.all(waves.map((w) => getAudioAssetById(db, w.audioAssetId).catch(() => null))),
    Promise.all(
      waves.map(async (w) => {
        if (w.creatorId === viewerId) return false;
        const { data } = await db.rpc("can_request_duet", { p_wave_id: w.id });
        return data === true;
      }),
    ),
  ]);

  const creatorById = new Map(creators.map((c) => [c.id, c]));

  return waves.map((wave, index) => {
    const creator = creatorById.get(wave.creatorId);
    const asset = assets[index];
    const collaborators = (collaboratorsPerWave[index] ?? []).map(({ profile }) => ({
      username: profile.username,
      displayName: profile.displayName ?? undefined,
      avatarUrl: profile.avatarUrl,
    }));

    return {
      id: wave.id,
      title: wave.title,
      description: wave.description ?? undefined,
      createdAt: wave.publishedAt,
      creator: creator
        ? { username: creator.username, displayName: creator.displayName ?? undefined, avatarUrl: creator.avatarUrl }
        : { username: "unknown" },
      collaborators,
      creationType: wave.creationType,
      audioAssetId: wave.audioAssetId,
      peaks: resolveWavePeaks(asset?.peaks?.data, wave.audioAssetId, asset?.peaks?.bits),
      duration: asset?.durationMs ? asset.durationMs / 1000 : undefined,
      metrics: {
        plays: wave.counts.plays,
        replays: wave.counts.replays,
        comments: wave.counts.comments,
        saves: wave.counts.saves,
        shares: wave.counts.shares,
        duets: wave.counts.duets,
      },
      isSaved: savedIds.has(wave.id),
      isEchoed: echoedIds.has(wave.id),
      echoCount: wave.counts.echoes,
      canRequestDuet: duetFlags[index] ?? false,
    };
  });
}

export interface ContentWavePage {
  items: ContentWaveCard[];
  nextCursor: string | null;
}

export async function hydrateContentWavePage(
  db: Db,
  viewerId: string,
  page: Page<Wave>,
): Promise<ContentWavePage> {
  return { items: await hydrateContentWaveCards(db, viewerId, page.items), nextCursor: page.nextCursor };
}
