import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { ChallengeHeroCard, type ChallengeHeroCardBackingTrack } from "@/components/challenges";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui";
import { getBackingTrackById } from "@/lib/db/backingTracks";
import {
  deriveChallengePhase,
  listChallengeEntries,
  listChallenges,
  localizeChallenge,
} from "@/lib/db/challenges";
import { MAX_PAGE_LIMIT } from "@/lib/db/types";
import { routes } from "@/config/routes";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabaseClient, type SupabaseServerClient } from "@/lib/supabase/server";
import type { Challenge } from "@/types/domain";

export async function generateMetadata() {
  const t = await getTranslations("Terms");
  return { title: t("challenges") };
}

const PAGE_SIZE = 50;

/**
 * `/challenges` (PRODUCT_V2 §4 "Prompts & challenges") — the weekly theme
 * list. Minimal, server-rendered: a left-aligned trace list, no cards
 * (DESIGN.md §12). Entering a challenge and the curated Top 5 live on the
 * detail page (`[slug]/page.tsx`); a richer composer flow is a later agent's
 * screen work.
 */
export default async function ChallengesPage() {
  const t = await getTranslations("Terms");
  const tPage = await getTranslations("ChallengesPage");
  const locale = await getLocale();

  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title={t("challenges")} />
        <EmptyState
          title={tPage("notConnectedTitle")}
          description={tPage("notConnectedDescription")}
        />
      </>
    );
  }

  const db = await createServerSupabaseClient();
  let challenges: Challenge[] = [];
  let loadError = false;
  try {
    challenges = (await listChallenges(db, { limit: PAGE_SIZE })).items;
  } catch {
    loadError = true;
  }

  // Live first, then upcoming, then closed (spec item 4: "live first, then
  // closed") — a stable sort so challenges within the same phase keep the
  // RPC's own `starts_at` ordering.
  const phaseRank: Record<ReturnType<typeof deriveChallengePhase>, number> = {
    active: 0,
    upcoming: 1,
    ended: 2,
  };
  challenges = [...challenges].sort((a, b) => phaseRank[deriveChallengePhase(a)] - phaseRank[deriveChallengePhase(b)]);

  const liveChallenges = challenges.filter((challenge) => deriveChallengePhase(challenge) === "active");
  const restChallenges = challenges.filter((challenge) => deriveChallengePhase(challenge) !== "active");
  /**
   * Challenges exist, but none is live or on its way — the state this screen
   * sits in between themes, and the one it used to handle worst. The
   * `challenges.length === 0` empty state below never fired (there ARE rows),
   * so the page rendered a bare list of "Ended" items with no explanation,
   * which reads as abandoned rather than between. Flow's own empty state sends
   * people here with "Browse challenges", so it is a first-run destination too.
   */
  const noneUpcoming =
    !loadError &&
    challenges.length > 0 &&
    !challenges.some((challenge) => deriveChallengePhase(challenge) !== "ended");
  const heroCards = loadError ? [] : await Promise.all(liveChallenges.map((challenge) => loadHeroCardData(db, challenge)));

  return (
    <>
      <PageHeader title={t("challenges")} />
      <div className="akinti-page pb-16">
        {loadError ? (
          <p className="type-body measure text-ink-muted">{tPage("loadError")}</p>
        ) : challenges.length === 0 ? (
          <EmptyState
            title={tPage("emptyTitle")}
            description={tPage("emptyDescription")}
          />
        ) : (
          <>
            {noneUpcoming ? (
              <div className="flex flex-col items-start gap-1.5 pb-8">
                <p className="type-body text-ink">{tPage("noneLiveTitle")}</p>
                <p className="type-body-sm measure text-ink-muted">{tPage("noneLiveDescription")}</p>
                {/* Same key treatment `FlowEmptyState` uses for its own
                    actions: a real h-13 target rather than a 20px-tall inline
                    link, since these are the primary actions on a first-run
                    destination. Measured at 390px by
                    `scripts/qa/mobile-quality-2026-09-26.mjs`. */}
                <div className="flex flex-col items-stretch gap-2.5 pt-3 sm:flex-row sm:items-center">
                  <Link
                    href={routes.create()}
                    className="akinti-press flex h-13 items-center justify-start rounded-key bg-ink px-5 type-subhead text-on-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  >
                    {t("record")}
                  </Link>
                  <Link
                    href={routes.tracks()}
                    className="akinti-press flex h-13 items-center justify-start rounded-key border border-hairline-strong px-5 type-subhead text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
                  >
                    {tPage("browseTracks")}
                  </Link>
                </div>
              </div>
            ) : null}

            {/* Mobile keeps the exact original plain-list shape, every
                phase in one list (this pass's brief: "mobile unchanged"). */}
            <ChallengeList challenges={challenges} locale={locale} tPage={tPage} className="lg:hidden" />

            {/* Desktop: live challenges as hero cards (item 1: "live
                challenges as hero cards with the backing-track play,
                deadline, entry count, sand mark"), everything else as the
                same plain list below. */}
            <div className="hidden flex-col gap-8 lg:flex">
              {heroCards.length > 0 ? (
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
                  {heroCards.map(({ challenge, entryCount, entryCountCapped, backingTrack, daysLeft }) => (
                    <ChallengeHeroCard
                      key={challenge.id}
                      slug={challenge.slug}
                      title={localizeChallenge(challenge, locale).title}
                      brief={localizeChallenge(challenge, locale).brief}
                      daysLeft={daysLeft}
                      entryCount={entryCount}
                      entryCountCapped={entryCountCapped}
                      backingTrack={backingTrack}
                    />
                  ))}
                </div>
              ) : null}
              {restChallenges.length > 0 ? (
                <ChallengeList challenges={restChallenges} locale={locale} tPage={tPage} />
              ) : null}
            </div>
          </>
        )}
      </div>
    </>
  );
}

interface HeroCardData {
  challenge: Challenge;
  entryCount: number;
  entryCountCapped: boolean;
  backingTrack: ChallengeHeroCardBackingTrack | null;
  daysLeft: number;
}

/** Whole days until `endsAtIso`. A plain (non-component) function, per `deriveChallengePhase`'s own pattern — the "now" read stays out of a component's render body, where the React Compiler's purity rule flags a direct `Date.now()` call. */
function daysUntil(endsAtIso: string, now: number = Date.now()): number {
  return Math.ceil((new Date(endsAtIso).getTime() - now) / 86_400_000);
}

/** Real entry count (capped by `MAX_PAGE_LIMIT`, never fabricated past that — see `ChallengeHeroCard`'s own doc comment) plus the backing track a live challenge's hero card needs. */
async function loadHeroCardData(db: SupabaseServerClient, challenge: Challenge): Promise<HeroCardData> {
  const [entryPage, backingTrack] = await Promise.all([
    listChallengeEntries(db, challenge.id, { limit: MAX_PAGE_LIMIT }).catch(() => ({ items: [], nextCursor: null })),
    challenge.backingTrackId ? getBackingTrackById(db, challenge.backingTrackId).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    challenge,
    entryCount: entryPage.items.length,
    entryCountCapped: entryPage.nextCursor !== null,
    daysLeft: daysUntil(challenge.endsAt),
    backingTrack: backingTrack
      ? {
          audioAssetId: backingTrack.audioAssetId,
          title: backingTrack.title,
          artistCredit: backingTrack.artistCredit,
          durationMs: backingTrack.durationMs,
        }
      : null,
  };
}

function ChallengeList({
  challenges,
  locale,
  tPage,
  className,
}: {
  challenges: readonly Challenge[];
  locale: string;
  tPage: (key: "startsSoon" | "ended" | "liveNow") => string;
  className?: string;
}) {
  return (
    <ul className={`flex flex-col divide-y divide-hairline border-t border-hairline ${className ?? ""}`}>
      {challenges.map((challenge) => {
        const { title } = localizeChallenge(challenge, locale);
        return (
          <li key={challenge.id}>
            <Link
              href={routes.challenge(challenge.slug)}
              className="flex flex-col gap-1 py-4 hover:bg-paper-raised"
            >
              <span className="type-heading text-ink">{title}</span>
              <span className="type-body-sm text-ink-muted">
                #{challenge.hashtag} · {phaseCopy(challenge, tPage)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function phaseCopy(challenge: Challenge, t: (key: "startsSoon" | "ended" | "liveNow") => string): string {
  const phase = deriveChallengePhase(challenge);
  if (phase === "upcoming") return t("startsSoon");
  if (phase === "ended") return t("ended");
  return t("liveNow");
}
