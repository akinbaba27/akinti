/**
 * Turns a raw `NotificationWithActor` row into what the UI renders: a title,
 * a one-line body, the route a click should land on, and an icon. Kept as a
 * pure function so the copy/grouping/routing rules for every notification
 * type live in exactly one place and are trivially unit-testable.
 *
 * Grouping itself (the "3 people saved your Wave" collapse) already happened
 * server-side in `push_notification` (migration 08) — `count` is how many
 * events collapsed into this row, and `actor` is the most recent actor.
 *
 * Copy is resolved through a translator the caller passes in, not built from
 * `TERMS`. It used to be the latter, which made the whole notification list
 * render in English inside a Turkish session while the surrounding shell was
 * translated (found by the 2026-09-25 audit's Turkish sweep). The function
 * stays pure — it takes `t` rather than calling `useTranslations` itself — so
 * it is still just as testable, and its single consumer
 * (`NotificationItem.tsx`) is the one place a React hook belongs.
 *
 * Verb phrases are written to follow the actor name ("{actor} started
 * following you"). Turkish is SOV and takes the same shape ("{actor} seni
 * takip etmeye başladı"), so one concatenation works for both locales.
 */
import type { IconComponent } from "@/components/ui/icons";
import {
  Bell,
  Bookmark,
  CircleCheck,
  CircleX,
  MessageCircle,
  MessageSquare,
  Mic2,
  Reply,
  Share2,
  UserCheck,
  UserPlus,
  Users,
  UserRoundPlus,
} from "@/components/ui/icons";

import { routes } from "@/config/routes";
import { BRAND } from "@/config/terminology";
import type { NotificationType, NotificationWithActor } from "@/types/domain";

export interface FormattedNotification {
  /** Short headline, e.g. "Ada and 2 others saved your Wave". */
  title: string;
  /** One-line secondary context. */
  body: string;
  /** Where a click on this notification should navigate. */
  href: string;
  icon: IconComponent;
}

const ICONS: Record<NotificationType, IconComponent> = {
  follow: UserPlus,
  follow_request: UserRoundPlus,
  comment: MessageSquare,
  comment_reply: Reply,
  save: Bookmark,
  share: Share2,
  duet_request: Mic2,
  duet_accepted: CircleCheck,
  duet_declined: CircleX,
  duet_published: Users,
  open_call_answered: Mic2,
  collaborator_invite: Users,
  collaborator_accepted: UserCheck,
  message: MessageCircle,
  system: Bell,
};

/** "Ada", or "Ada and 2 others" once a group has collapsed more than one event. */
function actorLabel(actor: NotificationWithActor["actor"], count: number, t: NotificationTranslator): string {
  const name = actor ? (actor.displayName ?? `@${actor.username}`) : t("actorSomeone");
  if (count <= 1) {
    return name;
  }
  return t("actorWithOthers", { name, others: count - 1 });
}

/**
 * Message keys, not copy. `as const satisfies Record<...>` rather than a plain
 * type annotation, per `docs/I18N.md` §8.4: the annotation alone widens every
 * value to `string`, which next-intl's key checking rejects.
 */
const VERB_KEY = {
  follow: "verbFollow",
  follow_request: "verbFollowRequest",
  comment: "verbComment",
  comment_reply: "verbCommentReply",
  save: "verbSave",
  share: "verbShare",
  duet_request: "verbDuetRequest",
  duet_accepted: "verbDuetAccepted",
  duet_declined: "verbDuetDeclined",
  duet_published: "verbDuetPublished",
  open_call_answered: "verbOpenCallAnswered",
  collaborator_invite: "verbCollaboratorInvite",
  collaborator_accepted: "verbCollaboratorAccepted",
  message: "verbMessage",
} as const satisfies Record<Exclude<NotificationType, "system">, string>;

const BODY_KEY = {
  follow: "bodyFollow",
  follow_request: "bodyFollowRequest",
  comment: "bodyComment",
  comment_reply: "bodyCommentReply",
  save: "bodySave",
  share: "bodyShare",
  duet_request: "bodyDuetRequest",
  duet_accepted: "bodyDuetAccepted",
  duet_declined: "bodyDuetDeclined",
  duet_published: "bodyDuetPublished",
  open_call_answered: "bodyOpenCallAnswered",
  collaborator_invite: "bodyCollaboratorInvite",
  collaborator_accepted: "bodyCollaboratorAccepted",
  message: "bodyMessage",
  system: "bodySystem",
} as const satisfies Record<NotificationType, string>;

/** Exactly the `NotificationFormat` keys this module looks up. */
type NotificationMessageKey =
  | "actorSomeone"
  | "actorWithOthers"
  | (typeof VERB_KEY)[keyof typeof VERB_KEY]
  | (typeof BODY_KEY)[keyof typeof BODY_KEY];

/**
 * The translator shape this module needs. Deliberately keyed by the narrow
 * union above rather than `string`: a `useTranslations("NotificationFormat")`
 * result only accepts keys that exist in that namespace, and a parameter type
 * is contravariant — a translator typed to real keys is not assignable to one
 * declared as `(key: string) => string`. Narrowing here means both next-intl's
 * translator and a test stub satisfy it, without importing next-intl into this
 * pure module.
 */
export type NotificationTranslator = (
  key: NotificationMessageKey,
  values?: Record<string, string | number>,
) => string;

function hrefFor(n: NotificationWithActor): string {
  switch (n.type) {
    case "follow":
    case "follow_request":
      return n.actor ? routes.profile(n.actor.username) : routes.notifications();
    case "comment":
    case "comment_reply":
    case "save":
    case "share":
    case "duet_request":
    case "duet_accepted":
    case "duet_declined":
    case "duet_published":
    case "open_call_answered":
    case "collaborator_invite":
    case "collaborator_accepted":
      return n.waveId ? routes.wave(n.waveId) : routes.notifications();
    case "message":
      return n.conversationId ? routes.conversation(n.conversationId) : routes.messages();
    case "system":
      return routes.notifications();
    default:
      return routes.notifications();
  }
}

export function formatNotification(
  n: NotificationWithActor,
  t: NotificationTranslator,
): FormattedNotification {
  const icon = ICONS[n.type];
  const href = hrefFor(n);

  if (n.type === "system") {
    // The brand name is the title here, not a translated string.
    return { title: BRAND, body: t(BODY_KEY.system, { brand: BRAND }), href, icon };
  }

  const title = `${actorLabel(n.actor, n.count, t)} ${t(VERB_KEY[n.type])}`;
  return { title, body: t(BODY_KEY[n.type]), href, icon };
}
