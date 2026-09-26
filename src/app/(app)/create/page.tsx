import { getLocale, getTranslations } from "next-intl/server";

import { requireOnboarded } from "@/lib/auth/server";
import { routes } from "@/config/routes";
import { getBackingTrackById } from "@/lib/db/backingTracks";
import { getChallengeBySlug, localizeChallenge } from "@/lib/db/challenges";
import { toBackingTrackCards } from "@/lib/feed";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/common";
import { challengeSlugSchema } from "@/lib/validation/challenges";

import type { RecordStageBackingTrack } from "@/components/create";
import type { CreateFlowChallenge } from "./CreateFlow";

import { CreateFlow } from "./CreateFlow";

export async function generateMetadata() {
  const t = await getTranslations("CreateFlow");
  const tTerms = await getTranslations("Terms");
  return { title: t("createAWave", { aWave: tTerms("aWave") }) };
}

interface CreatePageProps {
  searchParams: Promise<{ track?: string; challenge?: string }>;
}

/**
 * Create: record in the app or upload an existing file (spec §17, §18).
 * `/create` is a protected route: `src/proxy.ts` already redirects a
 * signed-out/not-onboarded visitor at the edge, but that's a UX convenience,
 * never the authorization boundary (see docs/SECURITY.md) — every protected
 * Server Component independently calls `requireOnboarded`, and this one did
 * not until now. See the header comment in `CreateFlow.tsx` for the client
 * capture flow and `actions.ts` for the Server Actions it now calls.
 *
 * `?track=<id>` (from Explore's "Tracks to sing over" lane or `/tracks`,
 * spec §4) is resolved here, server-side, rather than fetched again on the
 * client: `getBackingTrackById` already reads through the caller's RLS-scoped
 * client, so an id for a track that is neither curated, open-for-vocals nor
 * the caller's own simply resolves to `null` — a quiet fallback to "no
 * track", never an error screen over one stale or mistyped link.
 *
 * `?challenge=<slug>` (from a challenge's "Enter with a new Wave", spec §4
 * `docs/CHALLENGES.md`) is resolved the same way, through `getChallengeBySlug`
 * — which already reads through RLS, so a slug that is hidden or missing
 * quietly resolves to no challenge rather than an error screen. Its own
 * backing track, if it has one, preselects the same way `?track=` does,
 * unless the link already named an explicit `track`.
 *
 * Both params are Zod-validated (`uuidSchema`/`challengeSlugSchema`) before
 * ever reaching a database call — not for injection safety (every read
 * below is already parameterized) but because CLAUDE.md requires every
 * input validated, and an unbounded `p_slug` otherwise reaches Postgres
 * straight from a public param on a protected route (review2 #9). A
 * malformed value is treated exactly like a valid-but-unresolvable one:
 * ignored, never an error screen.
 */
export default async function CreatePage({ searchParams }: CreatePageProps) {
  await requireOnboarded(routes.create());
  const { track: trackId, challenge: challengeSlug } = await searchParams;

  const parsedChallengeSlug = challengeSlug ? challengeSlugSchema.safeParse(challengeSlug) : null;
  const challenge = parsedChallengeSlug?.success ? await loadChallenge(parsedChallengeSlug.data) : null;

  const parsedTrackId = trackId ? uuidSchema.safeParse(trackId) : null;
  const resolvedTrackId = (parsedTrackId?.success ? parsedTrackId.data : null) ?? challenge?.backingTrackId ?? null;
  const initialBackingTrack = resolvedTrackId ? await loadBackingTrack(resolvedTrackId) : null;

  return <CreateFlow initialBackingTrack={initialBackingTrack} initialChallenge={challenge} />;
}

async function loadChallenge(slug: string): Promise<CreateFlowChallenge | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const db = await createServerSupabaseClient();
    const challenge = await getChallengeBySlug(db, slug);
    if (!challenge) return null;
    const locale = await getLocale();
    return {
      id: challenge.id,
      slug: challenge.slug,
      title: localizeChallenge(challenge, locale).title,
      backingTrackId: challenge.backingTrackId ?? null,
    };
  } catch {
    // A missing/unreachable challenge is never a reason to block the whole
    // record screen — the singer just publishes without entering one.
    return null;
  }
}

async function loadBackingTrack(trackId: string): Promise<RecordStageBackingTrack | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const db = await createServerSupabaseClient();
    const track = await getBackingTrackById(db, trackId);
    if (!track || (!track.isCurated && !track.openForVocals)) return null;
    // The two lines above ARE the authorization check: the track was read with
    // the caller's own RLS-scoped client and re-tested for being deliberately
    // shared. The duration then comes from the admin client, because
    // `can_view_audio_asset` does not recognise a backing track's instrumental
    // and a caller-scoped read returns nothing — which used to make this
    // function return null for every track, so `/create?track=<id>` silently
    // dropped the instrumental the singer had just chosen. See
    // `src/lib/feed/backingTrackCards.ts`.
    const [card] = await toBackingTrackCards(createAdminClient(), [track]);
    return {
      id: track.id,
      title: track.title,
      artistCredit: track.artistCredit,
      audioAssetId: track.audioAssetId,
      durationMs: card?.durationSeconds ? Math.round(card.durationSeconds * 1000) : null,
    };
  } catch {
    // A missing/unreachable track is never a reason to block the whole
    // record screen — the singer just starts without one (spec §38).
    return null;
  }
}
