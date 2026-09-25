/**
 * Application-level domain types for AKINTI.
 *
 * `database.ts` describes the wire format Postgres speaks. This file describes
 * the objects the rest of the app thinks in. UI and feature code should import
 * from here; only `src/lib/db/**` should need `database.ts` directly.
 *
 * Product vocabulary is fixed (spec s4): Wave, Play, Replay, Comment, Save,
 * Share, Duet, Duet Request, Creator, Collaborators, Recorded, Uploaded.
 * There is no Like anywhere in this file, and there must never be.
 */

import type {
  AudioEnhancementPreset,
  AudioJobStatus,
  AudioJobType,
  AudioProcessingStatus,
  BackingTrackLicense,
  ChallengeStatus,
  CollaboratorStatus,
  CommentAudience,
  ContentOrigin,
  ConversationKind,
  DuetMode,
  DuetRequestStatus,
  FollowStatus,
  Json,
  MessageKind,
  ModerationActionType,
  NotificationCategory,
  NotificationPreferences,
  NotificationType,
  PermissionAudience,
  ProfilePrivacy,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  ShareChannel,
  SignatureHue,
  WaveCreationType,
  WaveVisibility,
} from "./database";

export type {
  AudioEnhancementPreset,
  AudioJobStatus,
  AudioJobType,
  AudioProcessingStatus,
  BackingTrackLicense,
  ChallengeStatus,
  CollaboratorStatus,
  CommentAudience,
  ContentOrigin,
  ConversationKind,
  DuetMode,
  DuetRequestStatus,
  FollowStatus,
  Json,
  MessageKind,
  ModerationActionType,
  NotificationCategory,
  NotificationPreferences,
  NotificationType,
  PermissionAudience,
  ProfilePrivacy,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  ShareChannel,
  SignatureHue,
  WaveCreationType,
  WaveVisibility,
};

/** Runtime lists — useful for `<select>` options and for Zod enums. */
export const PROFILE_PRIVACIES = ["public", "private"] as const;
export const PERMISSION_AUDIENCES = ["everyone", "followers", "following", "nobody"] as const;
export const COMMENT_AUDIENCES = ["everyone", "followers", "nobody"] as const;
export const WAVE_VISIBILITIES = ["everyone", "followers", "only_me"] as const;
export const WAVE_CREATION_TYPES = ["recorded", "uploaded", "duet"] as const;
/** Wave D. `layer` is the original simultaneous mix. */
export const DUET_MODES = ["layer", "atisma", "cypher"] as const;
export const BACKING_TRACK_LICENSES = ["cc0", "cc_by", "owner_upload"] as const;
/** Prompts & challenges (PRODUCT_V2 §4). `draft` is moderator/author-only. */
export const CHALLENGE_STATUSES = ["draft", "live", "closed"] as const;
export const CONTENT_ORIGINS = ["original", "cover", "licensed", "unknown"] as const;
/**
 * Signature hue presets (`docs/design/COLOR_V2.md` "Colour by mode and
 * genre" / "Profile signature trace"): a curated set of four fixed hues
 * already used elsewhere in the colour system, never an open colour field.
 * Drives the profile signature trace and, where set, the creator's WaveCard
 * hue (`src/app/(app)/u/[username]/page.tsx`). Replaces the former
 * background/gradient/pattern/accent preset system (QA `full2` defect #1),
 * which violated COLOR_V2 (violet/plum/gradients) and had no visible effect
 * anywhere.
 */
export const SIGNATURE_HUES = [
  "current",
  "genre-turku",
  "genre-rap",
  "genre-arabesk",
] as const satisfies readonly SignatureHue[];
export const AUDIO_ENHANCEMENT_PRESETS = [
  "natural",
  "studio",
  "clear_voice",
  "warm",
  "deep",
  "atmospheric",
] as const;
export const SHARE_CHANNELS = ["link", "message", "native"] as const;
export const REPORT_REASONS = [
  "spam",
  "harassment",
  "impersonation",
  "copyright",
  "inappropriate",
  "abusive",
  "other",
] as const;
export const REPORT_TARGET_TYPES = ["wave", "comment", "profile", "message"] as const;
export const REPORT_STATUSES = ["open", "reviewing", "actioned", "dismissed"] as const;
export const MODERATION_ACTION_TYPES = [
  "none",
  "hide_wave",
  "hide_comment",
  "warn_user",
  "suspend_user",
] as const;
/** Order matches spec §25's own list ("message, Duet, comment, follower notifications"), `system` appended for the generic type. */
export const NOTIFICATION_CATEGORIES = ["message", "duet", "comment", "follower", "system"] as const;

/* ------------------------------------------------------------------------ */
/* Profile                                                                   */
/* ------------------------------------------------------------------------ */

export interface ProfilePermissions {
  duet: PermissionAudience;
  message: PermissionAudience;
  comment: CommentAudience;
  defaultWaveVisibility: WaveVisibility;
}

export interface ProfileCounts {
  followers: number;
  following: number;
  waves: number;
}

export interface Profile {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  privacy: ProfilePrivacy;
  /** The user's chosen signature hue (`null` = no explicit choice; draws the
   *  plain current, or falls back to a tag-derived genre hue where one
   *  applies). See `SIGNATURE_HUES` above. */
  signatureHue: SignatureHue | null;
  permissions: ProfilePermissions;
  interests: string[];
  onboardedAt: string | null;
  /** Spec §23/§25. A missing key means "on". */
  notificationPreferences: NotificationPreferences;
  /** Grants access to `/moderation` — see `src/lib/auth/server.ts`. */
  isModerator: boolean;
  /** Set only by `resolve_report(..., 'suspend_user')`. `null` or a past timestamp means not suspended. */
  suspendedUntil: string | null;
  /** User-chosen UI locale. `null` means no explicit preference — see `src/i18n/locale.ts`. */
  locale: "tr" | "en" | null;
  counts: ProfileCounts;
  createdAt: string;
}

/** What the viewer may do with a profile, resolved server-side. */
export interface ProfileViewerState {
  isSelf: boolean;
  followStatus: FollowStatus | null;
  followsViewer: boolean;
  isBlockedByViewer: boolean;
  canViewContent: boolean;
  canMessage: boolean;
}

/* ------------------------------------------------------------------------ */
/* Audio                                                                     */
/* ------------------------------------------------------------------------ */

/** Compact waveform peaks produced once by the worker and cached forever. */
export interface WaveformPeaks {
  version: number;
  bits: number;
  samplesPerPixel: number;
  /** Normalised 0..(2^bits - 1) amplitude buckets. */
  data: number[];
}

export interface AudioAsset {
  id: string;
  ownerId: string;
  /**
   * Storage key inside the PRIVATE `audio` bucket. Never render this.
   *
   * Column-level SELECT on this (and `processedPath`) is revoked from
   * anon/authenticated (migration 15, spec §33) — `getAudioAssetById` and
   * every other non-privileged read in `src/lib/db/audioAssets.ts` always
   * returns `""` here. A real value only ever comes from
   * `mintSignedAudioUrl`/`mintPlaybackUrl`, which resolve it server-side with
   * the service-role client after `can_view_audio_asset()` has authorised
   * the caller — see "Storage security" in docs/AUDIO_ARCHITECTURE.md.
   */
  originalPath: string;
  /** Same redaction as `originalPath` above; `null` here never means "no processed file yet" outside a privileged read. */
  processedPath: string | null;
  durationMs: number | null;
  mimeType: string;
  byteSize: number;
  sampleRate: number | null;
  channels: number | null;
  peaks: WaveformPeaks | null;
  processingStatus: AudioProcessingStatus;
  processingError: string | null;
  enhancementPreset: AudioEnhancementPreset;
  /** Which pipeline stages actually ran and what they measured — see docs/AUDIO_ARCHITECTURE.md "Enhancement report". `null` until `process_audio`/`mix_duet` completes. */
  enhancementReport: EnhancementReport | null;
  createdAt: string;
  processedAt: string | null;
}

/** One measured pipeline stage in `AudioAsset.enhancementReport` (spec: never a faked/placeholder measurement). */
export interface EnhancementReportStage {
  method: string;
  lufsBefore?: number | null;
  lufsAfter?: number | null;
  durationMs?: number;
  [key: string]: unknown;
}

/** Shape written by `scripts/worker.ts`'s `runProcessAudioJob`/`runMixDuetJob` onto `complete_audio_job`'s `p_enhancement_report`. A stage that did not run is simply absent. */
export interface EnhancementReport {
  clean?: EnhancementReportStage;
  master?: EnhancementReportStage;
  peaks?: EnhancementReportStage;
  [key: string]: EnhancementReportStage | undefined;
}

/** An asset plus the short-lived signed URL a browser may actually fetch. */
export interface PlayableAudio extends AudioAsset {
  signedUrl: string;
  signedUrlExpiresAt: string;
}

export interface AudioProcessingJob {
  id: number;
  audioAssetId: string;
  jobType: AudioJobType;
  status: AudioJobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  payload: Json;
  result: Json | null;
  runAfter: string;
  createdAt: string;
  finishedAt: string | null;
}

/* ------------------------------------------------------------------------ */
/* Wave                                                                      */
/* ------------------------------------------------------------------------ */

export interface WaveCounts {
  plays: number;
  replays: number;
  comments: number;
  saves: number;
  shares: number;
  duets: number;
  /** Echoes (Wave E, 2026-09-18, `docs/ECHOES.md`) — a lightweight, visible appreciation signal. Distinct from `MetricKey`/`METRICS`: Echo is never folded into the generic plays/replays/... metrics sentence, it gets its own button and its own count (see `WaveCardWave.echoCount`). */
  echoes: number;
}

/** One turn of a call-and-response (`atisma`) Duet — see `Wave.duet.segments`. Mirrors `DuetSegment` in `src/lib/duet/ffmpegChain.ts` (structurally identical, declared separately so `types/**` has no dependency on `lib/**`). */
export type DuetSegmentSource = "original" | "contribution";
export interface DuetSegment {
  source: DuetSegmentSource;
  startMs: number;
  endMs: number;
}

export interface WaveDuetLineage {
  /** Root of the Duet chain; null on an original Wave. */
  originalWaveId: string | null;
  /** Immediate parent; null on an original Wave. */
  parentWaveId: string | null;
  duetRequestId: string | null;
  depth: number;
  /** Wave D. `null` for a non-duet Wave; `'layer'` for every duet Wave published before this stage. */
  mode: DuetMode | null;
  /** Wave D, `mode: 'atisma'` only. */
  segments: DuetSegment[] | null;
  /** Wave D, `mode: 'cypher'` only — 1-based position, capped at 4. */
  cypherOrder: number | null;
}

export interface Wave {
  id: string;
  creatorId: string;
  audioAssetId: string;
  title: string;
  description: string | null;
  creationType: WaveCreationType;
  visibility: WaveVisibility;
  /** `null` means "inherit the creator's profile setting". */
  commentPermission: CommentAudience | null;
  duetPermission: PermissionAudience | null;
  duet: WaveDuetLineage;
  /** Set when this Wave is a vocal recorded over a backing track (spec §4) — mutually exclusive with `duet.parentWaveId`. */
  backingTrackId: string | null;
  contentOrigin: ContentOrigin;
  tags: string[];
  counts: WaveCounts;
  publishedAt: string;
  updatedAt: string;
  /** Set only by `resolve_report(..., 'hide_wave')` (spec §26). Distinct from a soft delete — the creator still sees it, everyone else does not. */
  hiddenAt: string | null;
}

/**
 * Curated (seeded, `uploaderId: null`) or user-uploaded ("open for vocals")
 * instrumental — spec §4 "Backing tracks without licensing risk". Singing
 * over one publishes a Wave with `backingTrackId` set (`publishWave`,
 * `src/app/(app)/create/actions.ts`); the worker mixes the vocal over the
 * track using the same `mix_duet` ffmpeg chain as an ordinary Duet, with the
 * track as the (gain-reduced) reference stem.
 */
export interface BackingTrack {
  id: string;
  /** `null` for a curated/seeded track. */
  uploaderId: string | null;
  title: string;
  artistCredit: string;
  license: BackingTrackLicense;
  /** Required when `license === 'cc_by'` (attribution must link back to the source). */
  sourceUrl: string | null;
  audioAssetId: string;
  bpm: number | null;
  musicalKey: string | null;
  genreTags: string[];
  durationMs: number | null;
  isCurated: boolean;
  openForVocals: boolean;
  createdAt: string;
}

/**
 * A weekly theme (PRODUCT_V2 §4 "Prompts & challenges"): a title/brief,
 * optionally paired with a backing track and a recommended Duet mode (e.g. an
 * "Atışma call"), tagged with a hashtag that doubles as its discovery page
 * (`list_waves_by_hashtag`, migration 20260905130000 — reuses `Wave.tags`,
 * no separate tagging mechanism). `status` gates visibility: `draft` is
 * moderator/author-only, `live`/`closed` are public.
 */
export interface Challenge {
  id: string;
  slug: string;
  /** English (default/fallback). Use `localizeChallenge` (`@/lib/db/challenges`) to render by request locale. */
  title: string;
  brief: string;
  /** Turkish title, or `null` to fall back to `title`. */
  titleTr: string | null;
  /** Turkish brief, or `null` to fall back to `brief`. */
  briefTr: string | null;
  /** Stored without a leading '#'. */
  hashtag: string;
  startsAt: string;
  endsAt: string;
  backingTrackId: string | null;
  /** Informational only — never enforced against a submitted entry. */
  duetMode: DuetMode | null;
  status: ChallengeStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One Wave entered into a `Challenge` (`enterChallenge`, `src/lib/db/challenges.ts`). */
export interface ChallengeEntry {
  id: string;
  challengeId: string;
  waveId: string;
  userId: string;
  createdAt: string;
}

/** The curated Top 5 for a challenge — an editorial ranking, never a public leaderboard (no gamification, spec §12 rule 35). */
export interface ChallengePick {
  id: string;
  challengeId: string;
  waveId: string;
  /** 1..5 */
  rank: number;
  pickedBy: string | null;
  note: string | null;
  createdAt: string;
}

export interface Collaborator {
  id: string;
  waveId: string;
  profileId: string;
  invitedBy: string | null;
  status: CollaboratorStatus;
  role: string | null;
  createdAt: string;
  respondedAt: string | null;
}

/** A Wave hydrated for rendering: creator, audio and viewer-specific state. */
export interface WaveWithContext {
  wave: Wave;
  creator: Profile;
  audio: AudioAsset;
  collaborators: Collaborator[];
  viewer: {
    isCreator: boolean;
    hasSaved: boolean;
    canComment: boolean;
    canRequestDuet: boolean;
  };
}

/* ------------------------------------------------------------------------ */
/* Comments                                                                  */
/* ------------------------------------------------------------------------ */

export interface Comment {
  id: string;
  waveId: string;
  authorId: string;
  parentCommentId: string | null;
  body: string;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommentWithAuthor extends Comment {
  author: Profile;
}

export interface Share {
  id: string;
  waveId: string;
  sharerId: string;
  channel: ShareChannel;
  conversationId: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------------ */
/* Playback metrics                                                          */
/* ------------------------------------------------------------------------ */

/** What the client reports. The server decides what it means. */
export interface PlaybackReport {
  waveId: string;
  sessionId: string;
  listenedMs: number;
  durationMs?: number;
  completed?: boolean;
}

/** What the server decided. */
export interface PlaybackOutcome {
  ignored: boolean;
  countedPlay: boolean;
  countedReplay: boolean;
  thresholdMs?: number;
}

export interface WaveListen {
  waveId: string;
  listenerKey: string;
  listenerId: string | null;
  playCounted: boolean;
  replayCounted: boolean;
  listenCount: number;
  completedCount: number;
  totalListenedMs: number;
  firstPlayedAt: string;
  lastPlayedAt: string;
}

/* ------------------------------------------------------------------------ */
/* Duets                                                                     */
/* ------------------------------------------------------------------------ */

export interface DuetRequest {
  id: string;
  waveId: string;
  requesterId: string;
  recipientId: string;
  message: string | null;
  status: DuetRequestStatus;
  expiresAt: string;
  resultingWaveId: string | null;
  createdAt: string;
  respondedAt: string | null;
}

/** One node of the Duet tree (spec s15). */
export interface DuetTreeNode {
  wave: Wave;
  creator: Profile;
  children: DuetTreeNode[];
}

/**
 * Wave D — a creator's own Wave marked "open for anyone to Duet"
 * (docs/PRODUCT_V2.md §3-4). `answerOpenCall()` skips the request/accept
 * round trip and creates an already-accepted `DuetRequest` directly.
 */
export interface OpenCall {
  id: string;
  waveId: string;
  creatorId: string;
  prompt: string | null;
  deadlineAt: string | null;
  isOpen: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/* ------------------------------------------------------------------------ */
/* Messaging                                                                 */
/* ------------------------------------------------------------------------ */

export interface Conversation {
  id: string;
  kind: ConversationKind;
  createdBy: string | null;
  title: string | null;
  lastMessageAt: string;
  createdAt: string;
}

export interface ConversationMember {
  conversationId: string;
  profileId: string;
  joinedAt: string;
  lastReadAt: string | null;
  muted: boolean;
}

export interface ConversationSummary {
  conversation: Conversation;
  members: Profile[];
  lastMessage: Message | null;
  unreadCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  body: string | null;
  audioAssetId: string | null;
  sharedWaveId: string | null;
  duetRequestId: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------------ */
/* Notifications / moderation                                                */
/* ------------------------------------------------------------------------ */

export interface Notification {
  id: string;
  recipientId: string;
  type: NotificationType;
  actorId: string | null;
  waveId: string | null;
  commentId: string | null;
  duetRequestId: string | null;
  conversationId: string | null;
  messageId: string | null;
  /** Collapse key, e.g. `save:<waveId>`. */
  groupKey: string;
  /** Number of grouped events, >= 1. "Maria and 2 others saved your Wave". */
  count: number;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationWithActor extends Notification {
  actor: Profile | null;
}

export interface Report {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetWaveId: string | null;
  targetCommentId: string | null;
  targetProfileId: string | null;
  targetMessageId: string | null;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
  reviewedAt: string | null;
}

/** Audit trail entry for a single `resolve_report`/`dismiss_report` call (spec §26). */
export interface ModerationAction {
  id: string;
  reportId: string;
  moderatorId: string;
  action: ModerationActionType;
  note: string | null;
  createdAt: string;
}

export interface Block {
  blockerId: string;
  blockedId: string;
  createdAt: string;
}

/* ------------------------------------------------------------------------ */
/* Creator analytics + product health (spec §27, §28)                       */
/* ------------------------------------------------------------------------ */

/** The only windows the analytics RPCs accept (mirrors the SQL `p_days not in (7, 30, 90)` guard). */
export const ANALYTICS_RANGE_DAYS = [7, 30, 90] as const;
export type AnalyticsRangeDays = (typeof ANALYTICS_RANGE_DAYS)[number];

/**
 * Totals for one creator over a window. `plays`/`uniqueListeners`/`replays`
 * are deduplicated (spec §27 "distinguish raw events from meaningful/
 * deduplicated metrics"); `avgListenSeconds`/`completionRate` read the raw
 * per-event log instead (see docs/PRODUCT.md). `followerDelta` is new
 * followers gained in the window, not a true net (no unfollow ledger
 * exists to subtract against — documented limitation).
 */
export interface CreatorAnalyticsOverview {
  plays: number;
  uniqueListeners: number;
  replays: number;
  saves: number;
  shares: number;
  comments: number;
  duets: number;
  /** `null` when there were no qualifying listens to average. */
  avgListenSeconds: number | null;
  /** 0–1. */
  completionRate: number;
  followerDelta: number;
}

/** One day of activity. Only days with at least one event come back from the RPC — see `fillAnalyticsTimeseriesGaps`. */
export interface CreatorAnalyticsDay {
  /** `YYYY-MM-DD`. */
  day: string;
  plays: number;
  uniqueListeners: number;
  replays: number;
  saves: number;
  comments: number;
  shares: number;
  newFollowers: number;
}

/** One Wave's performance row, ranked by plays. */
export interface CreatorWavePerformance {
  waveId: string;
  title: string;
  creationType: WaveCreationType;
  publishedAt: string;
  plays: number;
  replays: number;
  saves: number;
  comments: number;
  shares: number;
  /** 0–1. */
  completionRate: number;
}

/** Platform-wide product health signals (spec §28), moderator-only. Every `*Rate`/`*Share` is 0–1. */
export interface ProductHealth {
  activationRate: number;
  week1ReturningListenerRate: number;
  week4ReturningListenerRate: number;
  week1ReturningCreatorRate: number;
  week4ReturningCreatorRate: number;
  duetRequestsPerActiveUser: number;
  duetAcceptanceRate: number;
  duetsPerWeek: number;
  discoveryShare: number;
  contentVelocity: number;
}

/* ------------------------------------------------------------------------ */
/* Pagination                                                                */
/* ------------------------------------------------------------------------ */

export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page, or null when the list is exhausted. */
  nextCursor: string | null;
}

export interface CursorPageParams {
  limit?: number;
  cursor?: string | null;
}
