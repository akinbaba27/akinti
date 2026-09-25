/**
 * Row -> domain mappers.
 *
 * The database speaks snake_case and flat columns; the app speaks camelCase and
 * grouped objects. Doing the translation in exactly one place means a column
 * rename is a one-line change, and UI code never has to know that
 * `play_count` and `replay_count` are siblings on the same row.
 */

import type {
  AudioAssetRow,
  AudioProcessingJobRow,
  BackingTrackRow,
  ChallengeEntryRow,
  ChallengePickRow,
  ChallengeRow,
  CommentRow,
  ConversationMemberRow,
  ConversationRow,
  DuetRequestRow,
  Json,
  MessageRow,
  ModerationActionRow,
  NotificationRow,
  OpenCallRow,
  ProfileRow,
  ReportRow,
  ShareRow,
  WaveCollaboratorRow,
  WaveListenRow,
  WaveRow,
} from "@/types/database";
import type {
  AudioAsset,
  AudioProcessingJob,
  BackingTrack,
  Challenge,
  ChallengeEntry,
  ChallengePick,
  Collaborator,
  Comment,
  Conversation,
  ConversationMember,
  DuetRequest,
  DuetSegment,
  EnhancementReport,
  Message,
  ModerationAction,
  Notification,
  OpenCall,
  PlaybackOutcome,
  Profile,
  Report,
  Share,
  Wave,
  WaveListen,
  WaveformPeaks,
} from "@/types/domain";

export function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    privacy: row.privacy,
    signatureHue: row.signature_hue,
    permissions: {
      duet: row.duet_permission,
      message: row.message_permission,
      comment: row.comment_permission,
      defaultWaveVisibility: row.default_wave_visibility,
    },
    interests: row.interests,
    onboardedAt: row.onboarded_at,
    notificationPreferences: row.notification_preferences,
    isModerator: row.is_moderator,
    suspendedUntil: row.suspended_until,
    locale: row.locale,
    counts: {
      followers: row.follower_count,
      following: row.following_count,
      waves: row.wave_count,
    },
    createdAt: row.created_at,
  };
}

/** Defensive parse: `peaks` is jsonb, so it is `unknown` until proven otherwise. */
export function toWaveformPeaks(value: Json | null): WaveformPeaks | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const data = record.data;
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  const numbers = data.filter((entry): entry is number => typeof entry === "number");
  if (numbers.length !== data.length) {
    return null;
  }
  return {
    version: typeof record.version === "number" ? record.version : 1,
    bits: typeof record.bits === "number" ? record.bits : 8,
    samplesPerPixel:
      typeof record.samples_per_pixel === "number" ? record.samples_per_pixel : 512,
    data: numbers,
  };
}

export function toAudioAsset(row: AudioAssetRow): AudioAsset {
  return {
    id: row.id,
    ownerId: row.owner_id,
    originalPath: row.original_path,
    processedPath: row.processed_path,
    durationMs: row.duration_ms,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sampleRate: row.sample_rate,
    channels: row.channels,
    peaks: toWaveformPeaks(row.peaks),
    processingStatus: row.processing_status,
    processingError: row.processing_error,
    enhancementPreset: row.enhancement_preset,
    enhancementReport: (row.enhancement_report as unknown as EnhancementReport | null) ?? null,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

export function toAudioProcessingJob(row: AudioProcessingJobRow): AudioProcessingJob {
  return {
    id: row.id,
    audioAssetId: row.audio_asset_id,
    jobType: row.job_type,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    payload: row.payload,
    result: row.result,
    runAfter: row.run_after,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

/** Defensive parse: `segments` is jsonb, so it is `unknown` until proven otherwise — mirrors `toWaveformPeaks` above. */
export function toDuetSegments(value: Json | null): DuetSegment[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const segments: DuetSegment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const record = entry as Record<string, unknown>;
    const source = record.source;
    const startMs = record.startMs;
    const endMs = record.endMs;
    if ((source !== "original" && source !== "contribution") || typeof startMs !== "number" || typeof endMs !== "number") {
      return null;
    }
    segments.push({ source, startMs, endMs });
  }
  return segments;
}

export function toWave(row: WaveRow): Wave {
  return {
    id: row.id,
    creatorId: row.creator_id,
    audioAssetId: row.audio_asset_id,
    title: row.title,
    description: row.description,
    creationType: row.creation_type,
    visibility: row.visibility,
    commentPermission: row.comment_permission,
    duetPermission: row.duet_permission,
    duet: {
      originalWaveId: row.original_wave_id,
      parentWaveId: row.parent_wave_id,
      duetRequestId: row.duet_request_id,
      depth: row.duet_depth,
      mode: row.duet_mode,
      segments: toDuetSegments(row.segments),
      cypherOrder: row.cypher_order,
    },
    backingTrackId: row.backing_track_id,
    contentOrigin: row.content_origin,
    tags: row.tags,
    counts: {
      plays: row.play_count,
      replays: row.replay_count,
      comments: row.comment_count,
      saves: row.save_count,
      shares: row.share_count,
      duets: row.duet_count,
      echoes: row.echo_count,
    },
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    hiddenAt: row.hidden_at,
  };
}

export function toBackingTrack(row: BackingTrackRow): BackingTrack {
  return {
    id: row.id,
    uploaderId: row.uploader_id,
    title: row.title,
    artistCredit: row.artist_credit,
    license: row.license,
    sourceUrl: row.source_url,
    audioAssetId: row.audio_asset_id,
    bpm: row.bpm,
    musicalKey: row.musical_key,
    genreTags: row.genre_tags,
    durationMs: row.duration_ms,
    isCurated: row.is_curated,
    openForVocals: row.open_for_vocals,
    createdAt: row.created_at,
  };
}

export function toOpenCall(row: OpenCallRow): OpenCall {
  return {
    id: row.id,
    waveId: row.wave_id,
    creatorId: row.creator_id,
    prompt: row.prompt,
    deadlineAt: row.deadline_at,
    isOpen: row.is_open,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

export function toChallenge(row: ChallengeRow): Challenge {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    brief: row.brief,
    titleTr: row.title_tr,
    briefTr: row.brief_tr,
    hashtag: row.hashtag,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    backingTrackId: row.backing_track_id,
    duetMode: row.duet_mode,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toChallengeEntry(row: ChallengeEntryRow): ChallengeEntry {
  return {
    id: row.id,
    challengeId: row.challenge_id,
    waveId: row.wave_id,
    userId: row.user_id,
    createdAt: row.created_at,
  };
}

export function toChallengePick(row: ChallengePickRow): ChallengePick {
  return {
    id: row.id,
    challengeId: row.challenge_id,
    waveId: row.wave_id,
    rank: row.rank,
    pickedBy: row.picked_by,
    note: row.note,
    createdAt: row.created_at,
  };
}

export function toCollaborator(row: WaveCollaboratorRow): Collaborator {
  return {
    id: row.id,
    waveId: row.wave_id,
    profileId: row.profile_id,
    invitedBy: row.invited_by,
    status: row.status,
    role: row.role,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    waveId: row.wave_id,
    authorId: row.author_id,
    parentCommentId: row.parent_comment_id,
    body: row.body,
    replyCount: row.reply_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toWaveListen(row: WaveListenRow): WaveListen {
  return {
    waveId: row.wave_id,
    listenerKey: row.listener_key,
    listenerId: row.listener_id,
    playCounted: row.play_counted,
    replayCounted: row.replay_counted,
    listenCount: row.listen_count,
    completedCount: row.completed_count,
    totalListenedMs: row.total_listened_ms,
    firstPlayedAt: row.first_played_at,
    lastPlayedAt: row.last_played_at,
  };
}

export function toShare(row: ShareRow): Share {
  return {
    id: row.id,
    waveId: row.wave_id,
    sharerId: row.sharer_id,
    channel: row.channel,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
  };
}

export function toDuetRequest(row: DuetRequestRow): DuetRequest {
  return {
    id: row.id,
    waveId: row.wave_id,
    requesterId: row.requester_id,
    recipientId: row.recipient_id,
    message: row.message,
    status: row.status,
    expiresAt: row.expires_at,
    resultingWaveId: row.resulting_wave_id,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}

export function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    kind: row.kind,
    createdBy: row.created_by,
    title: row.title,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

export function toConversationMember(row: ConversationMemberRow): ConversationMember {
  return {
    conversationId: row.conversation_id,
    profileId: row.profile_id,
    joinedAt: row.joined_at,
    lastReadAt: row.last_read_at,
    muted: row.muted,
  };
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    kind: row.kind,
    body: row.body,
    audioAssetId: row.audio_asset_id,
    sharedWaveId: row.shared_wave_id,
    duetRequestId: row.duet_request_id,
    createdAt: row.created_at,
  };
}

export function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    type: row.type,
    actorId: row.actor_id,
    waveId: row.wave_id,
    commentId: row.comment_id,
    duetRequestId: row.duet_request_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    groupKey: row.group_key,
    count: row.count,
    readAt: row.read_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    targetType: row.target_type,
    targetWaveId: row.target_wave_id,
    targetCommentId: row.target_comment_id,
    targetProfileId: row.target_profile_id,
    targetMessageId: row.target_message_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

export function toModerationAction(row: ModerationActionRow): ModerationAction {
  return {
    id: row.id,
    reportId: row.report_id,
    moderatorId: row.moderator_id,
    action: row.action,
    note: row.note,
    createdAt: row.created_at,
  };
}

/**
 * Attach an AKINTI Pro badge flag (Wave F, PRODUCT_V2 §5) to a mapped
 * `Profile`. `profiles` itself carries no `is_pro` column — entitlement
 * lives in `subscriptions`, read through `has_pro()`
 * (`src/lib/billing/entitlements.ts#isPro`) — so a call site fetches that
 * boolean itself and passes it here rather than this module reaching into
 * the billing schema directly (mappers stay pure row -> domain functions).
 */
export function withIsPro<T extends object>(profile: T, isPro: boolean): T & { isPro: boolean } {
  return { ...profile, isPro };
}

/** `record_play_event` returns jsonb; narrow it before anyone acts on it. */
export function toPlaybackOutcome(value: Json): PlaybackOutcome {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ignored: true, countedPlay: false, countedReplay: false };
  }
  const record = value as Record<string, unknown>;
  return {
    ignored: record.ignored === true,
    countedPlay: record.counted_play === true,
    countedReplay: record.counted_replay === true,
    thresholdMs: typeof record.threshold_ms === "number" ? record.threshold_ms : undefined,
  };
}
