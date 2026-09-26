import type { TraceHue } from "@/components/audio";
import type { DuetMode, WaveCreationType } from "@/types/domain";

export interface FlowPerson {
  readonly username: string;
  readonly displayName?: string;
  readonly avatarUrl: string | null;
}

export interface FlowMetrics {
  readonly plays: number;
  readonly replays: number;
  readonly comments: number;
  readonly saves: number;
  readonly shares: number;
  readonly duets: number;
}

/**
 * One Wave as Flow renders it — built by `hydrateFlowWaves`
 * (`src/app/(app)/flow/hydrateFlow.ts`) from `get_flow_page`'s ranking plus
 * the same batched creator/asset/saved reads `hydrateWaveCards` uses for
 * Home/Explore.
 */
export interface FlowWave {
  readonly id: string;
  /** 1-5, from `get_flow_page` — see `docs/FLOW.md` "Ranking". */
  readonly bucket: number;
  readonly title: string;
  readonly publishedAt: string;
  readonly creatorId: string;
  readonly creator: FlowPerson;
  readonly creationType: WaveCreationType;
  readonly duetMode: DuetMode | null;
  readonly cypherOrder: number | null;
  /** `tags[0]`, for the genre trace tint (`genreHueForTag`) and the metadata line. */
  readonly genre: string | null;
  readonly audioAssetId: string;
  readonly peaks: readonly number[];
  readonly duration?: number;
  readonly metrics: FlowMetrics;
  readonly isSaved: boolean;
  /**
   * Echo (`docs/ECHOES.md`). Flow was the one surface the Echo pass left out —
   * its "Known gaps" called wiring it here "purely a UI wiring task for later"
   * — which meant the product's single appreciation gesture was missing from
   * its own default screen.
   */
  readonly isEchoed: boolean;
  readonly echoCount: number;
  /** Optimistic, mirrors `toCardWave`'s own `canRequestDuet` default — the real gate is server-side (`can_request_duet`). */
  readonly canRequestDuet: boolean;
  /** `bucket === 5`: a backing-track/open-call invitation slot (`docs/FLOW.md` "every ~8th slot"). */
  readonly isInvitation: boolean;
}

/** The mode/genre trace hue for one Wave, or `undefined` for the plain current. */
export function flowTraceHue(wave: Pick<FlowWave, "creationType" | "duetMode" | "cypherOrder" | "genre">, genreHueForTag: (tag: string | null) => TraceHue | undefined): TraceHue | undefined {
  if (wave.creationType === "duet") {
    if (wave.duetMode === "atisma") return "atisma";
    if (wave.duetMode === "cypher") {
      const order = Math.max(1, wave.cypherOrder ?? 1);
      const cypherHues: readonly TraceHue[] = ["cypher-1", "cypher-2", "cypher-3", "cypher-4"];
      return cypherHues[(order - 1) % cypherHues.length];
    }
  }
  return genreHueForTag(wave.genre);
}
