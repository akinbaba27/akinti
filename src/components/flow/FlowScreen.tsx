"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { loadMoreFlow, sendFlowEvent } from "@/app/(app)/flow/actions";
import { echoWave, saveWave, unechoWave, unsaveWave } from "@/app/(app)/w/[id]/interactions";
import { genreHueForTag } from "@/components/feed";
import { Avatar, useToast } from "@/components/ui";
import { routes } from "@/config/routes";
import { usePlaybackSelector, usePlaybackStore, useWaveControls, useWavePlayback } from "@/lib/audio";
import { emitAnalyticsEvent } from "@/lib/metrics";
import { formatDuration, useIsDesktopViewport } from "@/lib/ui";

import { FlowActionBar } from "./FlowActionBar";
import { FlowCommentsPreview } from "./FlowCommentsPreview";
import { FlowDuetCallout } from "./FlowDuetCallout";
import { FlowEmptyState } from "./FlowEmptyState";
import { FlowTrace } from "./FlowTrace";
import { FlowTransport } from "./FlowTransport";
import { FlowUpNextList } from "./FlowUpNextList";
import { FlowWaveView } from "./FlowWaveView";
import { flowTraceHue, type FlowWave } from "./types";

const ShareSheet = dynamic(() => import("@/components/share").then((mod) => mod.ShareSheet));
const FlowCommentSheet = dynamic(() => import("./FlowCommentSheet").then((mod) => mod.FlowCommentSheet));

export interface FlowScreenProps {
  initialItems: readonly FlowWave[];
  initialCursor: string | null;
  initialError?: string | null;
}

/** One nav per physical gesture — the smallest distance/delta that counts as a deliberate swipe. */
const SWIPE_THRESHOLD_PX = 56;
const MOVE_THRESHOLD_PX = 10;
const WHEEL_THRESHOLD = 32;
const WHEEL_LOCKOUT_MS = 450;
const LONG_PRESS_MS = 550;
const DOUBLE_TAP_MS = 320;
/** Keep signed URLs warm for the current Wave plus this many ahead (`docs/FLOW.md` "Prefetch signed URLs ... for the next 2"). */
const PREFETCH_AHEAD = 2;
/** Fetch another page once this few unseen Waves remain. */
const LOAD_MORE_MARGIN = PREFETCH_AHEAD + 1;

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('button, a, [role="slider"], input, textarea, [data-flow-trace]') !== null
  );
}

/**
 * Flow (`docs/FLOW.md`): the full-screen continuous listening feed.
 *
 * Owns the one active Wave's transport (via `useWaveControls`/
 * `useWavePlayback` on the single global playback store), every gesture
 * (swipe by touch/wheel, tap, double tap, long press, keyboard), prefetching
 * signed URLs for the next two Waves, and firing `record_flow_event`
 * impressions/completes/skips/replays. `FlowWaveView` only renders the
 * current ±1 items it is handed — this component decides which those are.
 */
export function FlowScreen({ initialItems, initialCursor, initialError = null }: FlowScreenProps) {
  const router = useRouter();
  const { toast } = useToast();
  const store = usePlaybackStore();
  const tTerms = useTranslations("Terms");
  const tFlow = useTranslations("Flow");
  const tFlowWaveView = useTranslations("FlowWaveView");
  const isDesktop = useIsDesktopViewport();

  const [items, setItems] = useState<FlowWave[]>(() => [...initialItems]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [index, setIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [loadError] = useState<string | null>(initialError);
  const [savedById, setSavedById] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialItems.map((wave) => [wave.id, wave.isSaved])),
  );

  /**
   * Echo state, mirroring `savedById` exactly (`docs/ECHOES.md`: echoing is
   * idempotent and reversible, like Save). Optimistic per Wave id, rolled
   * back if the Server Action rejects.
   */
  const [echoedById, setEchoedById] = useState<Record<string, boolean>>({});
  const [echoDeltaById, setEchoDeltaById] = useState<Record<string, number>>({});
  const [shareTarget, setShareTarget] = useState<FlowWave | null>(null);
  const [commentTarget, setCommentTarget] = useState<FlowWave | null>(null);

  // Session-seeded, stable for the life of this mount (`docs/FLOW.md`
  // "session-seeded mix ... never repeats within a session"). `useState`'s
  // lazy initializer is the one place an impure call like `Math.random` is
  // allowed to run exactly once, unlike a bare `useRef(Math.random())`.
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000));
  // Mirrors `items` for `goToIndex`/the `onEnded` handler below (review3
  // finding 20): both used to read the array via a `setItems` updater
  // purely to dodge a stale closure, but ran real side effects
  // (`sendFlowEvent`, `setIndex`) inside that updater — React may invoke a
  // state updater twice (Strict Mode does, in dev), which fired
  // `record_flow_event` twice per skip/complete and ran `setIndex` during
  // another component's update phase. Reading the latest array from a ref
  // instead means `sendFlowEvent`/`setIndex` run as plain calls, never
  // inside a updater function.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const loadingMoreRef = useRef(false);
  const urlCacheRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const wheelLockRef = useRef(0);
  const gestureRef = useRef<{
    downX: number;
    downY: number;
    moved: boolean;
    longPressFired: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const lastTapAtRef = useRef(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeWave = items[index] ?? null;
  const playback = useWavePlayback(activeWave?.id ?? "", activeWave?.duration ?? 0);
  // Read reactively (not `store.getState()`) so a mid-playback signed-URL
  // refresh (`playbackStore.ts`'s own staleness handling) is picked up
  // rather than leaving `controls` holding a stale `src` closure.
  const activeSrc = usePlaybackSelector((state) => (playback.isActive ? state.src : null));
  const controls = useWaveControls(
    activeWave?.id ?? "",
    activeSrc ?? "",
    activeWave
      ? {
          title: activeWave.title,
          creatorUsername: activeWave.creator.username,
          duration: activeWave.duration,
          peaks: activeWave.peaks,
          assetId: activeWave.audioAssetId,
        }
      : undefined,
  );

  const ensureSignedUrl = useCallback((assetId: string): Promise<string | null> => {
    const cache = urlCacheRef.current;
    const existing = cache.get(assetId);
    if (existing) return existing;
    const request = fetch(`/api/audio/${assetId}/url`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`signed url request failed (${response.status})`);
        const data = (await response.json()) as { url?: string };
        return data.url ?? null;
      })
      .catch(() => null);
    cache.set(assetId, request);
    return request;
  }, []);

  // Prefetch the current + next two Waves' signed URLs.
  useEffect(() => {
    for (let offset = 0; offset <= PREFETCH_AHEAD; offset += 1) {
      const wave = items[index + offset];
      if (wave) void ensureSignedUrl(wave.audioAssetId);
    }
  }, [items, index, ensureSignedUrl]);

  // Load another page once few unseen Waves remain.
  useEffect(() => {
    if (!cursor || loadingMoreRef.current) return;
    if (items.length - 1 - index > LOAD_MORE_MARGIN) return;
    loadingMoreRef.current = true;
    void loadMoreFlow(cursor, seed)
      .then((page) => {
        setItems((current) => [...current, ...page.items]);
        setCursor(page.nextCursor);
        setSavedById((current) => {
          const next = { ...current };
          for (const wave of page.items) next[wave.id] = wave.isSaved;
          return next;
        });
      })
      .catch(() => {
        // Quiet: the reader simply runs out of new Waves a little early.
      })
      .finally(() => {
        loadingMoreRef.current = false;
      });
  }, [cursor, items.length, index, seed]);

  // Fire-and-forget impression the moment a Wave becomes active.
  const activeWaveId = activeWave?.id;
  useEffect(() => {
    if (!activeWaveId) return;
    void sendFlowEvent(activeWaveId, "impression");
  }, [activeWaveId]);

  // Auto-play the newly active Wave once the session has started (the very
  // first play is started directly by handleToggle, on the user's gesture).
  useEffect(() => {
    if (!hasStarted || !activeWave) return;
    let cancelled = false;
    void ensureSignedUrl(activeWave.audioAssetId).then((url) => {
      if (cancelled || !url) return;
      store.play(activeWave.id, url, {
        title: activeWave.title,
        creatorUsername: activeWave.creator.username,
        duration: activeWave.duration,
        peaks: activeWave.peaks,
        assetId: activeWave.audioAssetId,
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the Wave identity should restart playback, not every metric change
  }, [activeWave?.id, hasStarted]);

  // Auto-advance on end (linear, no bounce).
  useEffect(() => {
    return store.onEnded((event) => {
      const currentItems = itemsRef.current;
      const currentIndex = currentItems.findIndex((wave) => wave.id === event.waveId);
      if (currentIndex === -1) return;
      void sendFlowEvent(event.waveId, "complete");
      setIndex((current) => {
        const next = currentIndex + 1;
        return next < currentItems.length ? next : current;
      });
    });
  }, [store]);

  const goToIndex = useCallback(
    (nextIndex: number) => {
      const currentItems = itemsRef.current;
      if (nextIndex < 0 || nextIndex >= currentItems.length) return;
      const current = currentItems[index];
      if (current && playback.isActive && playback.status !== "ended") {
        void sendFlowEvent(current.id, "skip", Math.round(playback.currentTime * 1000));
      }
      setIndex(nextIndex);
    },
    [index, playback.currentTime, playback.isActive, playback.status],
  );

  const goNext = useCallback(() => goToIndex(index + 1), [goToIndex, index]);
  const goPrev = useCallback(() => goToIndex(index - 1), [goToIndex, index]);

  const handleToggle = useCallback(() => {
    if (!activeWave) return;
    if (!hasStarted) {
      setHasStarted(true);
      void ensureSignedUrl(activeWave.audioAssetId).then((url) => {
        if (!url) {
          toast({ title: tFlow("audioLoadError"), tone: "error" });
          return;
        }
        store.play(activeWave.id, url, {
          title: activeWave.title,
          creatorUsername: activeWave.creator.username,
          duration: activeWave.duration,
          peaks: activeWave.peaks,
          assetId: activeWave.audioAssetId,
        });
      });
      return;
    }
    controls.toggle();
  }, [activeWave, hasStarted, ensureSignedUrl, store, tFlow, toast, controls]);

  const handleReplay = useCallback(() => {
    if (!activeWave || !hasStarted) return;
    store.seek(0);
    controls.play();
    void sendFlowEvent(activeWave.id, "replay", 0);
  }, [activeWave, hasStarted, store, controls]);

  const handleSave = useCallback(() => {
    if (!activeWave) return;
    const willSave = !(savedById[activeWave.id] ?? activeWave.isSaved);
    setSavedById((current) => ({ ...current, [activeWave.id]: willSave }));
    const action = willSave ? saveWave(activeWave.id) : unsaveWave(activeWave.id);
    void action.then((result) => {
      if (!result.ok) {
        setSavedById((current) => ({ ...current, [activeWave.id]: !willSave }));
        toast({ title: result.error ?? tFlow("saveError"), tone: "error" });
        return;
      }
      emitAnalyticsEvent({
        name: willSave ? "wave_saved" : "wave_unsaved",
        waveId: activeWave.id,
        sessionId: "n/a",
        at: Date.now(),
      });
    });
  }, [activeWave, savedById, tFlow, toast]);

  const handleEcho = useCallback(() => {
    if (!activeWave) return;
    const willEcho = !(echoedById[activeWave.id] ?? activeWave.isEchoed);
    setEchoedById((current) => ({ ...current, [activeWave.id]: willEcho }));
    setEchoDeltaById((current) => ({
      ...current,
      [activeWave.id]: (current[activeWave.id] ?? 0) + (willEcho ? 1 : -1),
    }));
    const action = willEcho ? echoWave(activeWave.id) : unechoWave(activeWave.id);
    void action.then((result) => {
      if (result.ok) return;
      setEchoedById((current) => ({ ...current, [activeWave.id]: !willEcho }));
      setEchoDeltaById((current) => ({
        ...current,
        [activeWave.id]: (current[activeWave.id] ?? 0) + (willEcho ? -1 : 1),
      }));
      toast({ title: result.error ?? tFlow("echoError"), tone: "error" });
    });
  }, [activeWave, echoedById, tFlow, toast]);

  const handleDuet = useCallback(() => {
    if (!activeWave || !activeWave.canRequestDuet) return;
    router.push(routes.waveDuet(activeWave.id));
  }, [activeWave, router]);

  const handleScrub = useCallback(
    (ratio: number) => {
      if (!activeWave || !hasStarted) return;
      controls.seekToRatio(ratio);
    },
    [activeWave, hasStarted, controls],
  );

  const runLongPress = useCallback(() => {
    handleSave();
  }, [handleSave]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isInteractiveTarget(event.target)) return;
      const timer = setTimeout(() => {
        const gesture = gestureRef.current;
        if (gesture && !gesture.moved) {
          gesture.longPressFired = true;
          runLongPress();
        }
      }, LONG_PRESS_MS);
      gestureRef.current = { downX: event.clientX, downY: event.clientY, moved: false, longPressFired: false, timer };
    },
    [runLongPress],
  );

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const dx = Math.abs(event.clientX - gesture.downX);
    const dy = Math.abs(event.clientY - gesture.downY);
    if (!gesture.moved && Math.max(dx, dy) > MOVE_THRESHOLD_PX) {
      gesture.moved = true;
      if (gesture.timer) {
        clearTimeout(gesture.timer);
        gesture.timer = null;
      }
    }
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture) return;
      if (gesture.timer) clearTimeout(gesture.timer);
      if (gesture.longPressFired) return;
      if (isInteractiveTarget(event.target)) return;

      const dy = event.clientY - gesture.downY;
      const dx = event.clientX - gesture.downX;

      if (gesture.moved) {
        if (Math.abs(dy) >= SWIPE_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx)) {
          if (dy < 0) goNext();
          else goPrev();
        }
        return;
      }

      const now = Date.now();
      if (now - lastTapAtRef.current < DOUBLE_TAP_MS) {
        lastTapAtRef.current = 0;
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
        handleReplay();
        return;
      }
      lastTapAtRef.current = now;
      singleTapTimerRef.current = setTimeout(() => {
        handleToggle();
      }, DOUBLE_TAP_MS);
    },
    [goNext, goPrev, handleReplay, handleToggle],
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (Math.abs(event.deltaY) < WHEEL_THRESHOLD) return;
      const now = Date.now();
      if (now - wheelLockRef.current < WHEEL_LOCKOUT_MS) return;
      wheelLockRef.current = now;
      if (event.deltaY > 0) goNext();
      else goPrev();
    },
    [goNext, goPrev],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        goNext();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        goPrev();
      } else if (event.key === " ") {
        event.preventDefault();
        handleToggle();
      }
    },
    [goNext, goPrev, handleToggle],
  );

  const windowed = useMemo(() => {
    const list: { wave: FlowWave; position: -1 | 0 | 1 }[] = [];
    const prev = items[index - 1];
    const current = items[index];
    const next = items[index + 1];
    if (prev) list.push({ wave: prev, position: -1 });
    if (current) list.push({ wave: current, position: 0 });
    if (next) list.push({ wave: next, position: 1 });
    return list;
  }, [items, index]);

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    };
  }, []);

  if (!activeWave) {
    return <FlowEmptyState error={loadError} onRetry={() => router.refresh()} />;
  }

  const sheets = (
    <>
      {shareTarget ? (
        <ShareSheet open onClose={() => setShareTarget(null)} wave={{ id: shareTarget.id, title: shareTarget.title }} />
      ) : null}

      {commentTarget ? (
        <FlowCommentSheet
          open
          onClose={() => setCommentTarget(null)}
          waveId={commentTarget.id}
          waveCreatorId={commentTarget.creatorId}
          commentCount={commentTarget.metrics.comments}
        />
      ) : null}
    </>
  );

  if (isDesktop) {
    const activeName = activeWave.creator.displayName ?? activeWave.creator.username;
    const hue = flowTraceHue(activeWave, genreHueForTag);
    const modeLabel =
      activeWave.creationType === "duet" ? tTerms("duet") : (activeWave.genre ?? tTerms(activeWave.creationType));
    const progress = playback.duration > 0 ? Math.min(1, playback.currentTime / playback.duration) : 0;
    const upNext = items.slice(index + 1, index + 4);
    const activeSaved = savedById[activeWave.id] ?? activeWave.isSaved;

    return (
      <>
        {/* `AppShell` now renders the real sidebar/top bar/now-playing bar
            for `/flow` at >= 1024px (fixed after this pass flagged the
            unconditional mobile takeover to the shell owner) — this only
            needs to be the page's own content, exactly like Explore or the
            Wave page, not a second header. The right rail is built here
            rather than through `AppShell`'s `aside` slot: that slot is a
            prop on a component instantiated above every page in
            `(app)/layout.tsx`, which a Server Component page has no way to
            reach — the same reason no other screen in the product uses it
            today either. */}
        <div
          className="flex flex-col gap-10 py-2 outline-none lg:flex-row lg:items-start"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          <div className="flex min-h-[60vh] min-w-0 flex-1 flex-col justify-center gap-8 lg:max-w-[720px]">
            <div className="flex flex-col gap-3">
              <Link
                href={routes.profile(activeWave.creator.username)}
                className="flex items-center gap-2.5 self-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
              >
                <Avatar name={activeName} src={activeWave.creator.avatarUrl} size="md" />
                <span className="flex flex-col">
                  <span className="type-subhead text-ink">{activeName}</span>
                  <span className="type-caption text-ink-subtle">@{activeWave.creator.username}</span>
                </span>
              </Link>

              <h1 className="type-desktop-title pt-1 text-ink">{activeWave.title}</h1>
              <p className="type-caption flex items-center gap-2 text-ink-subtle">
                <span>{modeLabel}</span>
                <span aria-hidden="true">·</span>
                <span className="type-mono-sm">{formatDuration(activeWave.duration ?? 0)}</span>
                {activeWave.isInvitation ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{tFlowWaveView("singOverThis")}</span>
                  </>
                ) : null}
              </p>
            </div>

            <FlowTrace
              peaks={activeWave.peaks}
              progress={progress}
              loaded={playback.buffered}
              state={playback.isPlaying ? "playing" : "unplayed"}
              hue={hue}
              height={220}
              onScrub={handleScrub}
            />

            <div className="flex items-center justify-center">
              <FlowTransport
                isPlaying={playback.isPlaying}
                hasStarted={hasStarted}
                currentTime={playback.currentTime}
                duration={playback.duration || activeWave.duration || 0}
                onToggle={handleToggle}
                upNextPeaks={null}
              />
            </div>

            <FlowActionBar
              isSaved={activeSaved}
              saveCount={activeWave.metrics.saves}
              isEchoed={echoedById[activeWave.id] ?? activeWave.isEchoed}
              echoCount={Math.max(0, activeWave.echoCount + (echoDeltaById[activeWave.id] ?? 0))}
              commentCount={activeWave.metrics.comments}
              shareCount={activeWave.metrics.shares}
              duetCount={activeWave.metrics.duets}
              canRequestDuet={activeWave.canRequestDuet}
              openForDuet={activeWave.canRequestDuet}
              onReplay={handleReplay}
              onEcho={handleEcho}
              onSave={handleSave}
              onComment={() => setCommentTarget(activeWave)}
              onShare={() => setShareTarget(activeWave)}
              onDuet={handleDuet}
            />
          </div>

          <aside className="hidden w-right-rail shrink-0 flex-col gap-8 lg:flex">
            <FlowUpNextList items={upNext} onSelect={(waveId) => goToIndex(items.findIndex((wave) => wave.id === waveId))} />
            <div className="h-px bg-hairline" aria-hidden="true" />
            <FlowDuetCallout wave={activeWave} onRequestDuet={handleDuet} />
            <div className="h-px bg-hairline" aria-hidden="true" />
            <FlowCommentsPreview
              waveId={activeWave.id}
              commentCount={activeWave.metrics.comments}
              onOpenAll={() => setCommentTarget(activeWave)}
            />
          </aside>
        </div>

        {sheets}
      </>
    );
  }

  return (
    <div
      // `AppShell` (`src/components/layout/AppShell.tsx`) renders no chrome
      // at all on `/flow`, so this only ever needs to fill the viewport it
      // is already alone in — no `fixed`/`z-40` overlay required.
      className="h-dvh w-full touch-none overflow-hidden bg-paper outline-none"
      tabIndex={0}
      role="region"
      aria-roledescription="carousel"
      aria-label={tTerms("flow")}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="transition-transform duration-150 ease-linear"
        // `dvh`, not `%`: a percentage `translateY` resolves against the
        // element's OWN height (here, the stacked track's — up to 3x a
        // single screen), not one section's height, so `-100%` overshot by
        // up to 3x instead of moving exactly one screen.
        style={{
          transform: `translateY(-${windowed.findIndex((entry) => entry.position === 0) * 100}dvh)`,
        }}
      >
        {windowed.map(({ wave, position }) => (
          <div
            key={wave.id}
            className="h-dvh w-full"
            data-flow-active={position === 0}
            aria-hidden={position !== 0}
            // axe `aria-hidden-focus` (QA `full2` defect #4): `FlowWaveView`
            // renders a full interactive control set even for the
            // virtualized +/-1 neighbours, so `aria-hidden` alone still left
            // them tab-reachable. `inert` removes the whole subtree from the
            // tab order and hit-testing, not just from the accessibility
            // tree.
            inert={position !== 0}
          >
            <FlowWaveView
              wave={{
                ...wave,
                isSaved: savedById[wave.id] ?? wave.isSaved,
                isEchoed: echoedById[wave.id] ?? wave.isEchoed,
                echoCount: Math.max(0, wave.echoCount + (echoDeltaById[wave.id] ?? 0)),
              }}
              isActive={position === 0}
              hasStarted={hasStarted}
              isPlaying={playback.isPlaying}
              currentTime={playback.currentTime}
              duration={playback.duration || wave.duration || 0}
              loaded={playback.buffered}
              upNextPeaks={position === 0 ? (items[index + 1]?.peaks ?? null) : null}
              onToggle={handleToggle}
              onScrub={handleScrub}
              onReplay={handleReplay}
              onEcho={handleEcho}
              onSave={handleSave}
              onComment={() => setCommentTarget(wave)}
              onShare={() => setShareTarget(wave)}
              onDuet={handleDuet}
            />
          </div>
        ))}
      </div>

      {sheets}
    </div>
  );
}
