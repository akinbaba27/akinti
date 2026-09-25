/**
 * `Wave` + its creator/asset/collaborators → the shape `WaveCardContainer`
 * expects. `src/app/(app)/w/[id]/page.tsx` builds this same shape inline;
 * this is the shared version Home and Explore use so the transform lives in
 * exactly one place. `WaveCard`/`WaveCardContainer` themselves are never
 * modified (owned by the waves agent) — this only ever produces their
 * existing prop shape.
 */

import type { WaveCardContainerWave, WaveCardPerson } from "@/components/wave";
import { resolveWavePeaks } from "@/lib/audio/peaks";
import type { AudioAsset, Collaborator, Profile, Wave } from "@/types/domain";

export interface ToCardWaveOptions {
  isSaved?: boolean;
  /** Wave E, `docs/ECHOES.md`. */
  isEchoed?: boolean;
  /**
   * Optimistically `true` when omitted. The real authorization check
   * (`can_request_duet`, migration 10) runs server-side the moment a Duet is
   * actually requested — computing it per card here would mean one RPC round
   * trip per Wave on every feed page, which is the exact "load everything
   * up front" cost spec s35 asks feeds to avoid. An over-optimistic button is
   * a UX nuance, not a security gap: RLS is the real gate.
   */
  canRequestDuet?: boolean;
  collaborators?: readonly Collaborator[];
  collaboratorProfiles?: ReadonlyMap<string, Profile>;
}

function toPerson(profile: Profile): WaveCardPerson {
  return {
    username: profile.username,
    displayName: profile.displayName ?? undefined,
    avatarUrl: profile.avatarUrl,
  };
}

export function toCardWave(
  wave: Wave,
  creator: Profile,
  asset: AudioAsset,
  options: ToCardWaveOptions = {},
): WaveCardContainerWave {
  const collaborators = (options.collaborators ?? [])
    .filter((c) => c.status === "accepted")
    .map((c) => options.collaboratorProfiles?.get(c.profileId))
    .filter((profile): profile is Profile => profile !== undefined)
    .map(toPerson);

  return {
    id: wave.id,
    title: wave.title,
    description: wave.description ?? undefined,
    createdAt: wave.publishedAt,
    creator: toPerson(creator),
    collaborators,
    creationType: wave.creationType,
    tags: wave.tags,
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
    isSaved: options.isSaved ?? false,
    isEchoed: options.isEchoed ?? false,
    echoCount: wave.counts.echoes,
    canRequestDuet: options.canRequestDuet ?? true,
  };
}
