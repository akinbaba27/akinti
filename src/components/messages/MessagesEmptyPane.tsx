import Link from "next/link";
import { useTranslations } from "next-intl";

import { routes } from "@/config/routes";
import { MessageCircle } from "@/components/ui/icons";

/**
 * The desktop (`>= 1024px`) right pane when `/messages` itself is open (no
 * thread selected — `ConversationListPane` already shows every thread in the
 * left sidebar, so this only needs to invite a choice). Left-aligned with a
 * real next action, per `DESIGN.md` §8.14's empty-state rule; the icon sits
 * inline next to the title rather than centred above it in a circle, the one
 * shape that rule specifically bans.
 */
export function MessagesEmptyPane() {
  const t = useTranslations("MessagesEmptyPane");

  return (
    <div className="flex h-full flex-col items-start justify-center gap-3 px-10">
      <MessageCircle className="size-8 text-ink-subtle" weight="regular" />
      <h2 className="type-desktop-subheading text-ink">{t("title")}</h2>
      <p className="type-body-sm measure text-ink-muted">{t("description")}</p>
      <Link
        href={routes.explore()}
        className="akinti-press type-subhead mt-1 inline-flex h-11 items-center rounded-key border border-hairline-strong px-4 text-ink transition-colors hover:bg-elevation-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
      >
        {t("findPeople")}
      </Link>
    </div>
  );
}
