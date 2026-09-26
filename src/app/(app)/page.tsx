import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/layout";
import { FollowingFeed, HomeEmptyState } from "@/components/feed";
import type { TraceRowWave } from "@/components/feed";
import { routes } from "@/config/routes";
import { TERMS } from "@/config/terminology";
import { requireUser } from "@/lib/auth/server";
import { listHomeFeed, listTrendingWaves } from "@/lib/db/waves";
import { hydrateWaveCards } from "@/lib/feed";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { listHeardWaveIds } from "./listened";

export const metadata = { title: TERMS.home };

/** How many real Waves the empty state plays. Three, per §8.14. */
const EMPTY_STATE_WAVES = 3;

/**
 * Home (SCREENS.md §2): the stream of Waves from the people this reader
 * follows, hung on the 44px rail with a waterline between one Wave and the
 * next. Visibility is enforced end to end by RLS and `can_view_wave`.
 *
 * An account with nothing in its stream does not get an icon in a grey circle
 * (§12.5). It gets three real Waves from Explore that play where they stand,
 * and one key into Explore — the empty state is a working feed (§8.14).
 */
export default async function HomePage() {
  const user = await requireUser(routes.home());
  const t = await getTranslations("HomePage");
  // Page title via the translated `Terms` namespace, not the English-only
  // `TERMS` constant: `docs/I18N.md` §4 leaves each `TERMS.x` call site for
  // "whichever stage next touches that screen", and this <h1> was still
  // rendering in English inside a Turkish session (2026-09-25 audit sweep).
  // This file's `export const metadata` keeps `TERMS.x`: a static metadata
  // object is evaluated before any per-request locale exists, so moving it
  // needs the `generateMetadata` conversion §4 describes, not a swap.
  const tTerms = await getTranslations("Terms");

  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title={tTerms("home")} />
        <p className="akinti-page type-body measure text-ink-muted">{t("notReachable")}</p>
      </>
    );
  }

  const supabase = await createServerSupabaseClient();

  let initialItems: Awaited<ReturnType<typeof hydrateWaveCards>> = [];
  let initialCursor: string | null = null;
  let unheardIds: string[] = [];
  let elsewhere: TraceRowWave[] = [];
  let loadError: string | null = null;

  try {
    const page = await listHomeFeed(supabase, user.id, { limit: 10 });
    initialCursor = page.nextCursor;

    if (page.items.length > 0) {
      // `hydrateWaveCards` and `listHeardWaveIds` both only need `page.items`'
      // ids, never each other's output, so they run together instead of one
      // after the other (docs/qa/perf2/WATERFALL.md).
      const [hydrated, heard] = await Promise.all([
        hydrateWaveCards(supabase, page.items, user.id),
        listHeardWaveIds(
          supabase,
          user.id,
          page.items.map((item) => item.id),
        ),
      ]);
      initialItems = hydrated;
      unheardIds = initialItems.filter((item) => !heard.has(item.id)).map((item) => item.id);
    } else {
      const trending = await listTrendingWaves(supabase, { limit: EMPTY_STATE_WAVES, offset: 0 });
      const cards = await hydrateWaveCards(supabase, trending, user.id);
      elsewhere = cards.map(toTraceRow);
    }
  } catch (error) {
    loadError = error instanceof Error ? error.message : null;
  }

  return (
    <>
      <PageHeader title={tTerms("home")} />

      {loadError ? (
        <div className="akinti-page flex flex-col items-start gap-3 pb-8">
          <p role="alert" className="type-body measure text-ink">
            {t("loadError")}
          </p>
          <a
            href={routes.home()}
            className="akinti-press inline-flex h-11 items-center rounded-key border border-hairline-strong px-4 type-subhead text-ink transition-colors hover:bg-paper-sunk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {t("tryAgain")}
          </a>
        </div>
      ) : initialItems.length === 0 ? (
        <HomeEmptyState waves={elsewhere} />
      ) : (
        <FollowingFeed
          initialItems={initialItems}
          initialCursor={initialCursor}
          unheardIds={unheardIds}
        />
      )}
    </>
  );
}

function toTraceRow(card: Awaited<ReturnType<typeof hydrateWaveCards>>[number]): TraceRowWave {
  return {
    id: card.id,
    title: card.title,
    audioAssetId: card.audioAssetId,
    peaks: card.peaks,
    duration: card.duration,
    creator: {
      username: card.creator.username,
      displayName: card.creator.displayName,
    },
  };
}
