"use client";

/**
 * Data-fetching wrapper around the presentation-only `WaveCard` (spec §33,
 * §12, §14). `WaveCard`/`WavePlayer` are never modified — this container
 * resolves a short-lived signed playback URL lazily, on first play rather
 * than on mount, via `GET /api/audio/[assetId]/url`, then feeds it straight
 * to the global playback store. It also wires the four social actions (spec
 * §14, §15): Comment, Save, Share and Request a Duet.
 *
 * How the playback interception works without touching `WavePlayer`: while
 * no URL has been resolved yet, this component listens for clicks in the
 * CAPTURE phase (fires before `WavePlayer`'s own `onClick`, since capture
 * always runs outer-to-inner). If the click landed on the transport button —
 * matched by its accessible name, which `WavePlayer` always sets to "Play …"
 * / "Pause …" / "Retry playback" — the click is stopped before `WavePlayer`
 * ever sees it (so the store never gets asked to play an empty `src`), the
 * signed URL is fetched, and playback is started directly through the store
 * once it resolves. Any other click (profile link, Comment/Save/Share, the
 * waveform seek bar) passes through untouched; seeking an inactive Wave is
 * already a no-op in `useWaveControls`.
 *
 * The Request-a-Duet tooltip is wired the same DOM-query way, for the same
 * reason: `WaveCard`'s duet button (`TERMS.requestDuet`) already supports
 * `disabled` via `wave.canRequestDuet`, but exposes no prop for *why* it's
 * disabled, and `WaveCard.tsx` is owned by the Waves stage, not this one — so
 * rather than fork the presentational component, the reason is attached as a
 * native `title` attribute on the existing button after render, matched by
 * its accessible name exactly like the transport-button interception above.
 */

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";

import { echoWave, saveWave, unechoWave, unsaveWave } from "@/app/(app)/w/[id]/interactions";
import { usePlaybackStore } from "@/lib/audio";
import { echoReducer, saveReducer } from "@/lib/interactions";
import { emitAnalyticsEvent, usePlayTracker } from "@/lib/metrics";
import { routes } from "@/config/routes";
import { useActionToast } from "@/components/ui";

import { WaveCard, type WaveCardProps, type WaveCardWave } from "./WaveCard";

/**
 * Code-split, matching `FlowScreen.tsx`'s own `ShareSheet` import (fixQA2
 * item 4, TBT): every `WaveCardContainer` — every Wave row on Explore, a
 * profile's tabs, a hashtag page, a track's page — used to statically pull
 * in the whole Share Sheet, including its conversation picker and messaging
 * actions, whether or not that Wave's Share was ever opened. Deferred to
 * its own chunk, fetched only on first tap.
 */
const ShareSheet = dynamic(() => import("@/components/share").then((mod) => mod.ShareSheet));

export type WaveCardContainerWave = Omit<WaveCardWave, "audioUrl"> & {
  /** `audio_assets.id` — resolved to a signed URL lazily on first play. */
  readonly audioAssetId: string;
};

export interface WaveCardContainerProps extends Omit<WaveCardProps, "wave"> {
  wave: WaveCardContainerWave;
  /** The viewer has no recorded listen for this Wave (§4.1). */
  unheard?: boolean;
}

export function WaveCardContainer({
  wave,
  unheard = false,
  onComment,
  onEcho,
  onSave,
  onShare,
  onRequestDuet,
  ...rest
}: WaveCardContainerProps) {
  const t = useTranslations("WaveCardContainer");
  const tTerms = useTranslations("Terms");
  const tWavePlayer = useTranslations("WavePlayer");
  const store = usePlaybackStore();
  const router = useRouter();
  // `useActionToast`'s own `toast` escape hatch (`./useActionToast.ts`'s
  // doc comment: "the rare call site that needs a custom action button" —
  // here it's a custom *message*, since Save must keep the server's
  // specific error text rather than the shared generic one) rather than
  // `notify()` directly.
  const { toast } = useActionToast();
  usePlayTracker();

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fetchingRef = useRef<Promise<string | null> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Matches `WavePlayer`'s translated accessible name for the transport
  // button exactly — built from the same translated words `WavePlayer`
  // renders, not a hardcoded English regex (see `WaveDetail.tsx`'s
  // `transportLabelRe` for the same pattern).
  const transportLabelRe = useMemo(() => {
    const words = [tTerms("playAction"), tTerms("pauseAction"), tWavePlayer("retryPlayback")].map(
      (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    return new RegExp(`^(${words.join("|")})\\b`);
  }, [tTerms, tWavePlayer]);

  const [saveState, dispatchSave] = useReducer(saveReducer, {
    isSaved: wave.isSaved ?? false,
    saveCount: wave.metrics.saves,
    status: "idle" as const,
  });
  const [echoState, dispatchEcho] = useReducer(echoReducer, {
    isEchoed: wave.isEchoed ?? false,
    echoCount: wave.echoCount ?? 0,
    status: "idle" as const,
  });
  const [shareOpen, setShareOpen] = useState(false);
  // Set once, on first Share tap, and never back to `false` — `ShareSheet`
  // itself only mounts once this is true (fixQA2 item 4, TBT), so its code
  // (conversation picker, messaging actions) is never fetched or parsed for
  // a Wave nobody ever tries to share.
  const [hasOpenedShare, setHasOpenedShare] = useState(false);

  const canRequestDuet = wave.canRequestDuet ?? true;

  // Attach a title/tooltip to the (already-disabled) Request-a-Duet button
  // without editing WaveCard.tsx — see the file-level doc comment.
  useEffect(() => {
    const button = Array.from(
      cardRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((el) => el.textContent?.trim().startsWith(tTerms("requestDuet")));
    if (!button) return;
    if (canRequestDuet) {
      button.removeAttribute("title");
    } else {
      button.title = t("duetDisabledTitle");
    }
  }, [canRequestDuet, t, tTerms]);

  const ensureAudioUrl = useCallback((): Promise<string | null> => {
    if (audioUrl) {
      return Promise.resolve(audioUrl);
    }
    if (fetchingRef.current) {
      return fetchingRef.current;
    }

    const request = fetch(`/api/audio/${wave.audioAssetId}/url`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`playback url request failed (${response.status})`);
        }
        const data = (await response.json()) as { url?: string };
        if (!data.url) {
          throw new Error("playback url response missing url");
        }
        setLoadError(null);
        setAudioUrl(data.url);
        return data.url;
      })
      .catch(() => {
        setLoadError(t("audioLoadError"));
        return null;
      })
      .finally(() => {
        fetchingRef.current = null;
      });

    fetchingRef.current = request;
    return request;
  }, [audioUrl, t, wave.audioAssetId]);

  const handleClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (audioUrl) {
        // Already resolved: let WaveCard/WavePlayer handle the click normally.
        return;
      }
      const target = event.target as HTMLElement;
      // Not `button[aria-label]`: `WavePlayer`'s transport button is an
      // `IconButton` (`src/components/ui/IconButton.tsx`), which names
      // itself with a visually-hidden text span, never a literal
      // `aria-label` attribute — that selector never matched a real button,
      // so this interception never fired for an actual click and playback
      // silently never started anywhere `WaveCardContainer` is used
      // (Explore, Home feed, search, profiles, ...). Match by `textContent`
      // instead, the same way the Request-a-Duet tooltip effect below
      // already does; the `TRANSPORT_LABEL_RE` check below is what excludes
      // every other button on the card (Comment/Save/Share/Request a Duet
      // all have unrelated text), so widening the element selector to any
      // `button` is still safe.
      const control = target.closest("button");
      const label = control?.textContent?.trim() ?? "";
      if (!transportLabelRe.test(label)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void ensureAudioUrl().then((url) => {
        if (!url) return;
        store.play(wave.id, url, {
          title: wave.title,
          creatorUsername: wave.creator.username,
          duration: wave.duration,
        });
      });
    },
    [audioUrl, ensureAudioUrl, store, transportLabelRe, wave.id, wave.title, wave.creator.username, wave.duration],
  );

  /** Comment opens the comments Sheet on cards that render one; the default here navigates to the Wave's comments section (spec §14 — either is acceptable). */
  const handleComment = useCallback(
    (waveId: string) => {
      onComment?.(waveId);
      router.push(routes.waveComments(waveId));
    },
    [onComment, router],
  );

  /** Save/Unsave with optimistic UI and rollback on failure (spec §14). */
  const handleSave = useCallback(
    (waveId: string) => {
      // Blocks a double-submit while the previous toggle's request is
      // still in flight (DESIGN_V3_DESKTOP.md "Feedback": "disable
      // double-submit") — `saveReducer`'s own `status` already tracks
      // this, this just reads it before acting.
      if (saveState.status === "pending") return;
      onSave?.(waveId);
      const willSave = !saveState.isSaved;
      dispatchSave({ type: "toggle" });

      const action = willSave ? saveWave(waveId) : unsaveWave(waveId);
      void action.then((result) => {
        if (!result.ok) {
          dispatchSave({ type: "rollback" });
          toast({ title: result.error ?? t("saveUpdateError"), tone: "error" });
          return;
        }
        dispatchSave({ type: "confirm" });
        emitAnalyticsEvent({
          name: willSave ? "wave_saved" : "wave_unsaved",
          waveId,
          sessionId: "n/a",
          at: Date.now(),
        });
      });
    },
    [onSave, saveState.isSaved, saveState.status, t, toast],
  );

  /** Echo/Un-echo with optimistic UI and rollback on failure — mirrors `handleSave` exactly (Wave E, `docs/ECHOES.md`). */
  const handleEcho = useCallback(
    (waveId: string) => {
      if (echoState.status === "pending") return;
      onEcho?.(waveId);
      const willEcho = !echoState.isEchoed;
      dispatchEcho({ type: "toggle" });

      const action = willEcho ? echoWave(waveId) : unechoWave(waveId);
      void action.then((result) => {
        if (!result.ok) {
          dispatchEcho({ type: "rollback" });
          toast({ title: result.error ?? t("echoUpdateError"), tone: "error" });
          return;
        }
        dispatchEcho({ type: "confirm" });
      });
    },
    [onEcho, echoState.isEchoed, echoState.status, t, toast],
  );

  const handleShare = useCallback(
    (waveId: string) => {
      onShare?.(waveId);
      setHasOpenedShare(true);
      setShareOpen(true);
    },
    [onShare],
  );

  const handleRequestDuet = useCallback(
    (waveId: string) => {
      onRequestDuet?.(waveId);
      if (!canRequestDuet) return;
      router.push(routes.waveDuet(waveId));
    },
    [onRequestDuet, canRequestDuet, router],
  );

  return (
    <div ref={cardRef} onClickCapture={handleClickCapture}>
      <WaveCard
        wave={{
          ...wave,
          audioUrl: audioUrl ?? "",
          isSaved: saveState.isSaved,
          isEchoed: echoState.isEchoed,
          echoCount: echoState.echoCount,
          unheard,
          metrics: { ...wave.metrics, saves: saveState.saveCount },
        }}
        onComment={handleComment}
        onEcho={handleEcho}
        onSave={handleSave}
        onShare={handleShare}
        onRequestDuet={handleRequestDuet}
        {...rest}
      />
      {loadError ? (
        <p role="alert" className="akinti-page type-caption pb-3 text-signal-deep">
          {loadError}
        </p>
      ) : null}

      {hasOpenedShare ? (
        <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} wave={{ id: wave.id, title: wave.title }} />
      ) : null}
    </div>
  );
}
