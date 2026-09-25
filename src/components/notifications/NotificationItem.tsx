"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { markNotificationRead, respondToCollaboratorInvite } from "@/app/(app)/notifications/actions";
import { acceptFollowRequest, declineFollowRequest } from "@/app/(app)/u/[username]/actions";
import { Button, Spinner } from "@/components/ui";
import { formatNotification } from "@/lib/notifications";
import { cn, formatAbsoluteTime, timeAgo } from "@/lib/ui";
import type { NotificationWithActor } from "@/types/domain";

import { NotificationWavePreview } from "./NotificationWavePreview";

export interface NotificationItemProps {
  notification: NotificationWithActor;
  /** Called once this notification is confirmed read (server call succeeded). */
  onRead: (id: string) => void;
  className?: string;
}

type ResolutionState = "pending" | "accepted" | "declined";

/**
 * One row in the notifications list: icon, grouped copy, relative timestamp,
 * unread styling, and — for `follow_request` / `collaborator_invite` —
 * inline Accept/Decline. Clicking the title marks the notification read and
 * navigates to its context (spec 23: "Clicking navigates to the correct
 * context").
 */
export function NotificationItem({ notification, onRead, className }: NotificationItemProps) {
  const t = useTranslations("NotificationItem");
  const tFormat = useTranslations("NotificationFormat");
  const formatted = formatNotification(notification, tFormat);
  const Icon = formatted.icon;
  const isUnread = notification.readAt === null;
  const [isMarking, startMarking] = useTransition();
  const [isResponding, startResponding] = useTransition();
  const [resolution, setResolution] = useState<ResolutionState>("pending");
  const [actionError, setActionError] = useState<string | null>(null);

  const markRead = () => {
    if (!isUnread) return;
    startMarking(async () => {
      const result = await markNotificationRead(notification.id);
      if (result.ok) {
        onRead(notification.id);
      }
    });
  };

  const respond = (accept: boolean) => {
    setActionError(null);
    startResponding(async () => {
      if (notification.type === "follow_request" && notification.actorId) {
        // Reuses the profile agent's follow accept/decline Server Actions
        // (`src/app/(app)/u/[username]/actions.ts`) rather than
        // re-implementing them here — same `respondToFollowRequest` helper,
        // one code path.
        const result = accept
          ? await acceptFollowRequest(notification.actorId)
          : await declineFollowRequest(notification.actorId);
        if (result.ok) {
          setResolution(accept ? "accepted" : "declined");
          markRead();
        } else {
          setActionError(result.formError ?? t("somethingWrong"));
        }
        return;
      }

      if (notification.type === "collaborator_invite" && notification.waveId) {
        const result = await respondToCollaboratorInvite(notification.waveId, accept);
        if (result.ok) {
          setResolution(accept ? "accepted" : "declined");
          markRead();
        } else {
          setActionError(result.error ?? t("somethingWrong"));
        }
        return;
      }

      setActionError(t("nothingToRespond"));
    });
  };

  const canRespond =
    (notification.type === "follow_request" && Boolean(notification.actorId)) ||
    (notification.type === "collaborator_invite" && Boolean(notification.waveId));

  return (
    <li
      className={cn(
        "relative flex gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-surface-muted sm:px-5",
        isUnread && "bg-accent-soft/40",
        className,
      )}
    >
      {isUnread ? (
        // The unread mark (SCREENS.md §10): Signal, the one non-audio place
        // it's allowed — it denotes unheard activity, not a generic accent.
        <span aria-hidden="true" className="absolute top-5 left-1.5 size-1.5 rounded-full bg-signal" />
      ) : null}

      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg-muted"
      >
        <Icon className="size-[1.125rem]" />
      </span>

      <div className="min-w-0 flex-1">
        <Link
          href={formatted.href}
          onClick={markRead}
          className={cn(
            "block rounded-sm text-sm leading-snug text-fg",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            isUnread ? "font-semibold" : "font-medium",
          )}
        >
          {formatted.title}
        </Link>
        <p className="mt-0.5 text-xs text-fg-muted">{formatted.body}</p>
        <time
          dateTime={notification.updatedAt}
          title={formatAbsoluteTime(notification.updatedAt)}
          className="mt-1 block text-[0.6875rem] text-fg-subtle"
        >
          {timeAgo(notification.updatedAt)}
        </time>

        {notification.waveId && notification.type !== "collaborator_invite" ? (
          <NotificationWavePreview waveId={notification.waveId} />
        ) : null}

        {canRespond && resolution === "pending" ? (
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={() => respond(true)} loading={isResponding} disabled={isResponding}>
              {t("accept")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => respond(false)}
              loading={isResponding}
              disabled={isResponding}
            >
              {t("decline")}
            </Button>
          </div>
        ) : resolution !== "pending" ? (
          <p className="mt-2 text-xs font-medium text-fg-muted">
            {resolution === "accepted" ? t("accepted") : t("declined")}
          </p>
        ) : null}

        {actionError ? <p className="mt-1 text-xs text-danger">{actionError}</p> : null}
      </div>

      {isMarking ? <Spinner size="sm" label={null} className="mt-1 shrink-0" /> : null}
    </li>
  );
}
