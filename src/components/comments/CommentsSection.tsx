"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { loadComments, type CommentPermissionState } from "@/app/(app)/w/[id]/interactions";
import { useToast } from "@/components/ui";
import { useCurrentUser } from "@/lib/auth";
import { mergeCommentPage, prependComment, removeComment } from "@/lib/interactions";
import type { CommentWithAuthor, Page } from "@/types/domain";

import { CommentComposer } from "./CommentComposer";
import { CommentItem } from "./CommentItem";

/**
 * Code-split, matching `WaveDetail.tsx`'s own `ShareSheet` import: reporting
 * a comment is a rare interaction (moderation, spec §26), so the sheet and
 * its report-reason form are fetched only once one is actually requested
 * rather than shipped with every Wave page's first load — closeout perf
 * pass, `/w/[id]` was over its 340KB budget.
 */
const ReportCommentSheet = dynamic(() =>
  import("./ReportCommentSheet").then((mod) => mod.ReportCommentSheet),
);

export interface CommentsSectionProps {
  waveId: string;
  waveCreatorId: string;
  initialComments: Page<CommentWithAuthor>;
  initialPermission: CommentPermissionState;
  initialCommentCount: number;
}

/**
 * Comments on a Wave (SCREENS.md §5).
 *
 * The composer sits first and the list follows, hung on the rail. An empty
 * comment list is the composer and nothing else: it does not need to announce
 * itself (§8.14).
 */
export function CommentsSection({
  waveId,
  waveCreatorId,
  initialComments,
  initialPermission,
  initialCommentCount,
}: CommentsSectionProps) {
  const t = useTranslations("CommentsSection");
  const tTerms = useTranslations("Terms");
  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [comments, setComments] = useState<CommentWithAuthor[]>(initialComments.items);
  const [cursor, setCursor] = useState<string | null>(initialComments.nextCursor);
  const [count, setCount] = useState(initialCommentCount);
  const [isLoadingMore, startLoadingMore] = useTransition();
  const [reportTarget, setReportTarget] = useState<string | null>(null);

  // A signed-out visitor always sees the "sign in" reason; a signed-in
  // reader's eligibility is resolved on the server once, since it depends on
  // both this Wave's comment permission and the current follow graph.
  const permission = initialPermission;

  const handleLoadMore = () => {
    if (!cursor) return;
    startLoadingMore(async () => {
      const result = await loadComments(waveId, cursor);
      if (!result.ok || !result.data) {
        toast({ title: result.error ?? t("moreCommentsError"), tone: "error" });
        return;
      }
      setComments((current) => mergeCommentPage(current, result.data!.items));
      setCursor(result.data.nextCursor);
    });
  };

  return (
    <section id="comments" className="scroll-mt-20 flex flex-col pt-8">
      <h2 className="akinti-page type-caption-strong pb-4 text-ink-muted">
        {tTerms("comments")}
        {count > 0 ? (
          <>
            {" ("}
            <span className="type-mono-sm">{count}</span>
            {")"}
          </>
        ) : null}
      </h2>

      {/* Sticky at >= 1024px (DESIGN_V3_DESKTOP.md Wave page: "the composer
          sticky") — below the desktop top bar, so a long comment thread can
          be scrolled without losing the reply box. Unchanged below that
          width. */}
      <div className="akinti-page lg:sticky lg:top-top-bar lg:z-10 lg:bg-paper lg:py-3">
        <CommentComposer
          waveId={waveId}
          allowStructured
          disabledReason={permission.allowed ? null : permission.reason}
          onPosted={(comment) => {
            setComments((current) => prependComment(current, comment));
            setCount((current) => current + 1);
          }}
        />
      </div>

      {comments.length > 0 ? (
        <div className="akinti-page mt-4 flex flex-col divide-y divide-hairline border-t border-hairline">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              waveId={waveId}
              waveCreatorId={waveCreatorId}
              currentUserId={user?.id ?? null}
              onDeleted={(id) => {
                setComments((current) => removeComment(current, id));
                setCount((current) => Math.max(0, current - 1));
              }}
              onReportRequested={setReportTarget}
            />
          ))}
        </div>
      ) : null}

      {cursor ? (
        <div className="akinti-page pt-4">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            className="akinti-press inline-flex h-11 items-center rounded-key border border-hairline-strong px-4 type-subhead text-ink transition-colors hover:bg-paper-sunk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-55"
          >
            {isLoadingMore ? t("loadingComments") : t("showMoreComments")}
          </button>
        </div>
      ) : null}

      <ReportCommentSheet
        open={reportTarget !== null}
        onClose={() => setReportTarget(null)}
        commentId={reportTarget}
      />
    </section>
  );
}
