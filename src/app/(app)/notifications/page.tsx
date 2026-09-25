import { getTranslations } from "next-intl/server";

import { routes } from "@/config/routes";
import { TERMS } from "@/config/terminology";
import { requireUser } from "@/lib/auth/server";
import { countUnreadNotifications, listNotifications } from "@/lib/db/notifications";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NotificationsView } from "@/components/notifications";
import { ErrorState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import type { NotificationWithActor, Page } from "@/types/domain";

export const metadata = { title: TERMS.notifications };

/** Notifications: follows, comments, saves, shares and Duet activity (spec 23). */
export default async function NotificationsPage() {
  // Page title via the translated `Terms` namespace, not the English-only
  // `TERMS` constant: `docs/I18N.md` §4 leaves each `TERMS.x` call site for
  // "whichever stage next touches that screen", and this <h1> was still
  // rendering in English inside a Turkish session (2026-09-25 audit sweep).
  // This file's `export const metadata` keeps `TERMS.x`: a static metadata
  // object is evaluated before any per-request locale exists, so moving it
  // needs the `generateMetadata` conversion §4 describes, not a swap.
  const tTerms = await getTranslations("Terms");
  const user = await requireUser(routes.notifications());
  const supabase = await createServerSupabaseClient();

  let initial: { page: Page<NotificationWithActor>; unreadCount: number } | null = null;
  let loadError: string | null = null;
  try {
    const [page, unreadCount] = await Promise.all([
      listNotifications(supabase, { limit: 20 }),
      countUnreadNotifications(supabase, user.id),
    ]);
    initial = { page, unreadCount };
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Something went wrong.";
  }

  return (
    <>
      <PageHeader
        title={tTerms("notifications")}
      />
      {loadError || !initial ? (
        <ErrorState description={loadError ?? "We could not load your notifications right now."} />
      ) : (
        <NotificationsView
          userId={user.id}
          initialItems={initial.page.items}
          initialCursor={initial.page.nextCursor}
          initialUnreadCount={initial.unreadCount}
        />
      )}
    </>
  );
}
