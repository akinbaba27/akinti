"use client";

import { useLocale, useTranslations } from "next-intl";
import { MoreHorizontal } from "@/components/ui/icons";

import { formatAbsoluteTime } from "@/lib/ui";
import { formatMessageTime } from "@/lib/messages";
import { Avatar, IconButton } from "@/components/ui";
import type { Message, Profile } from "@/types/domain";

import { AudioMessageBubble } from "./AudioMessageBubble";
import { DuetRequestCard } from "./DuetRequestCard";
import { WaveShareCard } from "./WaveShareCard";

export interface MessageBubbleProps {
  message: Message;
  isSelf: boolean;
  /** The other participant — only needed to render their avatar next to their own bubbles. */
  otherProfile: Profile | null;
  /** Hide the avatar/gap for a message grouped under the previous one from the same sender. */
  grouped: boolean;
  /** Show a small "Read" line under this bubble (the viewer's own last message, once the other member has read it). */
  showReadReceipt: boolean;
  onReport: (messageId: string) => void;
}

/** Renders one message, by kind, grouped and aligned by sender (spec §22 deliverable 3). */
export function MessageBubble({
  message,
  isSelf,
  otherProfile,
  grouped,
  showReadReceipt,
  onReport,
}: MessageBubbleProps) {
  const t = useTranslations("MessageBubble");
  const locale = useLocale();
  const isCard = message.kind === "wave_share" || message.kind === "duet_request" || message.kind === "audio";
  const otherName = otherProfile ? (otherProfile.displayName ?? `@${otherProfile.username}`) : t("them");

  return (
    <div
      className={`group flex items-end gap-2 px-4 py-0.5 sm:px-5 ${isSelf ? "flex-row-reverse" : "flex-row"}`}
    >
      <div className="w-8 shrink-0">
        {!isSelf && !grouped ? (
          <Avatar name={otherName} src={otherProfile?.avatarUrl} size="sm" />
        ) : null}
      </div>

      <div className={`flex max-w-[78%] flex-col gap-1 ${isSelf ? "items-end" : "items-start"}`}>
        {isCard ? (
          <MessageCardContent message={message} />
        ) : (
          <div
            className={
              // Who said what is carried by the presence of a field, not by
              // colour (SCREENS.md §9.2): outbound is an ink field, inbound
              // is bare ink on the paper — no field, no fill, no border.
              isSelf
                ? "rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 text-sm text-on-ink"
                : "px-1 py-2 text-sm text-ink"
            }
          >
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          </div>
        )}

        <div className="flex items-center gap-1.5 px-1 text-[0.6875rem] text-fg-subtle">
          <time dateTime={message.createdAt} title={formatAbsoluteTime(message.createdAt)}>
            {formatMessageTime(message.createdAt, locale)}
          </time>
          {showReadReceipt ? <span>· {t("readReceipt")}</span> : null}
        </div>
      </div>

      {!isSelf ? (
        <IconButton
          label={t("reportMessage")}
          icon={<MoreHorizontal className="size-4" />}
          size="sm"
          className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={() => onReport(message.id)}
        />
      ) : null}
    </div>
  );
}

function MessageCardContent({ message }: { message: Message }) {
  switch (message.kind) {
    case "audio":
      return message.audioAssetId ? (
        <AudioMessageBubble messageId={message.id} audioAssetId={message.audioAssetId} />
      ) : null;
    case "wave_share":
      return message.sharedWaveId ? <WaveShareCard waveId={message.sharedWaveId} /> : null;
    case "duet_request":
      return message.duetRequestId ? <DuetRequestCard duetRequestId={message.duetRequestId} /> : null;
    default:
      return null;
  }
}
