"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";

import { Waveform } from "@/components/audio";
import { Chip, IconButton, Spinner } from "@/components/ui";
import { HorizontalScroller } from "@/components/ui/desktop";
import { MusicNotes, Pause, Play, RotateCcw } from "@/components/ui/icons";
import { routes } from "@/config/routes";
import { usePlaybackStore, useWavePlayback } from "@/lib/audio";
import { cn, formatDuration } from "@/lib/ui";

import { useSignedAudio } from "./signedAudio";

export interface BackingTrackCard {
  readonly id: string;
  readonly title: string;
  readonly artistCredit: string;
  readonly sourceUrl: string | null;
  readonly audioAssetId: string;
  readonly peaks: readonly number[];
  readonly durationSeconds?: number;
  readonly bpm: number | null;
  readonly musicalKey: string | null;
  readonly genreTags: readonly string[];
}

export interface BackingTracksLaneProps {
  tracks: readonly BackingTrackCard[];
}

/** The genres actually present in the tracks on screen, most common first. */
function genresOf(tracks: readonly BackingTrackCard[]): string[] {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    for (const tag of track.genreTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/**
 * Tracks to sing over (SCREENS.md §3, PRODUCT_V2 §4).
 *
 * A curated, licence-clear instrumental library. Each row plays where it
 * stands so the choice is made by ear, not by reading a title, and every
 * track carries its own attribution because the licence requires it.
 *
 * The genre row is chips, not pills: 6px-radius hairline tags, with the
 * active one marked by a 2px ink underbar (§8.8, §12.4). The chips list only
 * genres that are actually on this screen.
 */
export function BackingTracksLane({ tracks }: BackingTracksLaneProps) {
  const t = useTranslations("BackingTracksLane");
  const [genre, setGenre] = useState<string | null>(null);
  const genres = useMemo(() => genresOf(tracks), [tracks]);
  const shown = useMemo(
    () => (genre ? tracks.filter((track) => track.genreTags.includes(genre)) : tracks),
    [genre, tracks],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  if (tracks.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="backing-tracks" className="flex flex-col gap-4 pt-8">
      <h2 id="backing-tracks" className="akinti-page type-caption-strong flex items-center gap-2 text-ink-muted">
        <MusicNotes className="size-4 text-sand" aria-hidden="true" weight="fill" />
        {t("title")}
      </h2>

      {genres.length > 1 ? (
        <div
          role="group"
          aria-label={t("filterByGenre")}
          className="akinti-page flex gap-2 overflow-x-auto pb-1"
        >
          <Chip selected={genre === null} onClick={() => setGenre(null)}>
            {t("all")}
          </Chip>
          {genres.map((tag) => (
            <Chip key={tag} selected={genre === tag} onClick={() => setGenre(tag)}>
              {tag}
            </Chip>
          ))}
        </div>
      ) : null}

      <HorizontalScroller scrollRef={scrollRef}>
        <div ref={scrollRef} className="akinti-page flex flex-col lg:flex-row lg:gap-4 lg:overflow-x-auto lg:pb-1">
          {shown.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              className="lg:w-[340px] lg:shrink-0 lg:rounded-card lg:border lg:border-hairline lg:bg-elevation-2 lg:p-4 lg:border-b-0"
            />
          ))}
        </div>
      </HorizontalScroller>
    </section>
  );
}

function TrackRow({ track, className }: { track: BackingTrackCard; className?: string }) {
  const t = useTranslations("BackingTracksLane");
  const store = usePlaybackStore();
  const playbackId = `track:${track.id}`;
  const playback = useWavePlayback(playbackId, track.durationSeconds ?? 0);
  const audio = useSignedAudio(track.audioAssetId);

  const duration = playback.duration || track.durationSeconds || 0;
  const ratio = duration > 0 ? playback.currentTime / duration : 0;
  const failed = playback.status === "error" || audio.error !== null;

  const start = (fromRatio?: number) => {
    void audio.resolve().then((url) => {
      if (!url) return;
      store.play(playbackId, url, {
        title: track.title,
        creatorUsername: track.artistCredit,
        duration: track.durationSeconds,
        peaks: track.peaks,
      });
      if (fromRatio !== undefined) {
        store.seekToRatio(fromRatio);
      }
    });
  };

  const toggle = () => {
    if (playback.isPlaying) {
      store.pause();
      return;
    }
    if (playback.isActive && audio.url) {
      store.resume();
      return;
    }
    start();
  };

  const meta = [
    track.bpm ? `${track.bpm} bpm` : null,
    track.musicalKey,
    duration > 0 ? formatDuration(duration) : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className={cn("akinti-rail border-b border-hairline py-4 last:border-b-0", className)}>
      <div className="flex justify-start">
        <IconButton
          label={
            failed
              ? t("retry", { title: track.title })
              : playback.isPlaying
                ? t("pause", { title: track.title })
                : t("play", { title: track.title })
          }
          icon={
            failed ? (
              <RotateCcw className="size-5" />
            ) : playback.isBusy ? (
              <Spinner size="sm" label={null} />
            ) : playback.isPlaying ? (
              <Pause className="size-5" weight="fill" />
            ) : (
              <Play className="size-5 translate-x-px" weight="fill" />
            )
          }
          variant="secondary"
          shape="round"
          size="md"
          onClick={toggle}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        {/* Stacked under `sm`, one row from there up. Side by side, the
            metadata is `shrink-0` and the title takes the whole loss: at 390px
            minus the play key and the gutters the title had ~120px, so
            "Monkeys Spinning Monkeys" rendered as "Monkeys ..." and
            "Sneaky Snitch" as "Sneaky S...". The title is what someone scans
            for, so on a phone it gets the full width and wraps instead. */}
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <p className="type-subhead text-ink sm:truncate">{track.title}</p>
          <span className="type-mono-sm text-ink-subtle sm:shrink-0">
            {meta.join(" \u00b7 ")}
          </span>
        </div>

        <Waveform
          peaks={playback.peaks ?? track.peaks}
          progress={ratio}
          loaded={playback.buffered}
          duration={duration}
          height={28}
          label={t("seekWithin", { title: track.title })}
          disabled={failed}
          onSeek={(next) => {
            if (playback.isActive && audio.url) {
              store.seekToRatio(next);
              return;
            }
            start(next);
          }}
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="type-caption text-ink-subtle">
            {track.sourceUrl ? (
              <a
                href={track.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-ink-muted underline decoration-hairline-strong underline-offset-[3px] hover:decoration-ink"
              >
                {track.artistCredit}
              </a>
            ) : (
              track.artistCredit
            )}
          </p>
          <Link
            href={`${routes.create()}?track=${encodeURIComponent(track.id)}`}
            className="type-caption text-ink underline decoration-hairline-strong underline-offset-[3px] hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
          >
            {t("singOverThis")}
          </Link>
        </div>

        {audio.error ? (
          <p role="alert" className="type-caption text-signal-deep">
            {audio.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
