/**
 * `audio_assets` + the signed-URL strategy for the private `audio` bucket.
 *
 * Processing columns (`processed_path`, `peaks`, `processing_status`, ...) are
 * server-owned: `audio_assets_guard_update` (migration 12) rejects a client
 * attempt to set them directly. The only legitimate writer is
 * `scripts/worker.ts`, through `complete_audio_job` / `fail_audio_job`.
 */

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import {
  AUDIO_BUCKET,
  SIGNED_AUDIO_URL_TTL_SECONDS,
} from "@/lib/supabase/config";
import type { CreateAudioAssetInput } from "@/lib/validation/audio";
import type { AudioAsset, AudioJobType } from "@/types/domain";
import type { AudioAssetRow, Database, Json } from "@/types/database";

import { toAudioAsset } from "./mappers";
import { DatabaseError, NotFoundError, unwrap, unwrapMaybe } from "./types";
import type { Db } from "./types";

/**
 * Columns anon/authenticated may SELECT on `audio_assets` (migration 15 —
 * see docs/AUDIO_ARCHITECTURE.md "Storage security"). `original_path` and
 * `processed_path` are deliberately excluded: they are PRIVATE storage keys
 * and column-level SELECT on them was revoked from every non-service-role.
 * Every read in this file that does NOT go through the admin client must
 * request only these columns — requesting `original_path`/`processed_path`
 * with a caller-scoped client now fails with a Postgres permission error.
 */
const SAFE_AUDIO_ASSET_COLUMNS = [
  "id",
  "owner_id",
  "storage_bucket",
  "duration_ms",
  "mime_type",
  "byte_size",
  "sample_rate",
  "channels",
  "peaks",
  "processing_status",
  "processing_error",
  "enhancement_preset",
  "enhancement_report",
  "checksum_sha256",
  "created_at",
  "updated_at",
  "processed_at",
] as const;

type SafeAudioAssetRow = Omit<AudioAssetRow, "original_path" | "processed_path">;

/** Shape of a Supabase result once we've cast a narrowed `.select(...)` back to a known row type. */
interface SelectResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/** Fills in the redacted path columns so the row can go through `toAudioAsset`. */
function toRedactedAudioAsset(row: SafeAudioAssetRow): AudioAsset {
  return toAudioAsset({ ...row, original_path: "", processed_path: null });
}

/** Register an already-uploaded original file. Kicks off no processing by itself. */
export async function createAudioAsset(
  db: Db,
  ownerId: string,
  input: CreateAudioAssetInput,
): Promise<AudioAsset> {
  const result = await db
    .from("audio_assets")
    .insert({
      id: input.id,
      owner_id: ownerId,
      original_path: input.original_path,
      mime_type: input.mime_type,
      byte_size: input.byte_size,
      duration_ms: input.duration_ms ?? null,
      sample_rate: input.sample_rate ?? null,
      channels: input.channels ?? null,
      enhancement_preset: input.enhancement_preset,
      checksum_sha256: input.checksum_sha256 ?? null,
    })
    .select(SAFE_AUDIO_ASSET_COLUMNS.join(","))
    .single();
  const row = unwrap(
    "createAudioAsset",
    result as unknown as SelectResult<SafeAudioAssetRow>,
  );
  // `original_path` is never re-selected (column-level SELECT is revoked for
  // anon/authenticated) — we already know it, we just wrote it.
  return toAudioAsset({ ...row, original_path: input.original_path, processed_path: null });
}

/**
 * A non-privileged read: every column EXCEPT the two raw storage paths.
 * Suitable for anything a viewer (owner or not) may see — processing state,
 * peaks, duration. Never returns a usable `originalPath`/`processedPath`;
 * those come only from `mintSignedAudioUrl`/`mintPlaybackUrl` below.
 */
export async function getAudioAssetById(db: Db, assetId: string): Promise<AudioAsset | null> {
  const result = await db
    .from("audio_assets")
    .select(SAFE_AUDIO_ASSET_COLUMNS.join(","))
    .eq("id", assetId)
    .maybeSingle();
  const row = unwrapMaybe(
    "getAudioAssetById",
    result as unknown as SelectResult<SafeAudioAssetRow>,
  );
  return row ? toRedactedAudioAsset(row) : null;
}

/**
 * Batched form of `getAudioAssetById` — one round trip for every id, exactly
 * like `getProfilesByIds` (`src/lib/db/profiles.ts`). `hydrateFlow.ts`
 * (Flow) used to call `getAudioAssetById` once per Wave in a `Promise.all`,
 * ten round trips per page instead of one (review3 finding 19).
 */
export async function getAudioAssetsByIds(db: Db, assetIds: string[]): Promise<AudioAsset[]> {
  if (assetIds.length === 0) {
    return [];
  }
  const result = await db
    .from("audio_assets")
    .select(SAFE_AUDIO_ASSET_COLUMNS.join(","))
    .in("id", assetIds);
  const rows = unwrap(
    "getAudioAssetsByIds",
    { data: (result.data ?? []) as unknown as SafeAudioAssetRow[], error: result.error },
  );
  return rows.map(toRedactedAudioAsset);
}

/**
 * Authorize, without ever selecting the path columns: `can_view_audio_asset`
 * is `security definer`, so it reads `audio_assets` with the *function
 * owner's* privileges, not the caller's — calling it does not require the
 * caller to hold column-level SELECT on anything. Existence and visibility
 * are deliberately indistinguishable here (see the file-level doc below).
 */
/**
 * True when `assetId` is the instrumental of a backing track this caller is
 * allowed to see.
 *
 * `can_view_audio_asset` grants access three ways — you own the asset, it
 * hangs off a Wave you may see, or it arrived in a conversation you are in. A
 * backing track is none of those, so every curated instrumental in the library
 * was unreachable to everyone except the seed account that uploaded it. That
 * silently emptied the whole feature (see `listBackingTrackCards`).
 *
 * The check itself runs through the caller's own RLS-scoped client, so
 * `backing_tracks_select` (`is_curated OR open_for_vocals OR uploader_id =
 * auth.uid()`) is what decides the answer — this adds no visibility that the
 * caller did not already have on the track row. `is_curated OR
 * open_for_vocals` is then re-asserted here so that merely *owning* an
 * unshared upload is not what unlocks playback for others: a private
 * instrumental stays private, exactly as `requireBackingTrack` already
 * insists.
 */
async function canViewBackingTrackAsset(db: Db, assetId: string): Promise<boolean> {
  const result = await db
    .from("backing_tracks")
    .select("id,is_curated,open_for_vocals")
    .eq("audio_asset_id", assetId)
    .limit(1)
    .maybeSingle();
  if (result.error) {
    // A read error here must not be mistaken for "authorized".
    return false;
  }
  const row = result.data;
  return Boolean(row && (row.is_curated || row.open_for_vocals));
}

async function assertCanViewAudioAsset(db: Db, assetId: string): Promise<void> {
  const result = await db.rpc("can_view_audio_asset", { p_asset_id: assetId });
  if (result.error) {
    throw new DatabaseError("can_view_audio_asset", result.error);
  }
  if (result.data) {
    return;
  }
  if (await canViewBackingTrackAsset(db, assetId)) {
    return;
  }
  throw new NotFoundError("audio asset");
}

/** Privileged read of ONLY the two storage paths, via the service-role client. */
async function getAudioAssetPathsPrivileged(
  admin: SupabaseClient<Database>,
  assetId: string,
): Promise<{ originalPath: string; processedPath: string | null } | null> {
  const result = await admin
    .from("audio_assets")
    .select("original_path,processed_path")
    .eq("id", assetId)
    .maybeSingle();
  const row = unwrapMaybe(
    "getAudioAssetPathsPrivileged",
    result as unknown as SelectResult<Pick<AudioAssetRow, "original_path" | "processed_path">>,
  );
  return row ? { originalPath: row.original_path, processedPath: row.processed_path } : null;
}

/** Change the enhancement preset before (re)enqueuing processing. */
export async function updateAudioAssetPreset(
  db: Db,
  assetId: string,
  preset: AudioAsset["enhancementPreset"],
): Promise<AudioAsset> {
  const result = await db
    .from("audio_assets")
    .update({ enhancement_preset: preset })
    .eq("id", assetId)
    .select(SAFE_AUDIO_ASSET_COLUMNS.join(","))
    .single();
  const row = unwrap(
    "updateAudioAssetPreset",
    result as unknown as SelectResult<SafeAudioAssetRow>,
  );
  return toRedactedAudioAsset(row);
}

export async function deleteAudioAsset(db: Db, assetId: string): Promise<void> {
  const result = await db.from("audio_assets").delete().eq("id", assetId);
  if (result.error) {
    throw result.error;
  }
}

/**
 * Mark an asset `failed` before any processing job exists — e.g. the
 * server-side magic-byte check in `createUploadTicket`'s `finalizeUpload`
 * step rejecting the uploaded bytes. Service-role only: `audio_assets`'s
 * hand-written `Update` type (`src/types/database.ts`) deliberately omits
 * every processing column so an ordinary client can never set them by
 * accident (mirrors the runtime `audio_assets_guard_update` trigger). This
 * is the one legitimate exception, gated by requiring the admin client at
 * the type level, exactly like `getAudioAssetPathsPrivileged` above.
 */
export async function markAudioAssetFailed(
  admin: SupabaseClient<Database>,
  assetId: string,
  reason: string,
): Promise<void> {
  // The hand-written `Update` type for `audio_assets` only lists columns an
  // ordinary client may touch, so it has no slot for `processing_status`/
  // `processing_error` — that's intentional (see the doc comment above), and
  // the escape hatch is a type-only assertion: it changes nothing about what
  // is actually sent over the wire, only what the compiler will accept here.
  const payload = { processing_status: "failed", processing_error: reason } as unknown as Partial<
    Pick<AudioAssetRow, "duration_ms" | "sample_rate" | "channels" | "enhancement_preset">
  >;
  const result = await admin.from("audio_assets").update(payload).eq("id", assetId);
  if (result.error) {
    throw new DatabaseError("markAudioAssetFailed", result.error);
  }
}

/**
 * Queue background processing for a Recorded/Uploaded Wave (spec s19).
 *
 * `advancedEq` rides along in the job payload for forward-compatibility —
 * `scripts/worker.ts` does not apply it yet (only the six named presets are
 * implemented as real ffmpeg filter chains today); it is stored so a future
 * worker change can pick it up without another schema/call-site change.
 */
export async function enqueueAudioProcessing(
  db: Db,
  assetId: string,
  preset: AudioAsset["enhancementPreset"] = "natural",
  advancedEq?: Record<string, number> | null,
): Promise<number> {
  const result = await db.rpc("enqueue_audio_job", {
    p_audio_asset_id: assetId,
    p_job_type: "process_audio" satisfies AudioJobType,
    p_payload: { preset, advanced_eq: advancedEq ?? null } satisfies Json,
  });
  return unwrap("enqueueAudioProcessing", result);
}

/** Queue the server-side Duet mixdown (spec s15: never trust client mixing). */
export async function enqueueDuetMix(
  db: Db,
  newTakeAssetId: string,
  referenceAssetId: string,
  offsetMs: number,
  preset: AudioAsset["enhancementPreset"] = "studio",
): Promise<number> {
  const result = await db.rpc("enqueue_audio_job", {
    p_audio_asset_id: newTakeAssetId,
    p_job_type: "mix_duet" satisfies AudioJobType,
    p_payload: {
      preset,
      reference_asset_id: referenceAssetId,
      offset_ms: offsetMs,
    } satisfies Json,
  });
  return unwrap("enqueueDuetMix", result);
}

export type SignedAudioVariant = "original" | "processed";

export interface SignedAudioUrl {
  url: string;
  expiresAt: string;
}

async function signPath(
  admin: SupabaseClient<Database>,
  path: string,
  ttlSeconds: number = SIGNED_AUDIO_URL_TTL_SECONDS,
): Promise<SignedAudioUrl> {
  const { data, error } = await admin.storage.from(AUDIO_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data) {
    throw error ?? new Error("Failed to sign audio URL");
  }
  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}

/**
 * Mint a short-lived signed URL for a private audio object.
 *
 * Authorization happens in two layers, both required:
 *  1. `db` (the caller's RLS-scoped client) calls `can_view_audio_asset()` —
 *     a `security definer` RPC, so it needs no column-level SELECT privilege
 *     of its own. This alone throws `NotFoundError` for anyone who should not
 *     see it; existence and visibility are deliberately indistinguishable.
 *  2. Only after that succeeds do we read the raw storage path — with
 *     `admin` (service role), the only client anon/authenticated column
 *     grants (migration 15) and the storage bucket's owner-only object
 *     policies (migration 13) both allow to reach it — and mint the URL.
 */
export async function mintSignedAudioUrl(
  db: Db,
  admin: SupabaseClient<Database>,
  assetId: string,
  variant: SignedAudioVariant,
): Promise<SignedAudioUrl> {
  await assertCanViewAudioAsset(db, assetId);

  const paths = await getAudioAssetPathsPrivileged(admin, assetId);
  if (!paths) {
    throw new NotFoundError("audio asset");
  }

  const path = variant === "original" ? paths.originalPath : paths.processedPath;
  if (!path) {
    throw new NotFoundError(`audio asset ${variant} file`);
  }

  return signPath(admin, path);
}

/** Prefer the processed file once it exists; fall back to the original while pending. */
export async function mintPlaybackUrl(
  db: Db,
  admin: SupabaseClient<Database>,
  assetId: string,
): Promise<SignedAudioUrl & { variant: SignedAudioVariant }> {
  await assertCanViewAudioAsset(db, assetId);

  const paths = await getAudioAssetPathsPrivileged(admin, assetId);
  if (!paths) {
    throw new NotFoundError("audio asset");
  }

  const variant: SignedAudioVariant = paths.processedPath ? "processed" : "original";
  const path = variant === "processed" ? (paths.processedPath as string) : paths.originalPath;
  const signed = await signPath(admin, path);
  return { ...signed, variant };
}
