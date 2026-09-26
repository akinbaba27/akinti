import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/layout";
import { type BackingTrackCard } from "@/components/feed";
import { TracksView } from "@/components/tracks";
import { routes } from "@/config/routes";
import { requireOnboarded } from "@/lib/auth/server";
import { listBackingTracks } from "@/lib/db/backingTracks";
import { toBackingTrackCards } from "@/lib/feed";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabaseClient, type SupabaseServerClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("TracksPage");
  return { title: t("title") };
}

const PAGE_SIZE = 50;

/**
 * The backing-track library, browsable on its own (spec §4, PRODUCT_V2 §4.4).
 *
 * Explore's "Tracks to sing over" lane (`BackingTracksLane`, shared here
 * verbatim) is a teaser of a handful of tracks; this is the full library, for
 * `RecordStage`'s "Sing over a track" row (`onChooseTrack`) to send someone
 * to when the teaser isn't enough. Picking one still works the same way —
 * "Sing over this" links to `/create?track=<id>`, which `/create`'s page
 * resolves server-side before handing `RecordStage` a real backing track.
 */
export default async function TracksPage() {
  await requireOnboarded(routes.tracks());
  const t = await getTranslations("TracksPage");
  const tTerms = await getTranslations("Terms");

  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title={t("title")} />
        <p className="akinti-page type-body measure text-ink-muted">
          {t("unreachable")}
        </p>
      </>
    );
  }

  const db = await createServerSupabaseClient();
  let tracks: BackingTrackCard[] = [];
  let loadError = false;

  try {
    tracks = await loadBackingTracks(db);
  } catch {
    loadError = true;
  }

  return (
    <>
      <PageHeader title={t("title")} />

      {loadError ? (
        <p className="akinti-page type-body measure text-ink-muted">
          {t("loadError")}
        </p>
      ) : tracks.length === 0 ? (
        <div className="akinti-page flex flex-col items-start gap-3">
          <p className="type-body measure text-ink">{t("emptyTitle")}</p>
          <p className="type-body-sm measure text-ink-muted">
            {t("emptyDescription", { record: tTerms("record").toLowerCase(), create: tTerms("create") })}
          </p>
        </div>
      ) : (
        <TracksView tracks={tracks} />
      )}
    </>
  );
}

/** Same shape Explore's teaser lane builds, just for the whole library. */
async function loadBackingTracks(db: SupabaseServerClient): Promise<BackingTrackCard[]> {
  const page = await listBackingTracks(db, { limit: PAGE_SIZE });
  // `listBackingTracks` ran under the caller's RLS, so every track here is one
  // they may see; `toBackingTrackCards` reads only those assets' peaks and
  // duration with the admin client. See that module for why the previous
  // caller-scoped read silently emptied the whole library.
  return toBackingTrackCards(createAdminClient(), page.items);
}
