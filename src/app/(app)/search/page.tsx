import { getTranslations } from "next-intl/server";

import type { BackingTrackCard } from "@/components/feed";
import { PageHeader } from "@/components/layout";
import { SearchView } from "@/components/feed";
import type { WaveCardContainerWave } from "@/components/wave";
import { TERMS } from "@/config/terminology";
import { getCurrentUser } from "@/lib/auth/server";
import { searchAll } from "@/lib/db/search";
import { hydrateWaveCards } from "@/lib/feed";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/domain";

import { searchTracks } from "./actions";

export const metadata = { title: TERMS.search };

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

/**
 * Search (SCREENS.md §4).
 *
 * The first page of results is rendered on the server, so a shared
 * `/search?q=…` link opens on real results rather than an empty shell;
 * `SearchView` takes over for further typing. Public, like Explore: an
 * anonymous visitor gets exactly the slice RLS allows, never a special case.
 */
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const t = await getTranslations("SearchPage");
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
        <PageHeader title={tTerms("search")} />
        <p className="akinti-page type-body measure text-ink-muted">{t("notReachable")}</p>
      </>
    );
  }

  let profiles: Profile[] = [];
  let waves: WaveCardContainerWave[] = [];
  let tracks: BackingTrackCard[] = [];
  let loadError: string | null = null;

  if (query.length > 0) {
    try {
      const user = await getCurrentUser();
      const supabase = await createServerSupabaseClient();
      const [result, trackMatches] = await Promise.all([
        searchAll(supabase, { query, limit: 20 }),
        searchTracks(supabase, query),
      ]);
      profiles = result.profiles;
      waves = await hydrateWaveCards(supabase, result.waves, user?.id ?? null);
      tracks = trackMatches;
    } catch {
      loadError = t("searchFailed");
    }
  }

  return (
    <>
      <PageHeader title={tTerms("search")} />
      <SearchView
        initialQuery={query}
        initialProfiles={profiles}
        initialWaves={waves}
        initialTracks={tracks}
        initialError={loadError}
      />
    </>
  );
}
