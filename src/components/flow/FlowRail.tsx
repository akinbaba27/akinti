"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Bookmark, Handshake, MessageSquare, RotateCcw, Share2, Waves } from "@/components/ui/icons";
import { cn, formatCount } from "@/lib/ui";

export interface FlowRailProps {
  isSaved: boolean;
  saveCount: number;
  /** Echo (`docs/ECHOES.md`) — the thumb-zone rail is where FLOW.md puts every reaction. */
  isEchoed: boolean;
  echoCount: number;
  commentCount: number;
  shareCount: number;
  duetCount: number;
  canRequestDuet: boolean;
  /** The creator invites collaboration — the one place besides live audio Signal is allowed (COLOR_V2 principle 2). */
  openForDuet: boolean;
  onReplay: () => void;
  onEcho: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
  onDuet: () => void;
}

interface RailKeyProps {
  label: string;
  icon: ReactNode;
  count?: number;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  hero?: boolean;
  toneClassName?: string;
}

function RailKey({ label, icon, count, onClick, pressed, disabled, hero, toneClassName }: RailKeyProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "akinti-press flex flex-col items-center gap-1 disabled:cursor-not-allowed disabled:opacity-55",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full",
          hero ? "size-14 bg-tide text-on-ink" : "size-11 text-ink",
          toneClassName,
        )}
      >
        {icon}
      </span>
      {count !== undefined && count > 0 ? (
        <span className="type-mono-sm text-ink-subtle">{formatCount(count)}</span>
      ) : null}
    </button>
  );
}

/**
 * The right rail (`docs/FLOW.md`): thumb-zone, largest targets, Duet as the
 * hero action. No Likes — Replay, Save, Comment, Share, Duet, exactly the
 * five reactions the product has.
 */
export function FlowRail({
  isSaved,
  isEchoed,
  echoCount,
  saveCount,
  commentCount,
  shareCount,
  duetCount,
  canRequestDuet,
  openForDuet,
  onReplay,
  onEcho,
  onSave,
  onComment,
  onShare,
  onDuet,
}: FlowRailProps) {
  const tTerms = useTranslations("Terms");
  return (
    <div className="flex flex-col items-center gap-4">
      <RailKey label={tTerms("replay")} icon={<RotateCcw className="size-6" />} onClick={onReplay} />
      <RailKey
        label={isEchoed ? tTerms("unecho") : tTerms("echo")}
        icon={<Waves className="size-6" weight={isEchoed ? "fill" : "regular"} />}
        count={echoCount}
        pressed={isEchoed}
        onClick={onEcho}
        toneClassName={isEchoed ? "text-ink" : undefined}
      />
      <RailKey
        label={isSaved ? tTerms("saved") : tTerms("save")}
        icon={<Bookmark className="size-6" weight={isSaved ? "fill" : "regular"} />}
        count={saveCount}
        pressed={isSaved}
        onClick={onSave}
      />
      <RailKey
        label={tTerms("comment")}
        icon={<MessageSquare className="size-6" />}
        count={commentCount}
        onClick={onComment}
      />
      <RailKey label={tTerms("share")} icon={<Share2 className="size-6" />} count={shareCount} onClick={onShare} />
      <RailKey
        label={tTerms("requestDuet")}
        icon={<Handshake className="size-7" weight={openForDuet ? "fill" : "regular"} />}
        count={duetCount}
        onClick={onDuet}
        disabled={!canRequestDuet}
        hero
        toneClassName={openForDuet ? "text-signal" : undefined}
      />
    </div>
  );
}
