"use client";

import { useTranslations } from "next-intl";

import { Kbd } from "@/components/ui";
import { Bookmark, Handshake, MessageSquare, RotateCcw, Share2, Waves } from "@/components/ui/icons";
import { cn, formatCount } from "@/lib/ui";

export interface FlowActionBarProps {
  isSaved: boolean;
  saveCount: number;
  isEchoed: boolean;
  echoCount: number;
  commentCount: number;
  shareCount: number;
  duetCount: number;
  canRequestDuet: boolean;
  openForDuet: boolean;
  onReplay: () => void;
  onEcho: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
  onDuet: () => void;
}

function ActionKey({
  label,
  icon,
  count,
  onClick,
  pressed,
  disabled,
  hero,
  toneClassName,
}: {
  label: string;
  icon: React.ReactNode;
  count?: number;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  hero?: boolean;
  toneClassName?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "akinti-press group flex h-11 items-center gap-2.5 rounded-key px-4 transition-colors duration-100",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide",
        "disabled:cursor-not-allowed disabled:opacity-45",
        hero
          ? "bg-tide text-on-ink hover:bg-tide-2"
          : "bg-elevation-2 text-ink-muted hover:bg-elevation-3 hover:text-ink",
        toneClassName,
      )}
    >
      <span className="inline-flex shrink-0">{icon}</span>
      <span className="type-body-sm font-medium">{label}</span>
      {count !== undefined && count > 0 ? (
        <span className="type-mono-sm opacity-80">{formatCount(count)}</span>
      ) : null}
    </button>
  );
}

/**
 * The horizontal action bar (`DESIGN_V3_DESKTOP.md` "Flow ... creator block
 * and actions as a horizontal action bar under it"). Same five reactions as
 * `FlowRail` (no Likes) — this is a desktop-only sibling, not a variant of
 * it, so the mobile rail's gesture-tuned vertical layout stays untouched.
 * The keyboard hints double as the row's trailing element, answering
 * "clicks feel dead" for anyone who has not yet discovered the shortcuts.
 */
export function FlowActionBar({
  isSaved,
  saveCount,
  isEchoed,
  echoCount,
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
}: FlowActionBarProps) {
  const tTerms = useTranslations("Terms");
  const tFlow = useTranslations("Flow");

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 pt-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <ActionKey label={tTerms("replay")} icon={<RotateCcw className="size-5" />} onClick={onReplay} />
        <ActionKey
          label={isEchoed ? tTerms("unecho") : tTerms("echo")}
          icon={<Waves className="size-5" weight={isEchoed ? "fill" : "regular"} />}
          count={echoCount}
          pressed={isEchoed}
          onClick={onEcho}
          toneClassName={isEchoed ? "text-ink" : undefined}
        />
        <ActionKey
          label={isSaved ? tTerms("saved") : tTerms("save")}
          icon={<Bookmark className="size-5" weight={isSaved ? "fill" : "regular"} />}
          count={saveCount}
          pressed={isSaved}
          onClick={onSave}
          toneClassName={isSaved ? "text-tide" : undefined}
        />
        <ActionKey
          label={tTerms("comment")}
          icon={<MessageSquare className="size-5" />}
          count={commentCount}
          onClick={onComment}
        />
        <ActionKey label={tTerms("share")} icon={<Share2 className="size-5" />} count={shareCount} onClick={onShare} />
        <ActionKey
          label={tTerms("requestDuet")}
          icon={<Handshake className="size-5" weight={openForDuet ? "fill" : "regular"} />}
          count={duetCount}
          onClick={onDuet}
          disabled={!canRequestDuet}
          hero
        />
      </div>

      <p className="type-caption hidden items-center gap-2 text-ink-subtle lg:flex">
        <Kbd>{tFlow("kbdSpaceKey")}</Kbd>
        {tFlow("kbdPlayPause")}
        <span aria-hidden="true">·</span>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        {tFlow("kbdBrowse")}
      </p>
    </div>
  );
}
