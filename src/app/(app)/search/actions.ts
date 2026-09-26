"use server";

/**
 * Server Action backing `/search?q=` (spec s24). Same `{ ok, data?, error? }`
 * contract as every other Server Action in the app — never throws to the
 * client (spec s38). Public: no `requireUser`, matching Explore — an
 * anonymous searcher gets exactly the RLS-visible slice (`everyone` Waves,
 * public/viewable profiles), never a special-cased query.
 */

import { getTranslations } from "next-intl/server";

import type { BackingTrackCard } from "@/components/feed";
import type { WaveCardContainerWave } from "@/components/wave";
import { getCurrentUser } from "@/lib/auth/server";
import { listBackingTracks } from "@/lib/db/backingTracks";
import { toBackingTrackCards } from "@/lib/feed";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchAll } from "@/lib/db/search";
import { MAX_PAGE_LIMIT } from "@/lib/db/types";
import { hydrateWaveCards } from "@/lib/feed";
import { createServerSupabaseClient, type SupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/domain";

export interface SearchResults {
  profiles: Profile[];
  waves: WaveCardContainerWave[];
  /**
   * Matched against the library's own title/artist credit/genre tags —
   * `list_backing_tracks` (spec: curated/open tracks) has no text-search
   * parameter, so this filters the first `MAX_PAGE_LIMIT` tracks in the
   * library rather than fabricating a dedicated search index for it (the
   * same "swap seam, not a fake result" reasoning `lib/db/search.ts`
   * documents for Waves/profiles).
   */
  tracks: BackingTrackCard[];
}

export interface SearchActionResult {
  ok: boolean;
  data?: SearchResults;
  error?: string;
}

const SEARCH_RESULT_LIMIT = 20;

export async function runSearch(query: string): Promise<SearchActionResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { ok: true, data: { profiles: [], waves: [], tracks: [] } };
  }

  try {
    const user = await getCurrentUser();
    const supabase = await createServerSupabaseClient();
    const [{ profiles, waves }, tracks] = await Promise.all([
      searchAll(supabase, { query: trimmed, limit: SEARCH_RESULT_LIMIT }),
      searchTracks(supabase, trimmed),
    ]);
    const waveCards = await hydrateWaveCards(supabase, waves, user?.id ?? null);
    return { ok: true, data: { profiles, waves: waveCards, tracks } };
  } catch (error) {
    if (error instanceof Error) {
      return { ok: false, error: error.message };
    }
    const t = await getTranslations("Common");
    return { ok: false, error: t("somethingWentWrong") };
  }
}

/** Exported for `search/page.tsx`'s own first-paint server render, which needs the same tracks match `runSearch` computes for subsequent client-side searches. */
export async function searchTracks(db: SupabaseServerClient, query: string): Promise<BackingTrackCard[]> {
  const normalized = query.toLowerCase();
  const page = await listBackingTracks(db, { limit: MAX_PAGE_LIMIT });
  const matches = page.items.filter(
    (track) =>
      track.title.toLowerCase().includes(normalized) ||
      track.artistCredit.toLowerCase().includes(normalized) ||
      track.genreTags.some((tag) => tag.toLowerCase().includes(normalized)),
  );
  // `listBackingTracks` ran under the caller's RLS, so every match is a track
  // they may see; the asset read happens inside `toBackingTrackCards`.
  return toBackingTrackCards(createAdminClient(), matches);
}
