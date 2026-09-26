"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { loadComments } from "@/app/(app)/w/[id]/interactions";
import { Avatar } from "@/components/ui";
import { formatCount } from "@/lib/ui";
import type { CommentWithAuthor } from "@/types/domain";

export interface FlowCommentsPreviewProps {
  waveId: string;
  commentCount: number;
  onOpenAll: () => void;
}

const PREVIEW_COUNT = 2;

/**
 * The right rail's comments preview (`DESIGN_V3_DESKTOP.md` Flow: "comments
 * preview"). A quiet read-only glance at the top of the thread; the actual
 * composer and full list stay in `FlowCommentSheet`, opened by `onOpenAll`
 * (same sheet the mobile Comment key opens), so there is exactly one comment
 * posting surface for Flow rather than a second one duplicated into the
 * rail.
 */
export function FlowCommentsPreview({ waveId, commentCount, onOpenAll }: FlowCommentsPreviewProps) {
  const t = useTranslations("Flow");
  const tTerms = useTranslations("Terms");
  const [loaded, setLoaded] = useState<{ waveId: string; items: readonly CommentWithAuthor[] } | null>(null);
  const preview = loaded?.waveId === waveId ? loaded.items : null;

  useEffect(() => {
    let cancelled = false;
    void loadComments(waveId, null).then((result) => {
      if (cancelled) return;
      setLoaded({ waveId, items: result.ok && result.data ? result.data.items.slice(0, PREVIEW_COUNT) : [] });
    });
    return () => {
      cancelled = true;
    };
  }, [waveId]);

  return (
    <section aria-labelledby="flow-comments-preview" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="flow-comments-preview" className="type-caption-strong text-ink-subtle">
          {tTerms("comments")}
          {commentCount > 0 ? <span className="type-mono-sm pl-1.5 text-ink-subtle">{formatCount(commentCount)}</span> : null}
        </h2>
        {commentCount > 0 ? (
          <button
            type="button"
            onClick={onOpenAll}
            className="type-caption font-medium text-tide focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
          >
            {t("seeAll")}
          </button>
        ) : null}
      </div>

      {preview === null ? (
        <div className="flex flex-col gap-2.5" aria-hidden="true">
          <div className="h-9 rounded-key bg-elevation-2" />
          <div className="h-9 rounded-key bg-elevation-2" />
        </div>
      ) : preview.length === 0 ? (
        <button
          type="button"
          onClick={onOpenAll}
          className="akinti-press flex h-11 items-center rounded-key border border-hairline-strong px-3 type-body-sm text-ink-muted transition-colors hover:bg-elevation-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
        >
          {t("beFirstToComment")}
        </button>
      ) : (
        <ul className="flex flex-col gap-3">
          {preview.map((comment) => {
            const name = comment.author.displayName ?? comment.author.username;
            return (
              <li key={comment.id} className="flex items-start gap-2.5">
                <Avatar name={name} src={comment.author.avatarUrl} size="sm" />
                <p className="type-body-sm min-w-0 text-ink-muted">
                  <span className="font-medium text-ink">{name}</span> {comment.body}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
