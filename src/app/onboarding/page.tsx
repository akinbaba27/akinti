import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/ui";
import { routes } from "@/config/routes";
import { requireUser } from "@/lib/auth/server";
import { hydrateWaveCards } from "@/lib/feed";
import { getProfileById } from "@/lib/db/profiles";
import { listTrendingWaves } from "@/lib/db/waves";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

import { OnboardingFlow } from "./OnboardingFlow";
import type { HearItWave } from "./OnboardingFlow";

export async function generateMetadata() {
  const t = await getTranslations("Terms");
  return { title: t("onboarding") };
}

interface OnboardingPageProps {
  searchParams: Promise<{ next?: string }>;
}

/**
 * `/onboarding` (SCREENS.md §1): three full-bleed steps — "Hear it", "Say
 * it", "Be found" — with no shared chrome from `(auth)/layout.tsx`, which is
 * why this route lives outside that group (the URL is unchanged: route
 * groups don't affect it). See `OnboardingFlow` for the steps themselves.
 */
export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const { next } = await searchParams;

  if (!isSupabaseConfigured()) {
    const t = await getTranslations("OnboardingPage");
    return (
      <div className="akinti-page flex min-h-dvh flex-col justify-center">
        <EmptyState size="sm" title={t("notConnectedTitle")} description={t("notConnectedDescription")} />
      </div>
    );
  }

  const user = await requireUser(next);
  const supabase = await createServerSupabaseClient();
  const profile = await getProfileById(supabase, user.id);

  if (!profile) {
    // The signup trigger creates this row synchronously; missing here means
    // something upstream is broken, not that onboarding should render.
    redirect(routes.login(next));
  }

  if (profile.onboardedAt) {
    // Flow, not Home — the same post-auth default `signIn` and
    // `src/lib/supabase/middleware.ts` already use (`docs/FLOW.md`).
    redirect(next ?? routes.flow());
  }

  // Step one's "someone is talking right now" moment (§1.1) needs one real,
  // already-published Wave. Best-effort: an account onboarding on a very
  // young instance with nothing trending yet still gets steps two and three.
  let hearItWave: HearItWave | null = null;
  try {
    const trending = await listTrendingWaves(supabase, { limit: 1 });
    const [hydrated] = await hydrateWaveCards(supabase, trending, null);
    if (hydrated) {
      hearItWave = {
        id: hydrated.id,
        title: hydrated.title,
        audioAssetId: hydrated.audioAssetId,
        peaks: hydrated.peaks,
        duration: hydrated.duration,
        creator: hydrated.creator,
        createdAt: hydrated.createdAt,
      };
    }
  } catch {
    hearItWave = null;
  }

  // The host this deployment is actually served from, so step three's
  // handle preview shows a URL that resolves rather than a hardcoded
  // `akinti.app` (a domain the project does not own). Same derivation as
  // `(auth)/actions.ts`'s `resolveOrigin`, host only.
  const headerList = await headers();
  const profileHost = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";

  return (
    <OnboardingFlow
      initialUsername={profile.username}
      initialDisplayName={profile.displayName}
      hearItWave={hearItWave}
      next={next}
      profileHost={profileHost}
    />
  );
}
