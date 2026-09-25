"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useReducer, useState, type MouseEvent, type ReactNode } from "react";

import { echoWave, saveWave, unechoWave, unsaveWave } from "@/app/(app)/w/[id]/interactions";
import { WavePlayer } from "@/components/audio";
import { useSignedAudio } from "@/components/feed";
import { Avatar, Badge, IconButton, useToast } from "@/components/ui";
import { Bookmark, MessageSquare, Share2, Waves } from "@/components/ui/icons";
import { routes } from "@/config/routes";
import { CREATION_TYPES, METRICS, type CreationType, type MetricKey } from "@/config/terminology";
import { echoReducer, saveReducer } from "@/lib/interactions";
import { emitAnalyticsEvent, usePlayTracker } from "@/lib/metrics";
import { cn, formatAbsoluteTime, formatCount } from "@/lib/ui";

/**
 * Code-split, matching `WaveCardContainer.tsx`'s own `ShareSheet` import
 * (fixQA2 item 4, TBT): every visit to a Wave's own page statically pulled in
 * the whole Share Sheet, including its conversation picker and messaging
 * actions, whether or not Share was ever tapped — closeout perf pass,
 * `/w/[id]` was 3KB over its 340KB budget. Deferred to its own chunk,
 * fetched only on first tap.
 */
const ShareSheet = dynamic(() => import("@/components/share").then((mod) => mod.ShareSheet));

const METRIC_LABEL_KEY = {
  plays: "metricPlays",
  replays: "metricReplays",
  comments: "metricComments",
  saves: "metricSaves",
  shares: "metricShares",
  duets: "metricDuets",
} as const satisfies Record<MetricKey, string>;

export interface WaveDetailPerson {
  readonly username: string;
  readonly displayName?: string;
  readonly avatarUrl?: string | null;
}

export interface WaveDetailWave {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly publishedAt: string;
  readonly creator: WaveDetailPerson;
  readonly collaborators: readonly WaveDetailPerson[];
  readonly creationType: CreationType;
  readonly audioAssetId: string;
  readonly peaks: readonly number[];
  readonly duration?: number;
  readonly metrics: Readonly<Record<MetricKey, number>>;
  readonly isSaved: boolean;
  /** Echoes (Wave E, `docs/ECHOES.md`) — a lightweight, visible appreciation count, shown next to its own button, not folded into the metrics row. */
  readonly echoCount?: number;
  readonly isEchoed?: boolean;
  readonly canRequestDuet: boolean;
}

export interface WaveDetailProps {
  wave: WaveDetailWave;
  /** Rendered between the metrics and the comments, e.g. the Duet chain. */
  children?: ReactNode;
}

/**
 * The Wave detail (SCREENS.md §5).
 *
 * The one screen where the trace is allowed to be enormous: 144px, bleeding
 * past both page edges, above everything else on the screen and larger than
 * anything else on it. The order is deliberate and different from the stream:
 * trace, transport, title, creator, description, counts, then the actions.
 *
 * The signed playback URL is resolved on mount here rather than on first
 * play. On a stream that would open ten requests nobody asked for; on this
 * screen the reader arrived to hear this one Wave, and the request is a URL
 * mint, not audio bytes.
 */
export function WaveDetail({ wave, children }: WaveDetailProps) {
  const t = useTranslations("WaveDetail");
  const tTerms = useTranslations("Terms");
  const tWavePlayer = useTranslations("WavePlayer");
  const { toast } = useToast();
  usePlayTracker();

  const audio = useSignedAudio(wave.audioAssetId);
  const [shareOpen, setShareOpen] = useState(false);
  const [saveState, dispatchSave] = useReducer(saveReducer, {
    isSaved: wave.isSaved,
    saveCount: wave.metrics.saves,
    status: "idle" as const,
  });
  const [echoState, dispatchEcho] = useReducer(echoReducer, {
    isEchoed: wave.isEchoed ?? false,
    echoCount: wave.echoCount ?? 0,
    status: "idle" as const,
  });

  // Matches `WavePlayer`'s accessible name for its transport control exactly
  // (`${playAction|pauseAction} ...` or `retryPlayback`) — built from the
  // same translated words `WavePlayer` renders, not a hardcoded English regex.
  const transportLabelRe = useMemo(() => {
    const words = [tTerms("playAction"), tTerms("pauseAction"), tWavePlayer("retryPlayback")].map(
      (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    return new RegExp(`^(${words.join("|")})\\b`);
  }, [tTerms, tWavePlayer]);

  const { resolve } = audio;
  useEffect(() => {
    void resolve();
  }, [resolve]);

  // Until the URL lands, a tap on the transport would ask the store to play
  // an empty source. Capture runs outer-to-inner, so this sees the click
  // before the player does, resolves, and then starts playback itself.
  const handleClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (audio.url) return;
      const control = (event.target as HTMLElement).closest("button");
      const label = control?.textContent?.trim() ?? "";
      if (!transportLabelRe.test(label)) return;
      event.preventDefault();
      event.stopPropagation();
      void audio.resolve();
    },
    [audio, transportLabelRe],
  );

  const handleSave = useCallback(() => {
    const willSave = !saveState.isSaved;
    dispatchSave({ type: "toggle" });
    const action = willSave ? saveWave(wave.id) : unsaveWave(wave.id);
    void action.then((result) => {
      if (!result.ok) {
        dispatchSave({ type: "rollback" });
        toast({ title: result.error ?? t("saveError"), tone: "error" });
        return;
      }
      dispatchSave({ type: "confirm" });
      emitAnalyticsEvent({
        name: willSave ? "wave_saved" : "wave_unsaved",
        waveId: wave.id,
        sessionId: "n/a",
        at: Date.now(),
      });
    });
  }, [saveState.isSaved, t, toast, wave.id]);

  const handleEcho = useCallback(() => {
    const willEcho = !echoState.isEchoed;
    dispatchEcho({ type: "toggle" });
    const action = willEcho ? echoWave(wave.id) : unechoWave(wave.id);
    void action.then((result) => {
      if (!result.ok) {
        dispatchEcho({ type: "rollback" });
        toast({ title: result.error ?? t("echoUpdateError"), tone: "error" });
        return;
      }
      dispatchEcho({ type: "confirm" });
    });
  }, [echoState.isEchoed, t, toast, wave.id]);

  const creatorName = wave.creator.displayName ?? wave.creator.username;
  const creationType = CREATION_TYPES[wave.creationType];
  const metrics = { ...wave.metrics, saves: saveState.saveCount };
  const shownMetrics = METRICS.filter((metric) => (metrics[metric.key] ?? 0) > 0);

  return (
    <article aria-labelledby={`wave-${wave.id}-title`} className="flex flex-col">
      <div onClickCapture={handleClickCapture}>
        <WavePlayer
          waveId={wave.id}
          src={audio.url ?? ""}
          peaks={wave.peaks}
          duration={wave.duration}
          title={wave.title}
          creatorUsername={wave.creator.username}
          variant="detail"
          fullBleed
        />
      </div>

      {audio.error ? (
        <p role="alert" className="akinti-page type-caption pt-3 text-signal-deep">
          {audio.error}
        </p>
      ) : null}

      <h1 id={`wave-${wave.id}-title`} className="akinti-page type-title pt-8 text-ink">
        {wave.title}
      </h1>

      {/* Hidden at >= 1024px: the desktop two-column layout
          (DESIGN_V3_DESKTOP.md "Wave page ... right rail with creator
          card") shows this same information as a card in the right rail
          instead (`WaveCreatorCard`, rendered by `page.tsx`) — never both,
          so there is exactly one "who made this" affordance on screen at
          a time. */}
      <div className="akinti-rail akinti-page pt-5 lg:hidden">
        <Link
          href={routes.profile(wave.creator.username)}
          className="self-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <Avatar name={creatorName} src={wave.creator.avatarUrl} size="md" />
        </Link>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex min-w-0 items-baseline gap-2">
            <Link
              href={routes.profile(wave.creator.username)}
              className="type-subhead truncate text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              {creatorName}
            </Link>
            <span className="type-caption truncate text-ink-subtle">@{wave.creator.username}</span>
          </p>
          <p className="type-caption flex items-center gap-2 text-ink-subtle">
            <time dateTime={wave.publishedAt}>{formatAbsoluteTime(wave.publishedAt)}</time>
            <Badge>{tTerms(creationType.id)}</Badge>
          </p>
        </div>
      </div>

      {wave.description ? (
        <p className="akinti-page type-body measure whitespace-pre-line pt-5 text-ink">
          {wave.description}
        </p>
      ) : null}

      {wave.collaborators.length > 0 ? (
        <p className="akinti-page type-caption flex flex-wrap items-center gap-2 pt-5 text-ink-subtle">
          <span className="text-ink-muted">{t("with")}</span>
          {wave.collaborators.map((person) => (
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

      {shownMetrics.length > 0 ? (
        <p className="akinti-page type-caption mt-6 border-y border-hairline py-4 text-ink-subtle">
          {shownMetrics.map((metric, index) => {
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
      ) : null}

      <div className="akinti-page flex items-center gap-2 pt-6">
        <div className="flex items-center gap-1">
          <IconButton
            label={echoState.isEchoed ? tTerms("unecho") : tTerms("echo")}
            icon={<Waves className="size-5" weight={echoState.isEchoed ? "fill" : "regular"} />}
            size="sm"
            showLabel
            aria-pressed={echoState.isEchoed}
            className={cn(echoState.isEchoed && "text-ink")}
            onClick={handleEcho}
          />
          {echoState.echoCount ? (
            <>
              {/* `formatCount` abbreviates ("1.2K"), so the glyph is hidden and
                  the sr-only span carries the exact count with its pluralized
                  noun — the same way the metrics row below reads its counts.
                  Without it the Echo count was the one count on this page no
                  screen reader could reach. */}
              <span className="type-mono-sm text-ink-muted" aria-hidden="true">
                {formatCount(echoState.echoCount)}
              </span>
              <span className="sr-only">
                {echoState.echoCount} {t("echoCount", { count: echoState.echoCount })}
              </span>
            </>
          ) : null}
        </div>
        <IconButton
          label={tTerms("comment")}
          icon={<MessageSquare className="size-5" />}
          size="sm"
          showLabel
          onClick={() => {
            document.getElementById("comments")?.scrollIntoView({ behavior: "smooth" });
          }}
        />
        <IconButton
          label={saveState.isSaved ? tTerms("saved") : tTerms("save")}
          icon={<Bookmark className="size-5" weight={saveState.isSaved ? "fill" : "regular"} />}
          size="sm"
          showLabel
          aria-pressed={saveState.isSaved}
          className={cn(saveState.isSaved && "text-ink")}
          onClick={handleSave}
        />
        <IconButton
          label={tTerms("share")}
          icon={<Share2 className="size-5" />}
          size="sm"
          showLabel
          onClick={() => setShareOpen(true)}
        />
      </div>

      {wave.canRequestDuet ? (
        <div className="akinti-page pt-6">
          <Link
            href={routes.waveDuet(wave.id)}
            className="akinti-press flex h-13 w-full items-center justify-center rounded-key bg-ink px-6 type-subhead text-on-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {tTerms("requestDuet")}
          </Link>
        </div>
      ) : null}

      {children}

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        wave={{ id: wave.id, title: wave.title }}
      />
    </article>
  );
}
