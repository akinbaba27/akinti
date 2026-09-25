/**
 * Hand-written `Database` type for AKINTI.
 *
 * This mirrors `supabase/migrations/*.sql` exactly and is the shape
 * `@supabase/supabase-js` expects from `supabase gen types typescript`.
 * When you change a migration, change this file in the same commit.
 *
 * Conventions:
 *  - `Row`    — what a SELECT returns.
 *  - `Insert` — columns with a database default are optional.
 *  - `Update` — every column optional.
 *  - Columns the database owns (counters, processing state, duet lineage) are
 *    marked `never` in `Insert`/`Update` where a client must not set them, so
 *    an attempt to forge them fails at compile time as well as at runtime.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Must stay a MUTABLE array. `@supabase/postgrest-js`'s `GenericTable` type
 * requires `Relationships: GenericRelationship[]`, and a `readonly T[]` is not
 * assignable to `T[]` — if this were `readonly {...}[]`, every table would
 * silently fail to satisfy `GenericTable`, `Database["public"]` would fail to
 * satisfy `GenericSchema`, and `SupabaseClient<Database>` would collapse its
 * `Schema` generic to `never` (see `node_modules/@supabase/supabase-js`'s
 * `SupabaseClient` class declaration), breaking every `.from()`/`.rpc()` call
 * with confusing "not assignable to type 'never'" errors and no runtime error
 * at all. We never populate this array (nothing here does embedded
 * `table!fk(...)` selects), so its only job is satisfying that structural check.
 */
type Relationships = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
}[];

/* ------------------------------------------------------------------------ */
/* Enums                                                                     */
/* ------------------------------------------------------------------------ */

export type ProfilePrivacy = "public" | "private";
export type PermissionAudience = "everyone" | "followers" | "following" | "nobody";
/**
 * `comment_permission` on both `profiles` and `waves` is a `permission_audience`
 * column narrowed by a CHECK constraint that excludes `'following'`
 * (`profiles_comment_permission_values`, migration 02;
 * `waves_comment_permission_values`, migration 04 — comments only ever offer
 * everyone / followers / nobody, spec s14). This alias makes that narrowing a
 * compile-time fact instead of a runtime-only one.
 */
export type CommentAudience = "everyone" | "followers" | "nobody";
export type FollowStatus = "pending" | "accepted";

/** Migration `20260906220000_profile_signature_hue`. See `SIGNATURE_HUES` in `src/types/domain.ts`. */
export type SignatureHue = "current" | "genre-turku" | "genre-rap" | "genre-arabesk";

export type AudioProcessingStatus = "pending" | "processing" | "ready" | "failed";
export type AudioEnhancementPreset =
  | "natural"
  | "studio"
  | "clear_voice"
  | "warm"
  | "deep"
  | "atmospheric"
  /** AKINTI Pro only (migration 20260906120000) — see `PRO_ENHANCEMENT_PRESETS` in `src/lib/audio/enhancement.ts`. */
  | "pitch_snap"
  | "self_harmony";
export type AudioJobType = "process_audio" | "mix_duet";
export type AudioJobStatus = "pending" | "processing" | "done" | "failed" | "cancelled";

export type BackingTrackLicense = "cc0" | "cc_by" | "owner_upload";

export type WaveCreationType = "recorded" | "uploaded" | "duet";
export type WaveVisibility = "everyone" | "followers" | "only_me";
export type ContentOrigin = "original" | "cover" | "licensed" | "unknown";
export type CollaboratorStatus = "pending" | "accepted" | "declined";
export type ShareChannel = "link" | "message" | "native";

export type DuetRequestStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

/** Wave D (Duets v2). `layer` is the original simultaneous mix; `atisma` (call-and-response) and `cypher` (sequential verses) are new — see docs/DUET_SPEC.md. */
export type DuetMode = "layer" | "atisma" | "cypher";

export type ConversationKind = "direct" | "group";
export type MessageKind = "text" | "audio" | "wave_share" | "duet_request";

export type NotificationType =
  | "follow"
  | "follow_request"
  | "comment"
  | "comment_reply"
  | "save"
  | "share"
  | "duet_request"
  | "duet_accepted"
  | "duet_declined"
  | "duet_published"
  | "collaborator_invite"
  | "collaborator_accepted"
  | "message"
  | "system"
  /** Wave D: fired when someone answers a creator's open call — see docs/DUET_SPEC.md "Open calls". */
  | "open_call_answered";

/** Prompts & challenges (PRODUCT_V2 §4). `draft` is moderator/author-only; `live`/`closed` are publicly readable. */
export type ChallengeStatus = "draft" | "live" | "closed";

/** AKINTI Pro (Wave F, PRODUCT_V2 §4/§5). iyzico is primary (TR/TRY); Paddle is secondary (international/USD) — never Stripe. */
export type BillingProvider = "iyzico" | "paddle";
/** `trialing`/`active` both count toward `has_pro()`; `past_due` does not (spec: a failed renewal should not keep Pro-only options open indefinitely). */
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "expired";
export type PlanInterval = "month" | "year";
export type PlanCode = "pro_monthly_try" | "pro_yearly_try" | "pro_monthly_usd" | "pro_yearly_usd";

export type ReportTargetType = "wave" | "comment" | "profile" | "message";
export type ReportReason =
  | "spam"
  | "harassment"
  | "impersonation"
  | "copyright"
  | "inappropriate"
  | "abusive"
  | "other";
export type ReportStatus = "open" | "reviewing" | "actioned" | "dismissed";
export type ModerationActionType = "none" | "hide_wave" | "hide_comment" | "warn_user" | "suspend_user";

/** Keys of `profiles.notification_preferences` (spec s23, s25). A missing key means "on". */
export type NotificationCategory = "message" | "duet" | "comment" | "follower" | "system";
/** Shape of the `notification_preferences` jsonb column — every key optional, `undefined` == on. */
export type NotificationPreferences = Partial<Record<NotificationCategory, boolean>>;

/* ------------------------------------------------------------------------ */
/* Row shapes                                                                */
/* ------------------------------------------------------------------------ */

export type ProfileRow = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  privacy: ProfilePrivacy;
  /** Migration `20260906220000_profile_signature_hue`. `null` = no explicit choice. */
  signature_hue: SignatureHue | null;
  duet_permission: PermissionAudience;
  message_permission: PermissionAudience;
  comment_permission: CommentAudience;
  default_wave_visibility: WaveVisibility;
  interests: string[];
  onboarded_at: string | null;
  /** jsonb; validated by `profiles_notification_preferences_valid` (migration 22). */
  notification_preferences: NotificationPreferences;
  /** Server-owned (migration 23) — never settable via a normal profile update, see `profiles_guard_moderation_columns`. */
  is_moderator: boolean;
  /** Server-owned (migration 23) — set only by `resolve_report(..., 'suspend_user')`. */
  suspended_until: string | null;
  /** User-chosen UI locale (migration `20260906130000`). `null` means no explicit preference — resolve from cookie/header instead (`src/i18n/locale.ts`). */
  locale: "tr" | "en" | null;
  follower_count: number;
  following_count: number;
  wave_count: number;
  created_at: string;
  updated_at: string;
};

export type FollowRow = {
  follower_id: string;
  followee_id: string;
  status: FollowStatus;
  created_at: string;
  responded_at: string | null;
};

export type BlockRow = {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
};

/** Web Push subscription (migration 20260905170000). Owner-only, see `docs/DATABASE.md`. */
export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
};

export type AudioAssetRow = {
  id: string;
  owner_id: string;
  storage_bucket: string;
  original_path: string;
  processed_path: string | null;
  duration_ms: number | null;
  mime_type: string;
  byte_size: number;
  sample_rate: number | null;
  channels: number | null;
  peaks: Json | null;
  processing_status: AudioProcessingStatus;
  processing_error: string | null;
  enhancement_preset: AudioEnhancementPreset;
  checksum_sha256: string | null;
  /** Server-owned (migration 20260905100000) — see docs/AUDIO_ARCHITECTURE.md "Enhancement report". */
  enhancement_report: Json | null;
  /** Server-owned (migration 20260906120000) — best-effort pYIN score, null when never computed. See docs/AUDIO_ARCHITECTURE.md "Pitch score". */
  pitch_score: Json | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
};

export type AudioProcessingJobRow = {
  id: number;
  audio_asset_id: string;
  job_type: AudioJobType;
  status: AudioJobStatus;
  priority: number;
  payload: Json;
  result: Json | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type WaveRow = {
  id: string;
  creator_id: string;
  audio_asset_id: string;
  title: string;
  description: string | null;
  creation_type: WaveCreationType;
  visibility: WaveVisibility;
  comment_permission: CommentAudience | null;
  duet_permission: PermissionAudience | null;
  original_wave_id: string | null;
  parent_wave_id: string | null;
  duet_request_id: string | null;
  duet_depth: number;
  /** Set when this Wave is a vocal recorded over a backing track (spec §4) — mutually exclusive with `parent_wave_id` (see `waves_not_duet_and_backing_track`, migration 20260905110000). */
  backing_track_id: string | null;
  /** Wave D. `null` for a non-duet Wave; server-defaults to `'layer'` for a duet Wave that doesn't request a mode — see `waves_derive_duet_lineage`. */
  duet_mode: DuetMode | null;
  /** Wave D, `atisma` only — jsonb `[{ source, startMs, endMs }]`; validated by `validate_duet_segments()`. `null` for every other mode. */
  segments: Json | null;
  /** Wave D, `cypher` only — 1-based position in the cypher, capped at 4. `null` for every other mode. */
  cypher_order: number | null;
  content_origin: ContentOrigin;
  tags: string[];
  play_count: number;
  replay_count: number;
  comment_count: number;
  save_count: number;
  share_count: number;
  duet_count: number;
  /** Echoes (Wave E) — maintained by `echoes_after_change()`, migration `20260918120100_echoes.sql`. */
  echo_count: number;
  published_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Server-owned (migration 23) — set only by `resolve_report(..., 'hide_wave')`. Invisible to everyone but the creator and moderators; distinct from `deleted_at`. */
  hidden_at: string | null;
};

export type BackingTrackRow = {
  id: string;
  uploader_id: string | null;
  title: string;
  artist_credit: string;
  license: BackingTrackLicense;
  source_url: string | null;
  audio_asset_id: string;
  bpm: number | null;
  musical_key: string | null;
  genre_tags: string[];
  duration_ms: number | null;
  is_curated: boolean;
  open_for_vocals: boolean;
  created_at: string;
  updated_at: string;
};

/** Wave D — `public.open_calls` (one row per Wave). See `src/lib/db/openCalls.ts`. */
export type OpenCallRow = {
  id: string;
  wave_id: string;
  creator_id: string;
  prompt: string | null;
  deadline_at: string | null;
  is_open: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

/** Row shape returned by the `duet_tree` RPC — see `src/lib/duet/chain.ts`. */
export type DuetTreeNodeRow = {
  id: string;
  parent_wave_id: string | null;
  creator_id: string;
  depth: number;
  creation_type: WaveCreationType;
  duet_mode: DuetMode | null;
  cypher_order: number | null;
  published_at: string;
  play_count: number;
  duet_count: number;
};

/** Prompts & challenges (PRODUCT_V2 §4, migration 20260905130000). See `src/lib/db/challenges.ts`. */
export type ChallengeRow = {
  id: string;
  slug: string;
  /** English title (default/fallback). */
  title: string;
  /** English brief (default/fallback). */
  brief: string;
  /** Turkish title (migration `20260906220100_challenge_locale`). `null` falls back to `title`. */
  title_tr: string | null;
  /** Turkish brief. `null` falls back to `brief`. */
  brief_tr: string | null;
  /** Stored without a leading '#', lowercase — matches `list_waves_by_hashtag(hashtag)`. */
  hashtag: string;
  starts_at: string;
  ends_at: string;
  backing_track_id: string | null;
  duet_mode: DuetMode | null;
  status: ChallengeStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ChallengeEntryRow = {
  id: string;
  challenge_id: string;
  wave_id: string;
  user_id: string;
  created_at: string;
};

/** The curated Top 5 for a challenge. */
export type ChallengePickRow = {
  id: string;
  challenge_id: string;
  wave_id: string;
  /** 1..5 */
  rank: number;
  picked_by: string | null;
  note: string | null;
  created_at: string;
};

/** The four sellable Pro SKUs. Public read-only catalog — seeded by a human once real provider price ids exist, never by client code (docs/BILLING.md). */
export type PlanRow = {
  id: string;
  code: PlanCode;
  provider: BillingProvider;
  provider_price_id: string;
  /** Minor units (kuruş/cents). */
  amount: number;
  currency: "TRY" | "USD";
  interval: PlanInterval;
  is_active: boolean;
  created_at: string;
};

/** One row per subscription a user has ever held with a provider — history, not just current state. */
export type SubscriptionRow = {
  id: string;
  user_id: string;
  plan_id: string;
  provider: BillingProvider;
  provider_subscription_id: string;
  status: SubscriptionStatus;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
  /** `occurredAt` of the most recent webhook event actually applied — null until the first webhook lands (migration 20260906160000, review3 finding 7). */
  last_event_at: string | null;
};

/** Flow (docs/FLOW.md) — owner-only ledger of what a viewer has been shown, migration 20260906110000. */
export type FlowImpressionRow = {
  user_id: string;
  wave_id: string;
  seen_at: string;
  completed: boolean;
  skipped_at_ms: number | null;
};

/**
 * One row of the `get_flow_page` RPC result — see `src/lib/db/flow.ts`. Not
 * a table row: `bucket`/`score` are this call's rank for `wave_id`, and
 * `cursor_*` are the exact values the *next* call's cursor should carry
 * (repeated on every row so the caller only ever needs the last one).
 */
export type FlowFeedRankRow = {
  wave_id: string;
  bucket: number;
  score: number | null;
  cursor_bucket: number | null;
  cursor_score: number | null;
  cursor_id: string | null;
  cursor_slot: number;
};

/** Append-only webhook ledger. `(provider, event_id)` unique for idempotent replay. */
export type BillingEventRow = {
  id: string;
  provider: BillingProvider;
  event_id: string;
  type: string;
  payload: Json;
  processed_at: string | null;
  created_at: string;
};

export type WaveCollaboratorRow = {
  id: string;
  wave_id: string;
  profile_id: string;
  invited_by: string | null;
  status: CollaboratorStatus;
  role: string | null;
  created_at: string;
  responded_at: string | null;
};

export type CommentRow = {
  id: string;
  wave_id: string;
  author_id: string;
  parent_comment_id: string | null;
  body: string;
  reply_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type SaveRow = {
  profile_id: string;
  wave_id: string;
  created_at: string;
};

/** Echoes (Wave E) — same shape as `SaveRow`, see `docs/ECHOES.md`. */
export type EchoRow = {
  profile_id: string;
  wave_id: string;
  created_at: string;
};

export type ShareRow = {
  id: string;
  wave_id: string;
  sharer_id: string;
  channel: ShareChannel;
  conversation_id: string | null;
  created_at: string;
};

export type PlayEventRow = {
  id: number;
  wave_id: string;
  listener_id: string | null;
  listener_key: string;
  session_id: string;
  listened_ms: number;
  duration_ms: number | null;
  completed: boolean;
  counted_play: boolean;
  counted_replay: boolean;
  /** Set by `flag_suspicious_play_events()` (spec s27 anomaly flag, migration 24). */
  suspicious: boolean;
  created_at: string;
};

export type WaveListenRow = {
  wave_id: string;
  listener_key: string;
  listener_id: string | null;
  play_counted: boolean;
  replay_counted: boolean;
  listen_count: number;
  completed_count: number;
  total_listened_ms: number;
  first_played_at: string;
  play_counted_at: string | null;
  replay_counted_at: string | null;
  last_played_at: string;
};

/* ------------------------------------------------------------------------ */
/* Creator analytics + product health (spec s27, s28, migration 24)         */
/* Not tables — the shapes `creator_overview`/`creator_timeseries`/          */
/* `creator_wave_performance`/`product_health` return as `returns table`.   */
/* ------------------------------------------------------------------------ */
export type CreatorOverviewRow = {
  plays: number;
  unique_listeners: number;
  replays: number;
  saves: number;
  shares: number;
  comments: number;
  duets: number;
  avg_listen_seconds: number | null;
  completion_rate: number;
  follower_delta: number;
};

export type CreatorTimeseriesRow = {
  day: string;
  plays: number;
  unique_listeners: number;
  replays: number;
  saves: number;
  comments: number;
  shares: number;
  new_followers: number;
};

export type CreatorWavePerformanceRow = {
  wave_id: string;
  title: string;
  creation_type: WaveCreationType;
  published_at: string;
  plays: number;
  replays: number;
  saves: number;
  comments: number;
  shares: number;
  completion_rate: number;
};

export type ProductHealthRow = {
  activation_rate: number;
  week1_returning_listener_rate: number;
  week4_returning_listener_rate: number;
  week1_returning_creator_rate: number;
  week4_returning_creator_rate: number;
  duet_requests_per_active_user: number;
  duet_acceptance_rate: number;
  duets_per_week: number;
  discovery_share: number;
  content_velocity: number;
};

export type DuetRequestRow = {
  id: string;
  wave_id: string;
  requester_id: string;
  recipient_id: string;
  message: string | null;
  status: DuetRequestStatus;
  expires_at: string;
  resulting_wave_id: string | null;
  created_at: string;
  responded_at: string | null;
};

export type ConversationRow = {
  id: string;
  kind: ConversationKind;
  created_by: string | null;
  direct_key: string | null;
  title: string | null;
  last_message_at: string;
  created_at: string;
};

export type ConversationMemberRow = {
  conversation_id: string;
  profile_id: string;
  joined_at: string;
  last_read_at: string | null;
  muted: boolean;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: MessageKind;
  body: string | null;
  audio_asset_id: string | null;
  shared_wave_id: string | null;
  duet_request_id: string | null;
  created_at: string;
  deleted_at: string | null;
};

export type NotificationRow = {
  id: string;
  recipient_id: string;
  type: NotificationType;
  actor_id: string | null;
  wave_id: string | null;
  comment_id: string | null;
  duet_request_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  group_key: string;
  count: number;
  read_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReportRow = {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_wave_id: string | null;
  target_comment_id: string | null;
  target_profile_id: string | null;
  target_message_id: string | null;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  reviewer_id: string | null;
  resolution_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

/** Audit trail for `resolve_report`/`dismiss_report` (migration 23). Written only by those RPCs. */
export type ModerationActionRow = {
  id: string;
  report_id: string;
  moderator_id: string;
  action: ModerationActionType;
  note: string | null;
  created_at: string;
};

/* ------------------------------------------------------------------------ */
/* Database                                                                  */
/* ------------------------------------------------------------------------ */

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Pick<ProfileRow, "id" | "username"> &
          Partial<
            Omit<
              ProfileRow,
              | "id"
              | "username"
              | "follower_count"
              | "following_count"
              | "wave_count"
              | "is_moderator"
              | "suspended_until"
            >
          >;
        /** `is_moderator`/`suspended_until` are server-owned (migration 23, `profiles_guard_moderation_columns`) — never client-settable. */
        Update: Partial<
          Omit<
            ProfileRow,
            | "id"
            | "follower_count"
            | "following_count"
            | "wave_count"
            | "is_moderator"
            | "suspended_until"
          >
        >;
        Relationships: Relationships;
      };
      follows: {
        Row: FollowRow;
        Insert: Pick<FollowRow, "follower_id" | "followee_id"> &
          Partial<Pick<FollowRow, "status" | "created_at" | "responded_at">>;
        Update: Partial<Pick<FollowRow, "status" | "responded_at">>;
        Relationships: Relationships;
      };
      blocks: {
        Row: BlockRow;
        Insert: Pick<BlockRow, "blocker_id" | "blocked_id"> & Partial<Pick<BlockRow, "created_at">>;
        Update: Partial<BlockRow>;
        Relationships: Relationships;
      };
      push_subscriptions: {
        Row: PushSubscriptionRow;
        Insert: Pick<PushSubscriptionRow, "user_id" | "endpoint" | "p256dh" | "auth"> &
          Partial<Pick<PushSubscriptionRow, "id" | "user_agent" | "created_at">>;
        Update: Partial<Pick<PushSubscriptionRow, "p256dh" | "auth" | "user_agent">>;
        Relationships: Relationships;
      };
      audio_assets: {
        Row: AudioAssetRow;
        Insert: Pick<AudioAssetRow, "owner_id" | "original_path" | "mime_type" | "byte_size"> &
          Partial<
            Pick<
              AudioAssetRow,
              | "id"
              | "storage_bucket"
              | "duration_ms"
              | "sample_rate"
              | "channels"
              | "enhancement_preset"
              | "checksum_sha256"
            >
          >;
        /** Processing columns are written only by the worker RPCs. */
        Update: Partial<Pick<AudioAssetRow, "enhancement_preset" | "duration_ms" | "sample_rate" | "channels">>;
        Relationships: Relationships;
      };
      audio_processing_jobs: {
        Row: AudioProcessingJobRow;
        Insert: Pick<AudioProcessingJobRow, "audio_asset_id" | "job_type"> &
          Partial<Pick<AudioProcessingJobRow, "priority" | "payload" | "max_attempts" | "run_after">>;
        Update: Partial<
          Pick<AudioProcessingJobRow, "status" | "priority" | "payload" | "result" | "run_after">
        >;
        Relationships: Relationships;
      };
      waves: {
        Row: WaveRow;
        Insert: Pick<WaveRow, "creator_id" | "audio_asset_id" | "title" | "creation_type"> &
          Partial<
            Pick<
              WaveRow,
              | "id"
              | "description"
              | "visibility"
              | "comment_permission"
              | "duet_permission"
              | "parent_wave_id"
              | "duet_request_id"
              | "backing_track_id"
              | "duet_mode"
              | "segments"
              | "cypher_order"
              | "content_origin"
              | "tags"
              | "published_at"
            >
          >;
        Update: Partial<
          Pick<
            WaveRow,
            | "title"
            | "description"
            | "visibility"
            | "comment_permission"
            | "duet_permission"
            | "content_origin"
            | "tags"
            | "deleted_at"
          >
        >;
        Relationships: Relationships;
      };
      backing_tracks: {
        Row: BackingTrackRow;
        Insert: Pick<BackingTrackRow, "title" | "artist_credit" | "license" | "audio_asset_id"> &
          Partial<
            Pick<
              BackingTrackRow,
              | "id"
              | "uploader_id"
              | "source_url"
              | "bpm"
              | "musical_key"
              | "genre_tags"
              | "duration_ms"
              | "is_curated"
              | "open_for_vocals"
            >
          >;
        Update: Partial<
          Pick<BackingTrackRow, "title" | "artist_credit" | "genre_tags" | "open_for_vocals">
        >;
        Relationships: Relationships;
      };
      open_calls: {
        Row: OpenCallRow;
        Insert: Pick<OpenCallRow, "wave_id"> & Partial<Pick<OpenCallRow, "id" | "prompt" | "deadline_at" | "is_open">>;
        Update: Partial<Pick<OpenCallRow, "prompt" | "deadline_at" | "is_open">>;
        Relationships: Relationships;
      };
      challenges: {
        Row: ChallengeRow;
        Insert: Pick<ChallengeRow, "slug" | "title" | "brief" | "hashtag" | "starts_at" | "ends_at"> &
          Partial<
            Pick<
              ChallengeRow,
              "id" | "title_tr" | "brief_tr" | "backing_track_id" | "duet_mode" | "status" | "created_by"
            >
          >;
        Update: Partial<
          Pick<
            ChallengeRow,
            | "title"
            | "brief"
            | "title_tr"
            | "brief_tr"
            | "hashtag"
            | "starts_at"
            | "ends_at"
            | "backing_track_id"
            | "duet_mode"
            | "status"
          >
        >;
        Relationships: Relationships;
      };
      challenge_entries: {
        Row: ChallengeEntryRow;
        Insert: Pick<ChallengeEntryRow, "challenge_id" | "wave_id"> &
          Partial<Pick<ChallengeEntryRow, "id" | "user_id">>;
        /** No client update path — an entry is entered or withdrawn (deleted), never edited. */
        Update: never;
        Relationships: Relationships;
      };
      challenge_picks: {
        Row: ChallengePickRow;
        Insert: Pick<ChallengePickRow, "challenge_id" | "wave_id" | "rank"> &
          Partial<Pick<ChallengePickRow, "id" | "picked_by" | "note">>;
        Update: Partial<Pick<ChallengePickRow, "rank" | "note">>;
        Relationships: Relationships;
      };
      /**
       * `plans`/`subscriptions`/`billing_events` grant no client role an
       * insert/update path (RLS denies it outright, migration
       * `20260906100000_subscriptions.sql`) — but the shapes below are still
       * real, because `src/lib/billing/repository.ts` writes them through
       * the service-role admin client, which is typed with this same
       * `Database`. `never` here would make that legitimate, server-only
       * code fail to compile, not just fail at runtime (which RLS already
       * guarantees regardless of what TypeScript allows).
       */
      plans: {
        Row: PlanRow;
        Insert: Pick<PlanRow, "code" | "provider" | "provider_price_id" | "amount" | "currency" | "interval"> &
          Partial<Pick<PlanRow, "id" | "is_active">>;
        Update: Partial<Pick<PlanRow, "provider_price_id" | "amount" | "is_active">>;
        Relationships: Relationships;
      };
      subscriptions: {
        Row: SubscriptionRow;
        Insert: Pick<SubscriptionRow, "user_id" | "plan_id" | "provider" | "provider_subscription_id"> &
          Partial<Pick<SubscriptionRow, "id" | "status" | "current_period_end" | "cancel_at_period_end" | "last_event_at">>;
        Update: Partial<
          Pick<
            SubscriptionRow,
            "plan_id" | "provider_subscription_id" | "status" | "current_period_end" | "cancel_at_period_end" | "last_event_at"
          >
        >;
        Relationships: Relationships;
      };
      billing_events: {
        Row: BillingEventRow;
        Insert: Pick<BillingEventRow, "provider" | "event_id" | "type" | "payload"> &
          Partial<Pick<BillingEventRow, "id" | "processed_at">>;
        Update: Partial<Pick<BillingEventRow, "processed_at">>;
        Relationships: Relationships;
      };
      /** Written exclusively by the `record_flow_event` RPC — no direct client insert/update path (docs/FLOW.md). */
      flow_impressions: {
        Row: FlowImpressionRow;
        Insert: never;
        Update: never;
        Relationships: Relationships;
      };
      wave_collaborators: {
        Row: WaveCollaboratorRow;
        Insert: Pick<WaveCollaboratorRow, "wave_id" | "profile_id"> &
          Partial<Pick<WaveCollaboratorRow, "id" | "invited_by" | "status" | "role">>;
        Update: Partial<Pick<WaveCollaboratorRow, "status" | "role" | "responded_at">>;
        Relationships: Relationships;
      };
      comments: {
        Row: CommentRow;
        Insert: Pick<CommentRow, "wave_id" | "author_id" | "body"> &
          Partial<Pick<CommentRow, "id" | "parent_comment_id">>;
        Update: Partial<Pick<CommentRow, "body" | "deleted_at">>;
        Relationships: Relationships;
      };
      saves: {
        Row: SaveRow;
        Insert: Pick<SaveRow, "profile_id" | "wave_id"> & Partial<Pick<SaveRow, "created_at">>;
        Update: Partial<Pick<SaveRow, "created_at">>;
        Relationships: Relationships;
      };
      echoes: {
        Row: EchoRow;
        Insert: Pick<EchoRow, "profile_id" | "wave_id"> & Partial<Pick<EchoRow, "created_at">>;
        Update: Partial<Pick<EchoRow, "created_at">>;
        Relationships: Relationships;
      };
      shares: {
        Row: ShareRow;
        Insert: Pick<ShareRow, "wave_id" | "sharer_id" | "channel"> &
          Partial<Pick<ShareRow, "id" | "conversation_id">>;
        Update: never;
        Relationships: Relationships;
      };
      play_events: {
        Row: PlayEventRow;
        /** Written exclusively by the `record_play_event` RPC. */
        Insert: never;
        Update: never;
        Relationships: Relationships;
      };
      wave_listens: {
        Row: WaveListenRow;
        /** Written exclusively by the `record_play_event` RPC. */
        Insert: never;
        Update: never;
        Relationships: Relationships;
      };
      duet_requests: {
        Row: DuetRequestRow;
        Insert: Pick<DuetRequestRow, "wave_id" | "requester_id" | "recipient_id"> &
          Partial<Pick<DuetRequestRow, "id" | "message" | "expires_at">>;
        Update: Partial<Pick<DuetRequestRow, "status" | "resulting_wave_id">>;
        Relationships: Relationships;
      };
      conversations: {
        Row: ConversationRow;
        Insert: Pick<ConversationRow, "created_by"> &
          Partial<Pick<ConversationRow, "id" | "kind" | "direct_key" | "title">>;
        Update: Partial<Pick<ConversationRow, "title">>;
        Relationships: Relationships;
      };
      conversation_members: {
        Row: ConversationMemberRow;
        Insert: Pick<ConversationMemberRow, "conversation_id" | "profile_id"> &
          Partial<Pick<ConversationMemberRow, "last_read_at" | "muted">>;
        Update: Partial<Pick<ConversationMemberRow, "last_read_at" | "muted">>;
        Relationships: Relationships;
      };
      messages: {
        Row: MessageRow;
        Insert: Pick<MessageRow, "conversation_id" | "sender_id" | "kind"> &
          Partial<
            Pick<MessageRow, "id" | "body" | "audio_asset_id" | "shared_wave_id" | "duet_request_id">
          >;
        Update: Partial<Pick<MessageRow, "deleted_at">>;
        Relationships: Relationships;
      };
      notifications: {
        Row: NotificationRow;
        /** Written exclusively by the `push_notification` routine. */
        Insert: never;
        Update: Partial<Pick<NotificationRow, "read_at">>;
        Relationships: Relationships;
      };
      reports: {
        Row: ReportRow;
        Insert: Pick<ReportRow, "reporter_id" | "target_type" | "reason"> &
          Partial<
            Pick<
              ReportRow,
              | "id"
              | "target_wave_id"
              | "target_comment_id"
              | "target_profile_id"
              | "target_message_id"
              | "details"
            >
          >;
        Update: never;
        Relationships: Relationships;
      };
      moderation_actions: {
        Row: ModerationActionRow;
        /** Written exclusively by `resolve_report`/`dismiss_report`. */
        Insert: never;
        Update: never;
        Relationships: Relationships;
      };
    };
    Views: Record<never, never>;
    Functions: {
      is_blocked_between: { Args: { a: string; b: string }; Returns: boolean };
      is_following: { Args: { follower: string; followee: string }; Returns: boolean };
      are_mutual_followers: { Args: { a: string; b: string }; Returns: boolean };
      audience_allows: {
        Args: { p_audience: PermissionAudience; p_owner: string; p_viewer: string };
        Returns: boolean;
      };
      can_view_profile: { Args: { p_profile_id: string }; Returns: boolean };
      can_view_profile_content: { Args: { p_profile_id: string }; Returns: boolean };
      can_view_wave: { Args: { p_wave_id: string }; Returns: boolean };
      can_comment_on_wave: { Args: { p_wave_id: string }; Returns: boolean };
      can_request_duet: { Args: { p_wave_id: string }; Returns: boolean };
      can_view_audio_asset: { Args: { p_asset_id: string }; Returns: boolean };
      is_conversation_member: { Args: { p_conversation_id: string }; Returns: boolean };
      can_message: { Args: { p_target_id: string }; Returns: boolean };
      get_or_create_direct_conversation: { Args: { p_other_id: string }; Returns: string };
      enqueue_audio_job: {
        Args: { p_audio_asset_id: string; p_job_type: AudioJobType; p_payload?: Json };
        Returns: number;
      };
      claim_audio_jobs: {
        Args: { p_worker_id: string; p_limit?: number };
        Returns: AudioProcessingJobRow[];
      };
      complete_audio_job: {
        Args: {
          p_job_id: number;
          p_processed_path: string;
          p_peaks: Json;
          p_duration_ms: number;
          p_result?: Json;
          p_enhancement_report?: Json | null;
        };
        Returns: undefined;
      };
      fail_audio_job: { Args: { p_job_id: number; p_error: string }; Returns: undefined };
      set_audio_asset_pitch_score: {
        Args: { p_asset_id: string; p_pitch_score: Json };
        Returns: undefined;
      };
      list_backing_tracks: {
        Args: {
          p_genre?: string | null;
          p_key?: string | null;
          p_bpm_min?: number | null;
          p_bpm_max?: number | null;
          p_cursor?: string | null;
          p_limit?: number;
        };
        Returns: BackingTrackRow[];
      };
      requeue_stalled_audio_jobs: { Args: { p_stall_after?: string }; Returns: number };
      expire_duet_requests: { Args: Record<string, never>; Returns: number };
      flag_suspicious_play_events: { Args: Record<string, never>; Returns: number };
      mark_notifications_read: { Args: { p_notification_ids?: string[] }; Returns: number };
      play_qualifying_ms: { Args: { p_duration_ms: number }; Returns: number };
      record_play_event: {
        Args: {
          p_wave_id: string;
          p_session_id: string;
          p_listened_ms: number;
          p_duration_ms?: number;
          p_completed?: boolean;
        };
        Returns: Json;
      };
      search_profiles: {
        Args: { p_query: string; p_limit?: number; p_offset?: number };
        Returns: ProfileRow[];
      };
      search_waves: {
        Args: { p_query: string; p_limit?: number; p_offset?: number };
        Returns: WaveRow[];
      };
      trending_waves: {
        Args: { p_limit?: number; p_offset?: number; p_max_age_hours?: number };
        Returns: WaveRow[];
      };
      rising_creators: {
        Args: { p_limit?: number; p_offset?: number; p_window_hours?: number };
        Returns: ProfileRow[];
      };
      wave_trending_score: {
        Args: {
          p_play_count: number;
          p_replay_count: number;
          p_save_count: number;
          p_comment_count: number;
          p_share_count: number;
          p_duet_count: number;
          p_published_at: string;
        };
        Returns: number;
      };
      is_moderator: { Args: { p_profile_id?: string }; Returns: boolean };
      claim_report: { Args: { p_report_id: string }; Returns: ReportRow };
      resolve_report: {
        Args: {
          p_report_id: string;
          p_action: ModerationActionType;
          p_note?: string | null;
          p_suspend_until?: string | null;
        };
        Returns: ReportRow;
      };
      dismiss_report: { Args: { p_report_id: string; p_note?: string | null }; Returns: ReportRow };
      creator_overview: { Args: { p_days?: number }; Returns: CreatorOverviewRow[] };
      creator_timeseries: { Args: { p_days?: number }; Returns: CreatorTimeseriesRow[] };
      creator_wave_performance: {
        Args: { p_days?: number; p_limit?: number };
        Returns: CreatorWavePerformanceRow[];
      };
      product_health: { Args: { p_days?: number }; Returns: ProductHealthRow[] };
      list_open_calls: {
        Args: { p_genre?: string | null; p_cursor?: string | null; p_limit?: number };
        Returns: OpenCallRow[];
      };
      answer_open_call: { Args: { p_wave_id: string }; Returns: string };
      duet_tree: {
        Args: { p_root_wave_id: string };
        Returns: DuetTreeNodeRow[];
      };
      list_waves_on_track: {
        Args: { p_track_id: string; p_cursor?: string | null; p_limit?: number };
        Returns: WaveRow[];
      };
      list_challenges: {
        Args: { p_status?: string | null; p_cursor?: string | null; p_limit?: number };
        Returns: ChallengeRow[];
      };
      get_challenge: { Args: { p_slug: string }; Returns: ChallengeRow };
      can_enter_challenge: {
        Args: { p_challenge_id: string; p_wave_id: string };
        Returns: boolean;
      };
      list_challenge_entries: {
        Args: { p_challenge_id: string; p_cursor?: string | null; p_limit?: number };
        Returns: ChallengeEntryRow[];
      };
      enter_challenge: { Args: { p_challenge_id: string; p_wave_id: string }; Returns: string };
      list_waves_by_hashtag: {
        Args: { p_tag: string; p_cursor?: string | null; p_limit?: number };
        Returns: WaveRow[];
      };
      has_pro: { Args: { p_user_id: string }; Returns: boolean };
      /**
       * Both exist since migration 21 (`rate_limits`) but were never called
       * from application code before Wave F — every other rate-limited
       * action goes through a `BEFORE INSERT` trigger instead. `startProCheckout`
       * (`src/app/(app)/settings/pro/actions.ts`) has no natural insert to
       * hang a trigger off (a checkout attempt writes no row until the
       * provider confirms it), so it calls these two directly through the
       * admin client — both are `revoke all from public, anon, authenticated`
       * server-side, so only that context can.
       */
      check_rate_limit: {
        Args: { p_profile_id: string; p_action: string; p_max_count: number; p_window: string };
        Returns: undefined;
      };
      record_rate_limit_event: { Args: { p_profile_id: string; p_action: string }; Returns: undefined };
      get_flow_page: {
        Args: { p_cursor?: Json | null; p_seed?: number; p_limit?: number };
        Returns: FlowFeedRankRow[];
      };
      record_flow_event: {
        Args: { p_wave_id: string; p_kind: string; p_position_ms?: number | null };
        Returns: undefined;
      };
      count_flow_new: { Args: Record<string, never>; Returns: number };
    };
    Enums: {
      profile_privacy: ProfilePrivacy;
      permission_audience: PermissionAudience;
      follow_status: FollowStatus;
      audio_processing_status: AudioProcessingStatus;
      audio_enhancement_preset: AudioEnhancementPreset;
      audio_job_type: AudioJobType;
      audio_job_status: AudioJobStatus;
      backing_track_license: BackingTrackLicense;
      wave_creation_type: WaveCreationType;
      wave_visibility: WaveVisibility;
      content_origin: ContentOrigin;
      collaborator_status: CollaboratorStatus;
      share_channel: ShareChannel;
      duet_request_status: DuetRequestStatus;
      duet_mode: DuetMode;
      conversation_kind: ConversationKind;
      message_kind: MessageKind;
      notification_type: NotificationType;
      report_target_type: ReportTargetType;
      report_reason: ReportReason;
      report_status: ReportStatus;
      moderation_action_type: ModerationActionType;
      challenge_status: ChallengeStatus;
      billing_provider: BillingProvider;
      subscription_status: SubscriptionStatus;
      plan_interval: PlanInterval;
    };
    CompositeTypes: Record<never, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
