
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui";
import { DuetRequestForm } from "@/components/duet";
import { WaveCardContainer, type WaveCardContainerWave } from "@/components/wave";
import { getAudioAssetById } from "@/lib/db/audioAssets";
import { canRequestDuet } from "@/lib/db/duetRequests";
import { resolveWavePeaks } from "@/lib/audio/peaks";
import { getProfileById } from "@/lib/db/profiles";
import { isWaveSaved } from "@/lib/db/saves";
import { getWaveById } from "@/lib/db/waves";
import { requireUser } from "@/lib/auth/server";
import { routes } from "@/config/routes";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

interface DuetRequestPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: DuetRequestPageProps) {
  const { id } = await params;
  const t = await getTranslations("Terms");
  return { title: `${t("requestDuet")} · ${t("wave")} ${id}` };
}

/**
 * `/w/[id]/duet` (spec §15 deliverable 1): shows the original Wave and a
 * message field, then sends a `duet_requests` row via `requestDuet`
 * (`./actions.ts`). The interactions agent's "Request a Duet" button on the
 * Wave card navigates here (see this agent's ownership note in the Stage 9
 * brief) rather than requesting inline.
 *
 * `requireUser` gates this even though `/w/` is in the proxy's public prefix
 * list (Wave visibility is enforced server-side, not by gating the route) —
 * requesting a Duet always requires a signed-in account, so this page
 * independently redirects (307) anonymous visitors to `/login`.
 */
export default async function DuetRequestPage({ params }: DuetRequestPageProps) {
  const { id } = await params;
  const user = await requireUser(routes.waveDuet(id));
  const tTerms = await getTranslations("Terms");
  const t = await getTranslations("DuetRequestPage");

  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title={tTerms("requestDuet")} />
        <EmptyState title={t("notConnectedTitle")} description={t("notConnectedDescription")} />
      </>
    );
  }

  const db = await createServerSupabaseClient();
  const wave = await getWaveById(db, id);

  if (!wave) {
    return <UnavailableState />;
  }
  if (wave.creatorId === user.id) {
    return (
      <>
        <PageHeader title={tTerms("requestDuet")} />
        <EmptyState title={t("ownWaveTitle")} description={t("ownWaveDescription")} />
      </>
    );
  }

  const [asset, creator, hasSaved, allowed] = await Promise.all([
    getAudioAssetById(db, wave.audioAssetId),
    getProfileById(db, wave.creatorId),
    isWaveSaved(db, user.id, wave.id),
    // The real, server-side authority (spec §15) — this page's own denial
    // state below is a courtesy, not the enforcement (`requestDuet` in
    // `./actions.ts` calls this same predicate again before writing anything).
    canRequestDuet(db, wave.id),
  ]);

  if (!asset || !creator) {
    return <UnavailableState />;
  }

  if (!allowed) {
    return (
      <>
        <PageHeader title={tTerms("requestDuet")} />
        <EmptyState title={t("notAllowedTitle")} description={t("notAllowedDescription")} />
      </>
    );
  }

  const cardWave: WaveCardContainerWave = {
    id: wave.id,
    title: wave.title,
    description: wave.description ?? undefined,
    createdAt: wave.publishedAt,
    creator: {
      username: creator.username,
      displayName: creator.displayName ?? undefined,
      avatarUrl: creator.avatarUrl,
    },
    creationType: wave.creationType,
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
    isSaved: hasSaved,
    // Already on the request flow — no reason to show a second, live
    // "Request a Duet" button on the preview card itself.
    canRequestDuet: false,
  };

  return (
    <>
      <PageHeader
        title={tTerms("requestDuet")}
      />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-16 sm:px-5">
        <WaveCardContainer wave={cardWave} />
        {/* Plain-language explainer (product feedback, 2026-09-18: "didn't
            understand what to do as a user") — this page previously had no
            copy at all beyond the form itself. Nothing here changes the
            actual flow; it only says out loud what already happens:
            `creator.username` must accept before recording can start, and
            the mode (together / in turn / call-and-response) is chosen
            afterwards, on the record screen, not here. */}
        <p className="type-body-sm measure text-ink-muted">
          {t("explainer", { creator: creator.username })}
        </p>
        <DuetRequestForm waveId={wave.id} />
        <Link href={routes.duets()} className="type-body-sm text-ink underline">
          {t("trackRequests")}
        </Link>
      </div>
    </>
  );
}

async function UnavailableState() {
  const tTerms = await getTranslations("Terms");
  const t = await getTranslations("DuetRequestPage");
  return (
    <>
      <PageHeader title={tTerms("requestDuet")} />
      <EmptyState title={t("unavailableTitle", { wave: tTerms("wave") })} description={t("unavailableDescription")} />
    </>
  );
}
