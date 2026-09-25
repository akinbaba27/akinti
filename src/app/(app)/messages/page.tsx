import { getTranslations } from "next-intl/server";

import { routes } from "@/config/routes";
import { TERMS } from "@/config/terminology";
import { requireUser } from "@/lib/auth/server";
import { PageHeader } from "@/components/layout";
import { MessagesView } from "@/components/messages";

export const metadata = { title: TERMS.messages };

/**
 * `/messages`: the conversation inbox (spec §22 deliverable 1). The list
 * itself is fetched once by `layout.tsx` and read through
 * `ConversationListContext` — at `>= 1024px` it's already shown in the
 * `ConversationListPane` sidebar `MessagesDesktopFrame` renders, so
 * `MessagesView` fills this page's own slot with an "open a conversation"
 * invitation there instead of a second copy of the list.
 */
export default async function MessagesPage() {
  // Page title via the translated `Terms` namespace, not the English-only
  // `TERMS` constant: `docs/I18N.md` §4 leaves each `TERMS.x` call site for
  // "whichever stage next touches that screen", and this <h1> was still
  // rendering in English inside a Turkish session (2026-09-25 audit sweep).
  // This file's `export const metadata` keeps `TERMS.x`: a static metadata
  // object is evaluated before any per-request locale exists, so moving it
  // needs the `generateMetadata` conversion §4 describes, not a swap.
  const tTerms = await getTranslations("Terms");
  await requireUser(routes.messages());

  return (
    <>
      {/* Hidden at >= 1024px: `ConversationListPane`'s own header already
          carries the "Messages" title there, and this page's own content is
          just the right pane's "pick a conversation" invitation. */}
      <PageHeader title={tTerms("messages")} className="lg:hidden" />
      <MessagesView />
    </>
  );
}
