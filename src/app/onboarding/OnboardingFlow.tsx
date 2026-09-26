"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Waveform } from "@/components/audio";
import { useSignedAudio } from "@/components/feed";
import { Button, IconButton, Input, Spinner } from "@/components/ui";
import { Play } from "@/components/ui/icons";
import { routes } from "@/config/routes";
import { useCurrentUser } from "@/lib/auth";
import { usePlaybackStore, useWavePlayback } from "@/lib/audio";
import { cn, timeAgo } from "@/lib/ui";

import { checkUsernameAvailable, completeOnboarding } from "./actions";

/** What `/onboarding` needs of the sample Wave for step one — a subset of
 * `WaveCardContainerWave` (`@/components/wave`), resolved server-side. */
export interface HearItWave {
  id: string;
  title: string;
  audioAssetId: string;
  peaks: readonly number[];
  duration?: number;
  creator: { username: string; displayName?: string };
  createdAt: string | number | Date;
}

export interface OnboardingFlowProps {
  initialUsername: string;
  initialDisplayName: string | null;
  hearItWave: HearItWave | null;
  /** Where to land once onboarding finishes — usually the route that redirected here. */
  next?: string;
  /**
   * The host this deployment is actually served from, resolved server-side and
   * passed in so the handle preview is a URL that resolves. It used to read a
   * hardcoded `akinti.app`, a domain the project does not own
   * (`docs/HANDOVER.md` §(i) lists it as neither bought nor connected), so the
   * screen where someone claims their handle promised them a dead address.
   */
  profileHost: string;
}

const STEP_COUNT = 3;

/**
 * The 3-segment progress waterline (SCREENS.md §1): the same drawing
 * grammar as the audio trace — a row of small bars — standing in for a step
 * indicator instead of a row of dots (§12 forbids a numbered "01 / 02 / 03"
 * eyebrow, and dots would be the generic alternative).
 */
function OnboardingProgress({ step }: { step: number }) {
  const t = useTranslations("OnboardingFlow");
  const bars = [3, 6, 4, 8, 5, 4];
  return (
    <div role="img" aria-label={t("stepOf", { step: step + 1, total: STEP_COUNT })} className="flex items-end gap-1.5">
      {Array.from({ length: STEP_COUNT }, (_, index) => {
        const done = index <= step;
        return (
          <div key={index} className="flex items-end gap-[3px]">
            {bars.map((height, barIndex) => (
              <span
                key={barIndex}
                aria-hidden="true"
                className={cn("w-[3px] rounded-[1px]", done ? "bg-ink" : "bg-hairline-strong")}
                style={{ height: `${height}px` }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function OnboardingFlow({
  initialUsername,
  initialDisplayName,
  hearItWave,
  next,
  profileHost,
}: OnboardingFlowProps) {
  const [step, setStep] = useState(0);

  return (
    <div className="akinti-page flex min-h-dvh flex-col pt-[max(20px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between pb-2">
        <OnboardingProgress step={step} />
      </div>

      {step === 0 ? (
        <StepHearIt wave={hearItWave} onNext={() => setStep(1)} />
      ) : step === 1 ? (
        <StepSayIt onNext={() => setStep(2)} />
      ) : (
        <StepBeFound
          initialUsername={initialUsername}
          initialDisplayName={initialDisplayName}
          next={next}
          profileHost={profileHost}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Step one — "Hear it" (§1.1)                                          */
/* -------------------------------------------------------------------- */

function StepHearIt({ wave, onNext }: { wave: HearItWave | null; onNext: () => void }) {
  const t = useTranslations("OnboardingFlow");
  const store = usePlaybackStore();
  const playback = useWavePlayback(wave?.id ?? "onboarding-sample", wave?.duration ?? 0);
  const audio = useSignedAudio(wave?.audioAssetId ?? "");
  const [started, setStarted] = useState(false);

  const duration = playback.duration || wave?.duration || 0;
  const ratio = duration > 0 ? playback.currentTime / duration : 0;

  const play = () => {
    if (!wave) return;
    setStarted(true);
    void audio.resolve().then((url) => {
      if (!url) return;
      store.play(wave.id, url, {
        title: wave.title,
        creatorUsername: wave.creator.username,
        duration: wave.duration,
        peaks: wave.peaks,
      });
    });
  };

  const creatorName = wave?.creator.displayName ?? wave?.creator.username ?? null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center gap-8">
        <h1 className="type-display-xl max-w-[13ch] text-ink">
          {wave
            ? t.rich("someoneIsTalking", { br: () => <br /> })
            : t.rich("akintiJustStarted", { br: () => <br /> })}
        </h1>

        <div className="flex flex-col gap-3">
          <div className="relative -mx-5">
            {wave ? (
              <Waveform
                peaks={playback.peaks ?? wave.peaks}
                progress={ratio}
                loaded={playback.buffered}
                duration={duration}
                height={96}
                readOnly
                fullBleed
                label={t("playWave", { title: wave.title })}
                state={started ? undefined : "dormant"}
              />
            ) : (
              <Waveform peaks={[]} height={96} readOnly fullBleed label={t("noSampleAvailable")} />
            )}
            {!started ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <IconButton
                  label={wave ? t("tapToHearSomeone") : t("nothingToPlayYet")}
                  icon={
                    playback.isBusy ? <Spinner size="md" label={null} /> : <Play className="size-6" weight="fill" />
                  }
                  variant="primary"
                  shape="round"
                  size="lg"
                  disabled={!wave}
                  onClick={play}
                />
              </div>
            ) : null}
          </div>

          {wave && creatorName ? (
            <p className="type-body-sm text-ink-muted">
              {creatorName}
              <span aria-hidden="true"> · </span>
              {timeAgo(wave.createdAt)}
            </p>
          ) : !wave ? (
            <p className="type-body-sm text-ink-muted">{t("couldBeFirstVoice")}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 pt-6">
        <Button size="lg" fullWidth onClick={onNext}>
          {started || wave ? t("keepListening") : t("continueAction")}
        </Button>
        <button
          type="button"
          onClick={onNext}
          className="type-body-sm text-ink-muted underline decoration-hairline-strong decoration-1 underline-offset-[3px] hover:decoration-ink"
        >
          {t("illLookAround")}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Step two — "Say it" (§1.2)                                           */
/* -------------------------------------------------------------------- */

type MicState = "unrequested" | "granted" | "recording" | "denied";

/** Real, discarded trial recording — proves the mic path works in context
 * without keeping or uploading anything (SCREENS.md §1.2). */
const TRIAL_DURATION_MS = 3000;

function StepSayIt({ onNext }: { onNext: () => void }) {
  const t = useTranslations("OnboardingFlow");
  const [mic, setMic] = useState<MicState>("unrequested");
  const [tried, setTried] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const stopTrial = () => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setMic((current) => (current === "recording" ? "granted" : current));
    setTried(true);
  };

  const startTrial = async () => {
    if (mic === "denied") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMic("recording");
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      // Nothing is kept: the trial's only purpose is proving the capture
      // path works in context, so recorded chunks are never read.
      recorder.start();
      stopTimerRef.current = setTimeout(stopTrial, TRIAL_DURATION_MS);
    } catch {
      setMic("denied");
    }
  };

  const keyState = mic === "recording" ? "recording" : "idle";

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center gap-8">
        <h1 className="type-display-xl max-w-[13ch] text-ink">
          {t.rich("yourTurn", { br: () => <br /> })}
        </h1>

        <div className="flex flex-col items-start gap-4 py-4">
          <button
            type="button"
            aria-label={mic === "recording" ? t("recordingTrial") : t("holdToTryRecording")}
            aria-pressed={mic === "recording"}
            disabled={mic === "denied"}
            onPointerDown={() => void startTrial()}
            onPointerUp={stopTrial}
            onPointerLeave={() => {
              if (mic === "recording") stopTrial();
            }}
            className={cn(
              "akinti-press inline-flex size-24 shrink-0 items-center justify-center rounded-[var(--akinti-radius-key-96)]",
              "transition-colors duration-[--dur-micro] disabled:cursor-not-allowed disabled:opacity-55",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
              keyState === "recording" ? "bg-signal" : "bg-ink",
              mic === "granted" && "ring-1 ring-signal ring-offset-2 ring-offset-paper",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-5 rounded-full",
                keyState === "recording" ? "bg-ink" : "bg-signal",
              )}
            />
          </button>

          {mic === "denied" ? (
            <div className="flex flex-col items-start gap-2 text-left">
              <p className="type-body-sm max-w-[34ch] text-ink-muted">{t("micNeededDescription")}</p>
              <details className="type-caption text-ink-subtle">
                <summary className="cursor-pointer underline decoration-hairline-strong underline-offset-[3px]">
                  {t("howToAllowIt")}
                </summary>
                <p className="mt-1 max-w-[34ch]">{t("howToAllowItDescription")}</p>
              </details>
            </div>
          ) : (
            <p className="type-body-sm max-w-[30ch] text-left text-ink-muted">{t("holdToTryItDescription")}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 pt-6">
        <Button size="lg" fullWidth onClick={onNext}>
          {tried && mic !== "denied" ? t("soundedGoodContinue") : t("continueAction")}
        </Button>
        <button
          type="button"
          onClick={onNext}
          className="type-body-sm text-ink-muted underline decoration-hairline-strong decoration-1 underline-offset-[3px] hover:decoration-ink"
        >
          {t("setUpMicLater")}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Step three — "Be found" (§1.3)                                       */
/* -------------------------------------------------------------------- */

function StepBeFound({
  initialUsername,
  initialDisplayName,
  next,
  profileHost,
}: {
  initialUsername: string;
  initialDisplayName: string | null;
  next?: string;
  profileHost: string;
}) {
  const t = useTranslations("OnboardingFlow");
  const { refreshProfile } = useCurrentUser();
  const [username, setUsername] = useState(initialUsername);
  const [displayName, setDisplayName] = useState(initialDisplayName ?? "");
  const [checkedAvailable, setCheckedAvailable] = useState<boolean | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /**
   * Flow, not Home, when nothing sent the user here with a `next` of its own.
   * `docs/FLOW.md` makes Flow the post-login default ("Home keeps the
   * follow-only list as a tab or secondary route"), and both other post-auth
   * entry points already agree — `signIn` returns `routes.flow()` and
   * `src/lib/supabase/middleware.ts` redirects there. Onboarding was the one
   * that still landed on Home, which for a brand-new account is guaranteed to
   * be empty ("No one you follow has posted yet") — so the button that says
   * "Start listening" delivered the one screen with nothing to listen to.
   */
  const destination = useMemo(() => next ?? routes.flow(), [next]);

  // Below the minimum length, or unchanged from the account's current
  // handle, needs no round trip at all — `available` below resolves those
  // cases directly instead of waiting on this effect.
  const needsCheck = username.trim().length >= 3 && username !== initialUsername;


  useEffect(() => {
    if (!needsCheck) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void checkUsernameAvailable(username).then((result) => {
        if (!cancelled) setCheckedAvailable(result.available);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username, needsCheck]);

  const available = username === initialUsername ? true : needsCheck ? checkedAvailable : null;

  const finish = () => {
    setFormError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await completeOnboarding({
        username,
        displayName: displayName.trim().length > 0 ? displayName.trim() : null,
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setFormError(result.formError ?? null);
        return;
      }
      await refreshProfile();
      // A client-side `router.push` can land on `destination` still
      // rendered signed-out (the RSC fetch doesn't reliably carry the
      // just-set auth cookie), so a hard navigation guarantees Home renders
      // signed in for what is a one-time, end-of-flow transition.
      window.location.assign(destination);
    });
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center gap-6">
        <h1 className="type-display-xl text-ink">{t("pickAHandle")}</h1>

        <div className="flex flex-col gap-1.5">
          <Input
            id="onboarding-username"
            label={t("handle")}
            value={username}
            onChange={(event) => setUsername(event.target.value.toLowerCase())}
            leadingIcon={<span aria-hidden="true">@</span>}
            confirmed={available === true}
            error={fieldErrors.username ?? (available === false ? t("handleTaken") : undefined)}
            required
          />
          <p className="type-caption pl-1 text-ink-subtle">
            {profileHost}
            {routes.profile(username || t("handlePlaceholder"))}
          </p>
        </div>

        <Input
          id="onboarding-display-name"
          label={t("nameOptional")}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />

        {formError ? (
          <p role="alert" className="type-body-sm text-signal-deep">
            {formError}
          </p>
        ) : null}
      </div>

      <div className="pt-6">
        <Button
          size="lg"
          fullWidth
          onClick={finish}
          loading={isPending}
          disabled={username.trim().length < 3 || available === false}
        >
          {t("startListening")}
        </Button>
      </div>
    </div>
  );
}
