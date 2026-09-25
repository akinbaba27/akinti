"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { markConversationRead } from "@/app/(app)/messages/actions";
import { groupMessagesByDay, shouldGroupWithPrevious, useThreadMessages, useUnreadMessages } from "@/lib/messages";
import { Button, Spinner } from "@/components/ui";
import type { Message, Profile } from "@/types/domain";

import { BlockedNotice } from "./BlockedNotice";
import { Composer } from "./Composer";
import { DaySeparator } from "./DaySeparator";
import { MessageBubble } from "./MessageBubble";
import { ReportMessageSheet } from "./ReportMessageSheet";
import { ThreadHeader } from "./ThreadHeader";

export interface ThreadViewProps {
  conversationId: string;
  viewerId: string;
  otherProfile: Profile | null;
  initialMessages: Message[];
  initialCursor: string | null;
  isBlocked: boolean;
  initialOtherLastReadAt: string | null;
}

/** Client half of `/messages/[id]`: the thread (spec §22 deliverable 3, §26). */
export function ThreadView({
  conversationId,
  viewerId,
  otherProfile,
  initialMessages,
  initialCursor,
  isBlocked,
  initialOtherLastReadAt,
}: ThreadViewProps) {
  const { messages, hasMore, loadingOlder, loadOlderError, loadOlder, appendOptimistic, otherLastReadAt } =
    useThreadMessages(
      conversationId,
      initialMessages,
      initialCursor,
      otherProfile?.id ?? null,
      initialOtherLastReadAt,
    );
  const { refresh: refreshUnread } = useUnreadMessages(viewerId);
  const t = useTranslations("ThreadView");
  const tBlocked = useTranslations("BlockedNotice");
  const tFormat = useTranslations("MessageFormat");
  const locale = useLocale();
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null);
  const markedReadRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasScrolledInitially = useRef(false);

  useEffect(() => {
    if (markedReadRef.current) return;
    markedReadRef.current = true;
    void markConversationRead(conversationId).then((result) => {
      if (result.ok) refreshUnread();
    });
  }, [conversationId, refreshUnread]);

  useEffect(() => {
    if (hasScrolledInitially.current || messages.length === 0) return;
    hasScrolledInitially.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages.length]);

  const dayGroups = groupMessagesByDay(messages, tFormat, locale);
  const lastMessage = messages[messages.length - 1] ?? null;

  return (
    <div className="flex min-h-[70dvh] flex-col">
      <ThreadHeader otherProfile={otherProfile} />

      {isBlocked ? <BlockedNotice /> : null}

      <div className="flex-1 py-2">
        <div className="flex flex-col items-center py-2">
          {loadOlderError ? (
            <p role="alert" className="mb-2 text-xs text-danger">
              {loadOlderError}
            </p>
          ) : null}
          {hasMore ? (
            <Button variant="ghost" size="sm" onClick={loadOlder} loading={loadingOlder}>
              {t("loadEarlier")}
            </Button>
          ) : messages.length > 0 ? (
            <p className="text-xs text-fg-subtle">{t("startOfConversation")}</p>
          ) : null}
        </div>

        {messages.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-fg-muted">
            {t("noMessagesYet")}
          </p>
        ) : (
          dayGroups.map((group) => (
            <div key={group.key}>
              <DaySeparator label={group.label} />
              {group.messages.map((message, index) => {
                const previous = index === 0 ? null : group.messages[index - 1];
                const isSelf = message.senderId === viewerId;
                const showReadReceipt =
                  isSelf && lastMessage !== null && message.id === lastMessage.id
                    ? otherLastReadAt !== null && otherLastReadAt >= message.createdAt
                    : false;
                return (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isSelf={isSelf}
                    otherProfile={otherProfile}
                    grouped={shouldGroupWithPrevious(message, previous)}
                    showReadReceipt={showReadReceipt}
                    onReport={setReportingMessageId}
                  />
                );
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <Composer
        conversationId={conversationId}
        disabled={isBlocked}
        disabledReason={tBlocked("cantReply")}
        onMessageSent={(message) => {
          appendOptimistic(message);
          bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        }}
      />

      <ReportMessageSheet
        open={reportingMessageId !== null}
        onClose={() => setReportingMessageId(null)}
        messageId={reportingMessageId}
      />
    </div>
  );
}

/** Decorative loading placeholder, exported for the page-level Suspense boundary if one is added later. */
export function ThreadViewSkeleton() {
  const t = useTranslations("ThreadView");

  return (
    <div className="flex h-[60dvh] items-center justify-center">
      <Spinner label={t("loadingConversation")} />
    </div>
  );
}
