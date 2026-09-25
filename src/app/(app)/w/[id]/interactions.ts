"use server";

/**
 * Server Actions for Stage 8 — Comments, Saves, Shares (spec §14, §25, §26,
 * §38, §39, §43). Kept in a dedicated `interactions.ts` rather than the
 * existing `actions.ts` (owner Edit/Delete, Stage 5) to avoid touching a file
 * another stage already shipped. Same contract as every other action module
 * in this codebase (`src/app/(app)/messages/actions.ts` is the closest
 * sibling): parse with Zod, never throw to the client, always return a typed
 * `{ ok, error?, message?, data? }` result — no fake success (spec §44 rule 9).
 *
 * Authorization is never re-implemented here. Every mutation still rides on
 * RLS (`comments`/`saves`/`shares` policies, migration 12) and the predicate
 * functions in migration 10 (`can_view_wave`, `can_comment_on_wave`,
 * `is_blocked_between`) — a blocked user's comments are invisible and their
 * writes are rejected at the database regardless of what this file does. The
 * pre-checks here exist only to turn a Postgres rejection into an honest,
 * specific English message instead of a raw error, and to compute a friendly
 * "why can't I comment" reason for the composer.
 */

import { revalidatePath } from "next/cache";

import { assertNotSuspended, getCurrentUser, SUSPENDED_ACTION_MESSAGE } from "@/lib/auth/server";
import { isRateLimitError, RATE_LIMIT_MESSAGE } from "@/lib/moderation/errors";
import {
  createComment as createCommentDb,
  deleteComment as deleteCommentDb,
  getCommentById,
  listCommentReplies,
  listWaveComments,
} from "@/lib/db/comments";
import { isFollowing } from "@/lib/db/follows";
import { getProfileById, getProfilesByIds } from "@/lib/db/profiles";
import { createReport } from "@/lib/db/reports";
import { saveWave as saveWaveDb, unsaveWave as unsaveWaveDb } from "@/lib/db/saves";
import { echoWave as echoWaveDb, unechoWave as unechoWaveDb } from "@/lib/db/echoes";
import { shareWave as shareWaveDb } from "@/lib/db/shares";
import { DatabaseError, ForbiddenError, NotFoundError } from "@/lib/db/types";
import { getWaveById } from "@/lib/db/waves";
import { routes } from "@/config/routes";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/common";
import { createReportSchema } from "@/lib/validation/moderation";
import { createCommentSchema, shareWaveSchema } from "@/lib/validation/waves";
import type { Comment, CommentWithAuthor, Page, ReportReason, ShareChannel } from "@/types/domain";

const NOT_CONFIGURED_ERROR =
  "This isn't connected to a backend yet — Supabase environment variables are not set.";
const SIGN_IN_ERROR = "Sign in to do that.";
const WAVE_NOT_FOUND_ERROR = "This Wave isn't available.";

export interface InteractionResult<T = undefined> {
  readonly ok: boolean;
  readonly error?: string;
  readonly message?: string;
  readonly data?: T;
}

function ok<T>(data?: T, message?: string): InteractionResult<T> {
  return { ok: true, data, message };
}

function fail<T = undefined>(error: string): InteractionResult<T> {
  return { ok: false, error };
}

/** Turn a thrown `src/lib/db` error into a message safe to show a user. Never forwards a raw Postgres error string. */
function describeError(err: unknown, fallback: string): string {
  if (isRateLimitError(err)) {
    return RATE_LIMIT_MESSAGE;
  }
  if (err instanceof NotFoundError) {
    return "That could not be found.";
  }
  if (err instanceof ForbiddenError) {
    return "You don't have permission to do that.";
  }
  if (err instanceof DatabaseError) {
    return fallback;
  }
  return fallback;
}

async function requireSignedIn(): Promise<{ id: string } | null> {
  if (!isSupabaseConfigured()) return null;
  const user = await getCurrentUser();
  return user ? { id: user.id } : null;
}

/* ------------------------------------------------------------------------ */
/* Comments                                                                  */
/* ------------------------------------------------------------------------ */

/** Attach author profiles to a page of comments, dropping any comment whose author RLS now hides (rare: a deleted/blocked account). */
async function hydrateAuthors(
  db: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  comments: Page<Comment>,
): Promise<Page<CommentWithAuthor>> {
  if (comments.items.length === 0) {
    return { items: [], nextCursor: comments.nextCursor };
  }
  const authorIds = [...new Set(comments.items.map((c) => c.authorId))];
  const authors = await getProfilesByIds(db, authorIds);
  const byId = new Map(authors.map((p) => [p.id, p]));
  const items = comments.items
    .map((comment) => {
      const author = byId.get(comment.authorId);
      return author ? { ...comment, author } : null;
    })
    .filter((c): c is CommentWithAuthor => c !== null);
  return { items, nextCursor: comments.nextCursor };
}

/** Root comments on a Wave, newest first (spec §14) — backs both the server-rendered first page and client "Load more". */
export async function loadComments(
  waveId: string,
  cursor: string | null,
): Promise<InteractionResult<Page<CommentWithAuthor>>> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const parsed = uuidSchema.safeParse(waveId);
  if (!parsed.success) return fail(WAVE_NOT_FOUND_ERROR);

  const db = await createServerSupabaseClient();
  try {
    const page = await listWaveComments(db, parsed.data, { cursor });
    return ok(await hydrateAuthors(db, page));
  } catch (err) {
    return fail(describeError(err, "Could not load comments. Try again."));
  }
}

/** One root comment's replies, oldest first — expanded on demand (spec §14 "shallow threading"). */
export async function loadReplies(
  commentId: string,
  cursor: string | null,
): Promise<InteractionResult<Page<CommentWithAuthor>>> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const parsed = uuidSchema.safeParse(commentId);
  if (!parsed.success) return fail("That comment could not be found.");

  const db = await createServerSupabaseClient();
  try {
    const page = await listCommentReplies(db, parsed.data, { cursor });
    return ok(await hydrateAuthors(db, page));
  } catch (err) {
    return fail(describeError(err, "Could not load replies. Try again."));
  }
}

export interface CommentPermissionState {
  readonly allowed: boolean;
  /** Human-readable reason the composer is disabled; `null` when `allowed` is true. */
  readonly reason: string | null;
}

/**
 * Why the composer is (or isn't) enabled for `waveId` (spec §14: "Creators
 * may have comment controls"). `can_comment_on_wave` (migration 10) is the
 * actual authority — this only explains an honest reason when it says no,
 * by re-deriving the same `comment_permission` resolution the RPC uses.
 */
export async function getCommentPermissionState(waveId: string): Promise<CommentPermissionState> {
  if (!isSupabaseConfigured()) return { allowed: false, reason: NOT_CONFIGURED_ERROR };

  const parsed = uuidSchema.safeParse(waveId);
  if (!parsed.success) return { allowed: false, reason: WAVE_NOT_FOUND_ERROR };

  const user = await getCurrentUser();
  if (!user) return { allowed: false, reason: "Sign in to comment." };

  const db = await createServerSupabaseClient();
  const wave = await getWaveById(db, parsed.data).catch(() => null);
  if (!wave) return { allowed: false, reason: WAVE_NOT_FOUND_ERROR };

  const { data: allowed } = await db.rpc("can_comment_on_wave", { p_wave_id: parsed.data });
  if (allowed) return { allowed: true, reason: null };

  const creator = await getProfileById(db, wave.creatorId).catch(() => null);
  if (!creator) return { allowed: false, reason: "You can't comment on this Wave." };

  const audience = wave.commentPermission ?? creator.permissions.comment;
  if (audience === "nobody") {
    return { allowed: false, reason: `@${creator.username} has turned off comments on this Wave.` };
  }
  if (audience === "followers") {
    const following = await isFollowing(db, user.id, creator.id).catch(() => false);
    if (!following) {
      return { allowed: false, reason: `Only followers of @${creator.username} can comment.` };
    }
  }
  return { allowed: false, reason: "You can't comment on this Wave." };
}

export interface CreateCommentArgs {
  waveId: string;
  body: string;
  parentCommentId?: string | null;
}

/** Post a comment or a reply (spec §14). One level of replies only — enforced again by the DB trigger even if this were bypassed. */
export async function createComment(
  args: CreateCommentArgs,
): Promise<InteractionResult<{ comment: CommentWithAuthor }>> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const parsed = createCommentSchema.safeParse({
    wave_id: args.waveId,
    body: args.body,
    parent_comment_id: args.parentCommentId ?? null,
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "That comment can't be posted.");
  }

  const user = await requireSignedIn();
  if (!user) return fail(SIGN_IN_ERROR);
  if (!(await assertNotSuspended(user.id))) return fail(SUSPENDED_ACTION_MESSAGE);

  const db = await createServerSupabaseClient();

  const wave = await getWaveById(db, parsed.data.wave_id).catch(() => null);
  if (!wave) return fail(WAVE_NOT_FOUND_ERROR);

  if (parsed.data.parent_comment_id) {
    const parent = await getCommentById(db, parsed.data.parent_comment_id).catch(() => null);
    if (!parent || parent.waveId !== parsed.data.wave_id) {
      return fail("That comment could not be found.");
    }
    if (parent.parentCommentId) {
      return fail("Replies can't be nested more than one level deep.");
    }
  }

  let comment;
  try {
    comment = await createCommentDb(db, user.id, parsed.data);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === "42501") {
      return fail("You can't comment on this Wave right now.");
    }
    return fail(describeError(err, "Could not post that comment. Try again."));
  }

  const author = await getProfileById(db, user.id).catch(() => null);
  if (!author) {
    return fail("Could not post that comment. Try again.");
  }

  revalidatePath(routes.wave(parsed.data.wave_id));
  return ok({ comment: { ...comment, author } });
}

/** Delete a comment the caller owns (or their own Wave's comment, per RLS) — a soft delete that preserves reply threads. */
export async function deleteComment(commentId: string): Promise<InteractionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const parsed = uuidSchema.safeParse(commentId);
  if (!parsed.success) return fail("That comment could not be found.");

  const user = await requireSignedIn();
  if (!user) return fail(SIGN_IN_ERROR);
  if (!(await assertNotSuspended(user.id))) return fail(SUSPENDED_ACTION_MESSAGE);

  const db = await createServerSupabaseClient();
  const comment = await getCommentById(db, parsed.data).catch(() => null);
  if (!comment) return fail("That comment could not be found.");

  const wave = await getWaveById(db, comment.waveId).catch(() => null);
  const isAuthor = comment.authorId === user.id;
  const isWaveCreator = wave?.creatorId === user.id;
  if (!isAuthor && !isWaveCreator) {
    return fail("You don't have permission to delete that comment.");
  }

  try {
    await deleteCommentDb(db, parsed.data);
  } catch (err) {
    return fail(describeError(err, "Could not delete that comment. Try again."));
  }

  revalidatePath(routes.wave(comment.waveId));
  return ok();
}

/** Report a comment (spec §26) — files an open queue entry, never auto-actioned. */
export async function reportComment(
  commentId: string,
  reason: ReportReason,
  details: string | null = null,
): Promise<InteractionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const parsed = createReportSchema.safeParse({
    target_type: "comment",
    target_comment_id: commentId,
    reason,
    details,
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Could not submit your report.");
  }

  const user = await requireSignedIn();
  if (!user) return fail(SIGN_IN_ERROR);
  if (!(await assertNotSuspended(user.id))) return fail(SUSPENDED_ACTION_MESSAGE);

  const db = await createServerSupabaseClient();
  try {
    await createReport(db, user.id, parsed.data);
    return ok(undefined, "Report submitted. Our team will review it.");
  } catch (err) {
    if (isRateLimitError(err)) {
      return fail(RATE_LIMIT_MESSAGE);
    }
    if (err instanceof DatabaseError && err.code === "23505") {
      return fail("You've already reported this comment.");
    }
    return fail("Could not submit your report. Try again.");
  }
}

/* ------------------------------------------------------------------------ */
/* Saves                                                                     */
/* ------------------------------------------------------------------------ */

/** Save a Wave (spec §14, §25). Idempotent — saving twice is a no-op, matching the upsert in `saves.ts`. */
export async function saveWave(waveId: string): Promise<InteractionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const parsed = uuidSchema.safeParse(waveId);
  if (!parsed.success) return fail(WAVE_NOT_FOUND_ERROR);

  const user = await requireSignedIn();
  if (!user) return fail(SIGN_IN_ERROR);
  if (!(await assertNotSuspended(user.id))) return fail(SUSPENDED_ACTION_MESSAGE);

  const db = await createServerSupabaseClient();
  try {
    await saveWaveDb(db, user.id, parsed.data);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === "42501") {
      return fail(WAVE_NOT_FOUND_ERROR);
    }
    return fail(describeError(err, "Could not save this Wave. Try again."));
  }

  revalidatePath(routes.wave(parsed.data));
  return ok();
}

export async function unsaveWave(waveId: string): Promise<InteractionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const parsed = uuidSchema.safeParse(waveId);
  if (!parsed.success) return fail(WAVE_NOT_FOUND_ERROR);

  const user = await requireSignedIn();
  if (!user) return fail(SIGN_IN_ERROR);
  if (!(await assertNotSuspended(user.id))) return fail(SUSPENDED_ACTION_MESSAGE);

  const db = await createServerSupabaseClient();
  try {
    await unsaveWaveDb(db, user.id, parsed.data);
  } catch (err) {
    return fail(describeError(err, "Could not unsave this Wave. Try again."));
  }

  revalidatePath(routes.wave(parsed.data));
  return ok();
}

/* ------------------------------------------------------------------------ */
/* Echoes (Wave E, docs/ECHOES.md)                                          */
/* ------------------------------------------------------------------------ */

/** Echo a Wave — a lightweight, visible appreciation signal. Idempotent, matching the upsert in `echoes.ts`; same shape as `saveWave` above. */
export async function echoWave(waveId: string): Promise<InteractionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const parsed = uuidSchema.safeParse(waveId);
  if (!parsed.success) return fail(WAVE_NOT_FOUND_ERROR);

  const user = await requireSignedIn();
  if (!user) return fail(SIGN_IN_ERROR);
  if (!(await assertNotSuspended(user.id))) return fail(SUSPENDED_ACTION_MESSAGE);

  const db = await createServerSupabaseClient();
  try {
    await echoWaveDb(db, user.id, parsed.data);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === "42501") {
      return fail(WAVE_NOT_FOUND_ERROR);
    }
    return fail(describeError(err, "Could not echo this Wave. Try again."));
  }

  revalidatePath(routes.wave(parsed.data));
  return ok();
}

export async function unechoWave(waveId: string): Promise<InteractionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const parsed = uuidSchema.safeParse(waveId);
  if (!parsed.success) return fail(WAVE_NOT_FOUND_ERROR);

  const user = await requireSignedIn();
  if (!user) return fail(SIGN_IN_ERROR);
  if (!(await assertNotSuspended(user.id))) return fail(SUSPENDED_ACTION_MESSAGE);

  const db = await createServerSupabaseClient();
  try {
    await unechoWaveDb(db, user.id, parsed.data);
  } catch (err) {
    return fail(describeError(err, "Could not remove your Echo. Try again."));
  }

  revalidatePath(routes.wave(parsed.data));
  return ok();
}

/* ------------------------------------------------------------------------ */
/* Shares                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Record a share event (spec §14). This never widens visibility — the link
 * itself is just `routes.wave(waveId)`, resolved through `can_view_wave()`/
 * RLS like any other read, both here (`shareWave`'s `can_view_wave` guard on
 * `shares_insert_own`) and again whenever the link is opened.
 *
 * For the "message" channel, prefer `shareWaveToConversation`
 * (`src/app/(app)/messages/actions.ts`) instead — it both sends the
 * `wave_share` message AND records the `shares` row in one step. This action
 * covers the "link" and "native" channels, and remains available for
 * "message" as a fallback record-only path.
 */
export async function recordShare(
  waveId: string,
  channel: ShareChannel,
  conversationId: string | null = null,
): Promise<InteractionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const parsed = shareWaveSchema.safeParse({ waveId, channel, conversationId });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "That Wave can't be shared.");
  }

  const user = await requireSignedIn();
  if (!user) return fail(SIGN_IN_ERROR);
  if (!(await assertNotSuspended(user.id))) return fail(SUSPENDED_ACTION_MESSAGE);

  const db = await createServerSupabaseClient();
  try {
    await shareWaveDb(db, user.id, parsed.data);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === "42501") {
      return fail(WAVE_NOT_FOUND_ERROR);
    }
    return fail(describeError(err, "Could not record that share. Try again."));
  }

  return ok();
}
