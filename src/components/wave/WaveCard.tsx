"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { WavePlayer, type TraceHue } from "@/components/audio";
import { ProMark } from "@/components/pro/ProMark";
import { Avatar, Badge, Button, IconButton, Skeleton } from "@/components/ui";
import { Bookmark, MessageSquare, Share2, Waves } from "@/components/ui/icons";
import {
  CREATION_TYPES,
  METRICS,
  type CreationType,
  type MetricKey,
} from "@/config/terminology";
import { routes } from "@/config/routes";
import type { PlaybackEndedEvent, PlaybackProgressEvent } from "@/lib/audio";
import { cn, formatAbsoluteTime, formatCount, timeAgo, toIsoString } from "@/lib/ui";

import { WaveSeparator } from "./WaveSeparator";

export interface WaveCardPerson {
  readonly username: string;
  readonly displayName?: string;
  readonly avatarUrl?: string | null;
  /** AKINTI Pro (Wave F, PRODUCT_V2 §5) — from `withIsPro` (`src/lib/db/mappers.ts`). Draws the ink `ProMark`, detail variant only. */
  readonly isPro?: boolean;
}

/**
 * Social signals shown on a Wave. `saves`/`shares`/etc. here are the generic,
 * pluralized metrics row (`METRICS`/`MetricKey`, `@/config/terminology`) —
 * Echo (Wave E, `docs/ECHOES.md`) is deliberately NOT one of them: it is a
 * single, distinctive appreciation gesture with its own button and its own
 * count (`WaveCardWave.echoCount`/`isEchoed`), not folded into this
 * "312 plays · 41 replays · ..." sentence.
 */
export type WaveCardMetrics = Readonly<Record<MetricKey, number>>;

export interface WaveCardWave {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly createdAt: string | number | Date;
  readonly creator: WaveCardPerson;
  readonly collaborators?: readonly WaveCardPerson[];
  readonly creationType: CreationType;
  readonly audioUrl: string;
  readonly peaks: readonly number[];
  readonly duration?: number;
  readonly metrics: WaveCardMetrics;
  readonly isSaved?: boolean;
  /** Echoes (Wave E) — a lightweight, visible appreciation count. Omitted (or 0) prints nothing, matching every other count in this product (§12.6, §12.23: never a printed zero). */
  readonly echoCount?: number;
  readonly isEchoed?: boolean;
  /** False when the creator does not accept Duet Requests. */
  readonly canRequestDuet?: boolean;
  /**
   * The viewer has no recorded listen for this Wave. Draws the unheard mark:
   * one of the five places Signal is allowed to appear (§4.1).
   */
  readonly unheard?: boolean;
  /**
   * The creator's signature hue (COLOR_V2 "Profile signature trace" /
   * `Profile.signatureHue`, `src/types/domain.ts`), recolouring only the
   * unplayed part of the trace. Omitted draws the plain current, as always.
   */
  readonly hue?: TraceHue;
  /**
   * `wave.tags` (`src/types/domain.ts`), first entry only meaningfully used
   * today: the desktop Explore card grid (`ExploreWaveCard`) derives its
   * genre tint from `tags[0]` via `genreHueForTag`, the same mapping Flow's
   * `flowTraceHue` uses for its own genre field. Optional — a card with no
   * tags just draws the plain current, as every card always has.
   */
  readonly tags?: readonly string[];
}

export type WaveCardVariant = "stream" | "detail";

export interface WaveCardProps {
  wave: WaveCardWave;
  onComment?: (waveId: string) => void;
  onEcho?: (waveId: string) => void;
  onSave?: (waveId: string) => void;
  onShare?: (waveId: string) => void;
  onRequestDuet?: (waveId: string) => void;
  /** Raw playback ticks; a metrics layer decides what counts as a Play. */
  onProgress?: (event: PlaybackProgressEvent) => void;
  onEnded?: (event: PlaybackEndedEvent) => void;
  /** Overflow menu, report action, etc. */
  headerAction?: ReactNode;
  /**
   * `stream` is a row in a feed: a 56px trace and a waterline separator.
   * `detail` is the Wave's own page: a 144px trace bleeding past both page
   * edges, no separator, and the Request a Duet key (§8.3, §8.4).
   */
  variant?: WaveCardVariant;
  className?: string;
}

/**
 * A Wave in a stream (§8.3).
 *
 * There is no card. The Wave sits directly on the paper, hung on the 44px
 * rail, and is divided from its neighbour by a waterline drawn from its own
 * peaks — not by a border, a shadow or a rounded box (§12.1).
 *
 *   rail 44px  |  text column
 *   avatar     |  Ayşe Kaya  @aysek                       2h
 *              |  [recorded]
 *              |  Sabah provası
 *   full-bleed waveform, 56px, mirrored, bottom half at 70%
 *   0:14                                                  2:07
 *              |  ( play ) ( comment ) ( save ) ( share )
 *              |  312 plays · 41 replays · 6 duets
 *   ══════════════ waterline separator
 *
 * Hierarchy: waveform, then title, then creator, then controls, then counts.
 * The waveform is the largest, highest-contrast element in every item.
 *
 * "Request a Duet" is deliberately not here. It lives on the Wave detail and
 * in the long-press menu: a filled primary key on every row is what made the
 * previous build read as a template (§8.3, §12.40).
 */
export function WaveCard({
  wave,
  onComment,
  onEcho,
  onSave,
  onShare,
  onRequestDuet,
  onProgress,
  onEnded,
  headerAction,
  variant = "stream",
  className,
}: WaveCardProps) {
  const tTerms = useTranslations("Terms");
  const tCard = useTranslations("WaveCard");
  const creationType = CREATION_TYPES[wave.creationType];
  const creatorName = wave.creator.displayName ?? wave.creator.username;
  const collaborators = wave.collaborators ?? [];
  const detail = variant === "detail";
  // "Request a Duet" belongs on the Wave detail and in the long-press menu,
  // never on a stream row (§8.3).
  const showDuetKey = detail && (wave.canRequestDuet ?? true);

  return (
    <article
      aria-labelledby={`wave-${wave.id}-title`}
      className={cn("flex flex-col", className)}
    >
      {/* 20px above, 24px below: the separator sits closer to the item it
          ends than to the item it starts (§5.1). */}
      <div className="akinti-rail akinti-page pt-5 pb-6">
        <Link
          href={routes.profile(wave.creator.username)}
          className="relative row-span-2 self-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <Avatar name={creatorName} src={wave.creator.avatarUrl} size="md" />
          {wave.unheard ? (
            <>
              {/* Signal, on unheard audio. Not a badge, not a count: a mark
                  that says there is sound here you have not played (§4.1). */}
              <span
                aria-hidden="true"
                className="absolute -top-0.5 -right-0.5 size-2 rounded-label bg-signal"
              />
              <span className="sr-only">{tCard("unheard")}</span>
            </>
          ) : null}
        </Link>

        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <Link
              href={routes.profile(wave.creator.username)}
              className="type-subhead truncate text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              {creatorName}
            </Link>
            <span className="type-caption truncate text-ink-subtle">
              @{wave.creator.username}
            </span>
            {detail && wave.creator.isPro ? <ProMark /> : null}
            <time
              dateTime={toIsoString(wave.createdAt)}
              title={formatAbsoluteTime(wave.createdAt)}
              className="type-mono-sm ml-auto shrink-0 text-ink-subtle"
            >
              {timeAgo(wave.createdAt)}
            </time>
            {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
          </div>

          <div className="flex">
            <Badge>{tTerms(creationType.id)}</Badge>
          </div>
        </div>

        <h3
          id={`wave-${wave.id}-title`}
          className="akinti-rail-span type-heading mt-4 text-ink"
        >
          <Link
            href={routes.wave(wave.id)}
            className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {wave.title}
          </Link>
        </h3>
      </div>

      {/* The trace bleeds past both page edges in every variant, not only
          `detail` (§8.3, §1): no `akinti-page` inset here, exactly like
          `WaveSeparator` below, which is already full-bleed by having no
          page padding of its own. */}
      <WavePlayer
        waveId={wave.id}
        src={wave.audioUrl}
        peaks={wave.peaks}
        duration={wave.duration}
        title={wave.title}
        creatorUsername={wave.creator.username}
        onProgress={onProgress}
        onEnded={onEnded}
        variant={detail ? "detail" : "inline"}
        hue={wave.hue}
        fullBleed
      />

      <div className="akinti-rail akinti-page pt-4 pb-5">
        <div className="col-start-2 flex min-w-0 flex-col gap-4">
          {wave.description ? (
            <p className="type-body-sm measure whitespace-pre-line text-ink-muted">
              {wave.description}
            </p>
          ) : null}

          {collaborators.length > 0 ? (
            <p className="type-caption flex flex-wrap items-center gap-2 text-ink-subtle">
              <span className="text-ink-muted">{tTerms("collaborators")}</span>
              {collaborators.map((person) => (
                <Link
                  key={person.username}
                  href={routes.profile(person.username)}
                  className="text-ink-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  @{person.username}
                </Link>
              ))}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <IconButton
                label={wave.isEchoed ? tTerms("unecho") : tTerms("echo")}
                icon={<Waves className="size-5" weight={wave.isEchoed ? "fill" : "regular"} />}
                size="sm"
                aria-pressed={wave.isEchoed ?? false}
                className={cn(wave.isEchoed && "text-ink")}
                onClick={() => onEcho?.(wave.id)}
              />
              {wave.echoCount ? (
                <>
                  {/* The glyph is aria-hidden because `formatCount` abbreviates
                      ("1.2K"); the sr-only span next to it carries the same
                      count spelled out with its pluralized noun, the way the
                      metrics row below already reads counts out. Without it the
                      Echo count was the one count on this card that screen
                      readers could not reach at all. */}
                  <span className="type-mono-sm text-ink-muted" aria-hidden="true">
                    {formatCount(wave.echoCount)}
                  </span>
                  <span className="sr-only">
                    {wave.echoCount} {tCard("echoCount", { count: wave.echoCount })}
                  </span>
                </>
              ) : null}
            </div>
            <IconButton
              label={tTerms("comment")}
              icon={<MessageSquare className="size-5" />}
              size="sm"
              onClick={() => onComment?.(wave.id)}
            />
            <IconButton
              label={wave.isSaved ? tTerms("unsave") : tTerms("save")}
              icon={
                <Bookmark className="size-5" weight={wave.isSaved ? "fill" : "regular"} />
              }
              size="sm"
              aria-pressed={wave.isSaved ?? false}
              className={cn(wave.isSaved && "text-ink")}
              onClick={() => onSave?.(wave.id)}
            />
            <IconButton
              label={tTerms("share")}
              icon={<Share2 className="size-5" />}
              size="sm"
              onClick={() => onShare?.(wave.id)}
            />
          </div>

          <MetricsRow metrics={wave.metrics} />

          {showDuetKey ? (
            <div className="flex">
              <Button variant="secondary" size="sm" onClick={() => onRequestDuet?.(wave.id)}>
                {tTerms("requestDuet")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {detail ? null : <WaveSeparator peaks={wave.peaks} />}
    </article>
  );
}

interface MetricsRowProps {
  metrics: WaveCardMetrics;
}

const METRIC_LABEL_KEY = {
  plays: "metricPlays",
  replays: "metricReplays",
  comments: "metricComments",
  saves: "metricSaves",
  shares: "metricShares",
  duets: "metricDuets",
} as const satisfies Record<MetricKey, string>;

/**
 * Counts print only non-zero metrics, on one line, separated by a single
 * middle dot. Six zeroes is a debug dump (§8.3, §12.6, §12.23).
 */
function MetricsRow({ metrics }: MetricsRowProps) {
  const t = useTranslations("WaveCard");
  const shown = METRICS.filter((metric) => (metrics[metric.key] ?? 0) > 0);
  if (shown.length === 0) return null;

  return (
    <p className="type-caption text-ink-subtle">
      {shown.map((metric, index) => {
        const value = metrics[metric.key] ?? 0;
        return (
          <span key={metric.key}>
            {index > 0 ? <span aria-hidden="true"> · </span> : null}
            <span className="type-mono-sm text-ink-muted">{formatCount(value)}</span>{" "}
            {t(METRIC_LABEL_KEY[metric.key], { count: value })}
          </span>
        );
      })}
    </p>
  );
}

export interface WaveCardSkeletonProps {
  variant?: WaveCardVariant;
  className?: string;
}

/**
 * Shaped to the final layout: a rail squircle, two text bars at 45% and 70%
 * width, and a flat 6px waterline where the trace will be. No shimmer, no
 * pulse, no fake waveform (§8.15, §12.32).
 */
export function WaveCardSkeleton({ variant = "stream", className }: WaveCardSkeletonProps) {
  const tTerms = useTranslations("Terms");
  const tCard = useTranslations("WaveCard");
  return (
    <div
      role="status"
      aria-label={tCard("loadingAWave", { aWave: tTerms("aWave") })}
      className={cn("flex flex-col", className)}
    >
      <div className="akinti-rail akinti-page pt-5 pb-6">
        <Skeleton shape="circle" />
        <div className="flex flex-col gap-3">
          <Skeleton width="45%" />
          <Skeleton width="70%" height="1.1875rem" />
        </div>
      </div>
      <div className="akinti-page pb-6">
        <Skeleton shape="waterline" />
      </div>
      {variant === "detail" ? null : <div className="h-px w-full bg-hairline" />}
    </div>
  );
}
