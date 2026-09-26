"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { genreHueForTag } from "@/components/feed";
import { Avatar } from "@/components/ui";
import { routes } from "@/config/routes";
import { formatDuration } from "@/lib/ui";

import { FlowRail } from "./FlowRail";
import { FlowTrace } from "./FlowTrace";
import { FlowTransport } from "./FlowTransport";
import { flowTraceHue, type FlowWave } from "./types";

export interface FlowWaveViewProps {
  wave: FlowWave;
  isActive: boolean;
  hasStarted: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loaded: number;
  upNextPeaks: readonly number[] | null;
  onToggle: () => void;
  onScrub: (ratio: number) => void;
  onReplay: () => void;
  onEcho: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
  onDuet: () => void;
}

/**
 * One full-viewport Wave (`docs/FLOW.md` "The screen"). Purely
 * presentational — every gesture and every playback decision lives in
 * `FlowScreen`, which owns the single active Wave's transport state; this
 * only renders it and forwards rail/transport clicks upward.
 */
export function FlowWaveView({
  wave,
  isActive,
  hasStarted,
  isPlaying,
  currentTime,
  duration,
  loaded,
  upNextPeaks,
  onToggle,
  onScrub,
  onReplay,
  onEcho,
  onSave,
  onComment,
  onShare,
  onDuet,
}: FlowWaveViewProps) {
  const t = useTranslations("FlowWaveView");
  const tTerms = useTranslations("Terms");
  const hue = useMemo(() => flowTraceHue(wave, genreHueForTag), [wave]);
  const creatorName = wave.creator.displayName ?? wave.creator.username;
  const modeLabel = wave.creationType === "duet" ? tTerms("duet") : wave.genre ?? tTerms(wave.creationType);
  const state = isActive && isPlaying ? "playing" : "unplayed";
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <section
      aria-label={`${creatorName}, ${wave.title}`}
      className="relative flex h-dvh w-full flex-col justify-between overflow-hidden bg-paper px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]"
    >
      <header className="flex flex-col gap-1">
        <Link
          href={routes.profile(wave.creator.username)}
          className="flex items-center gap-2 self-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <Avatar name={creatorName} src={wave.creator.avatarUrl} size="sm" />
          <span className="type-subhead text-ink">{creatorName}</span>
          <span className="type-caption text-ink-subtle">@{wave.creator.username}</span>
        </Link>
        <h1 className="type-title text-ink">{wave.title}</h1>
        <p className="type-caption flex items-center gap-2 text-ink-subtle">
          <span>{modeLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="type-mono-sm">{formatDuration(wave.duration ?? 0)}</span>
          {wave.isInvitation ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{t("singOverThis")}</span>
            </>
          ) : null}
        </p>
      </header>

      <div className="flex flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <FlowTrace
            peaks={wave.peaks}
            progress={progress}
            loaded={isActive ? loaded : 1}
            state={state}
            hue={hue}
            onScrub={isActive ? onScrub : undefined}
          />
          {!hasStarted && isActive ? (
            <p className="type-caption pt-4 text-ink-subtle">{t("tapToStart")}</p>
          ) : null}
        </div>

        <FlowRail
          isSaved={wave.isSaved}
          saveCount={wave.metrics.saves}
          isEchoed={wave.isEchoed}
          echoCount={wave.echoCount}
          commentCount={wave.metrics.comments}
          shareCount={wave.metrics.shares}
          duetCount={wave.metrics.duets}
          canRequestDuet={wave.canRequestDuet}
          openForDuet={wave.canRequestDuet}
          onReplay={onReplay}
          onEcho={onEcho}
          onSave={onSave}
          onComment={onComment}
          onShare={onShare}
          onDuet={onDuet}
        />
      </div>

      <footer>
        <FlowTransport
          isPlaying={isActive && isPlaying}
          hasStarted={isActive && hasStarted}
          currentTime={isActive ? currentTime : 0}
          duration={duration}
          onToggle={onToggle}
          upNextPeaks={upNextPeaks}
        />
      </footer>
    </section>
  );
}
