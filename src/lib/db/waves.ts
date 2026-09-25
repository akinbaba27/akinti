/**
 * `waves` — the primary social object — plus `wave_collaborators`.
 *
 * Every read here rides on RLS (`can_view_wave`), so a private Wave never
 * surfaces through any of these helpers regardless of the query shape. Writes
 * that would let a client forge a counter, duet lineage, or a processing
 * field are rejected by the `waves_guard_insert`/`waves_guard_update`
 * triggers even if this file's input types allowed them through.
 */

import type {
  CreateDuetWaveInput,
  CreateWaveInput,
  InviteCollaboratorInput,
  UpdateWaveInput,
} from "@/lib/validation/waves";
import type { DuetSegment } from "@/lib/duet/ffmpegChain";
import type { Collaborator, CollaboratorStatus, DuetMode, Page, Wave } from "@/types/domain";
import type { Json } from "@/types/database";

import { getProfilesByIds } from "./profiles";
import { toCollaborator, toWave } from "./mappers";
import type { Db } from "./types";
import { buildPage, clampLimit, decodeCursor, encodeCursor, keysetFilter, unwrap, unwrapMaybe } from "./types";

/* ------------------------------------------------------------------------ */
/* Reads                                                                     */
/* ------------------------------------------------------------------------ */

export async function getWaveById(db: Db, waveId: string): Promise<Wave | null> {
  const result = await db
    .from("waves")
    .select("*")
    .eq("id", waveId)
    .is("deleted_at", null)
    .maybeSingle();
  const row = unwrapMaybe("getWaveById", result);
  return row ? toWave(row) : null;
}

export async function getWavesByIds(db: Db, waveIds: string[]): Promise<Wave[]> {
  if (waveIds.length === 0) {
    return [];
  }
  const result = await db.from("waves").select("*").in("id", waveIds).is("deleted_at", null);
  const rows = unwrap("getWavesByIds", { data: result.data ?? [], error: result.error });
  return rows.map(toWave);
}

interface CursorParams {
  limit?: number;
  cursor?: string | null;
}

/**
 * Home feed: Waves from creators `viewerId` follows, newest first (spec s9).
 * Two-step (following ids, then their Waves) rather than a join — simpler
 * against the hand-written `Database` type and easy to cache the first step.
 */
export async function listHomeFeed(db: Db, viewerId: string, params: CursorParams = {}): Promise<Page<Wave>> {
  const limit = clampLimit(params.limit);

  const followingResult = await db
    .from("follows")
    .select("followee_id")
    .eq("follower_id", viewerId)
    .eq("status", "accepted");
  const followingIds = unwrap("listHomeFeed:following", {
    data: followingResult.data ?? [],
    error: followingResult.error,
  }).map((r) => r.followee_id);

  if (followingIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  let query = db
    .from("waves")
    .select("*")
    .in("creator_id", followingIds)
    .is("deleted_at", null)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (params.cursor) {
    query = query.or(keysetFilter("published_at", "id", decodeCursor(params.cursor)));
  }
  const result = await query;
  const rows = unwrap("listHomeFeed", { data: result.data ?? [], error: result.error });
  const page = buildPage(rows, limit, (r) => encodeCursor(r.published_at, r.id));
  return { items: page.items.map(toWave), nextCursor: page.nextCursor };
}

/** A creator's published Waves (Profile → Waves tab, spec s21). */
export async function listProfileWaves(
  db: Db,
  profileId: string,
  params: CursorParams = {},
): Promise<Page<Wave>> {
  const limit = clampLimit(params.limit);
  let query = db
    .from("waves")
    .select("*")
    .eq("creator_id", profileId)
    .is("deleted_at", null)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (params.cursor) {
    query = query.or(keysetFilter("published_at", "id", decodeCursor(params.cursor)));
  }
  const result = await query;
  const rows = unwrap("listProfileWaves", { data: result.data ?? [], error: result.error });
  const page = buildPage(rows, limit, (r) => encodeCursor(r.published_at, r.id));
  return { items: page.items.map(toWave), nextCursor: page.nextCursor };
}

/** A creator's Duets (Profile → Duets tab, spec s21): their Waves of type 'duet'. */
export async function listProfileDuets(
  db: Db,
  profileId: string,
  params: CursorParams = {},
): Promise<Page<Wave>> {
  const limit = clampLimit(params.limit);
  let query = db
    .from("waves")
    .select("*")
    .eq("creator_id", profileId)
    .eq("creation_type", "duet")
    .is("deleted_at", null)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (params.cursor) {
    query = query.or(keysetFilter("published_at", "id", decodeCursor(params.cursor)));
  }
  const result = await query;
  const rows = unwrap("listProfileDuets", { data: result.data ?? [], error: result.error });
  const page = buildPage(rows, limit, (r) => encodeCursor(r.published_at, r.id));
  return { items: page.items.map(toWave), nextCursor: page.nextCursor };
}

/** Every Duet descending from a Wave's root, newest first (spec s15 tree). */
export async function listDuetsOfWave(
  db: Db,
  originalWaveId: string,
  params: CursorParams = {},
): Promise<Page<Wave>> {
  const limit = clampLimit(params.limit);
  let query = db
    .from("waves")
    .select("*")
    .eq("original_wave_id", originalWaveId)
    .is("deleted_at", null)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (params.cursor) {
    query = query.or(keysetFilter("published_at", "id", decodeCursor(params.cursor)));
  }
  const result = await query;
  const rows = unwrap("listDuetsOfWave", { data: result.data ?? [], error: result.error });
  const page = buildPage(rows, limit, (r) => encodeCursor(r.published_at, r.id));
  return { items: page.items.map(toWave), nextCursor: page.nextCursor };
}

/** Direct children only (one tree level), for rendering the immediate branch. */
export async function listDirectDuets(
  db: Db,
  parentWaveId: string,
  params: CursorParams = {},
): Promise<Page<Wave>> {
  const limit = clampLimit(params.limit);
  let query = db
    .from("waves")
    .select("*")
    .eq("parent_wave_id", parentWaveId)
    .is("deleted_at", null)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (params.cursor) {
    query = query.or(keysetFilter("published_at", "id", decodeCursor(params.cursor)));
  }
  const result = await query;
  const rows = unwrap("listDirectDuets", { data: result.data ?? [], error: result.error });
  const page = buildPage(rows, limit, (r) => encodeCursor(r.published_at, r.id));
  return { items: page.items.map(toWave), nextCursor: page.nextCursor };
}

/** Explore → "Open for Duet" lane (spec s10): public Waves accepting requests. */
export async function listOpenForDuet(db: Db, params: CursorParams = {}): Promise<Page<Wave>> {
  const limit = clampLimit(params.limit);
  // duet_permission NULL means "inherit the creator's profile setting", which
  // is never itself 'nobody' as a literal column value — so both NULL and
  // anything other than the literal 'nobody' qualify. Mirrors the partial
  // index predicate on waves_open_for_duet_idx (migration 04).
  let query = db
    .from("waves")
    .select("*")
    .eq("visibility", "everyone")
    .is("deleted_at", null)
    .or("duet_permission.is.null,duet_permission.neq.nobody")
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (params.cursor) {
    query = query.or(keysetFilter("published_at", "id", decodeCursor(params.cursor)));
  }
  const result = await query;
  const rows = unwrap("listOpenForDuet", { data: result.data ?? [], error: result.error });
  const page = buildPage(rows, limit, (r) => encodeCursor(r.published_at, r.id));
  return { items: page.items.map(toWave), nextCursor: page.nextCursor };
}

/** Explore → New (spec s10): every viewable Wave, newest first. */
export async function listNewWaves(db: Db, params: CursorParams = {}): Promise<Page<Wave>> {
  const limit = clampLimit(params.limit);
  let query = db
    .from("waves")
    .select("*")
    .eq("visibility", "everyone")
    .is("deleted_at", null)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (params.cursor) {
    query = query.or(keysetFilter("published_at", "id", decodeCursor(params.cursor)));
  }
  const result = await query;
  const rows = unwrap("listNewWaves", { data: result.data ?? [], error: result.error });
  const page = buildPage(rows, limit, (r) => encodeCursor(r.published_at, r.id));
  return { items: page.items.map(toWave), nextCursor: page.nextCursor };
}

/**
 * Track page → "Waves on this track" (Wave D / spec §4). `list_waves_on_track`
 * (migration 20260905120400) is can_view_wave-filtered per row and keyset
 * paginated the same way as every other RPC-backed list here.
 */
export async function listWavesOnTrack(
  db: Db,
  trackId: string,
  params: { cursor?: string | null; limit?: number } = {},
): Promise<Page<Wave>> {
  const limit = clampLimit(params.limit);
  const result = await db.rpc("list_waves_on_track", {
    p_track_id: trackId,
    p_cursor: params.cursor ?? null,
    p_limit: limit,
  });
  const rows = unwrap("listWavesOnTrack", { data: result.data ?? [], error: result.error });
  const items = rows.map(toWave);
  const nextCursor =
    rows.length === limit ? encodeCursor(items[items.length - 1].publishedAt, items[items.length - 1].id) : null;
  return { items, nextCursor };
}

/** Explore → Trending (spec s10): the deterministic, time-decayed score from migration 14. */
export async function listTrendingWaves(
  db: Db,
  params: { limit?: number; offset?: number; maxAgeHours?: number } = {},
): Promise<Wave[]> {
  const result = await db.rpc("trending_waves", {
    p_limit: clampLimit(params.limit),
    p_offset: Math.max(0, params.offset ?? 0),
    p_max_age_hours: params.maxAgeHours ?? 336,
  });
  const rows = unwrap("listTrendingWaves", { data: result.data ?? [], error: result.error });
  return rows.map(toWave);
}

export async function searchWaves(db: Db, query: string, limit?: number, offset = 0): Promise<Wave[]> {
  const result = await db.rpc("search_waves", {
    p_query: query,
    p_limit: clampLimit(limit),
    p_offset: Math.max(0, offset),
  });
  const rows = unwrap("searchWaves", { data: result.data ?? [], error: result.error });
  return rows.map(toWave);
}

/** Explore → Original (spec s10): `content_origin = 'original'`, mirrors `waves_original_content_published_idx` (migration 18). */
export async function listOriginalWaves(db: Db, params: CursorParams = {}): Promise<Page<Wave>> {
  const limit = clampLimit(params.limit);
  let query = db
    .from("waves")
    .select("*")
    .eq("visibility", "everyone")
    .eq("content_origin", "original")
    .is("deleted_at", null)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (params.cursor) {
    query = query.or(keysetFilter("published_at", "id", decodeCursor(params.cursor)));
  }
  const result = await query;
  const rows = unwrap("listOriginalWaves", { data: result.data ?? [], error: result.error });
  const page = buildPage(rows, limit, (r) => encodeCursor(r.published_at, r.id));
  return { items: page.items.map(toWave), nextCursor: page.nextCursor };
}

/**
 * Explore → Voices / Compositions (spec s10): a tag overlap over `waves.tags`
 * (indexed by `waves_tags_idx`, migration 04). `tags` is free-form up to 8
 * entries per Wave (`src/lib/validation/waves.ts`), but `CreateWaveForm` only
 * ever offers `WAVE_CATEGORY_OPTIONS` (`src/lib/audio/createDraft.ts`),
 * lower-cased on write — so matching against that fixed, lower-cased
 * vocabulary is exhaustive in practice. The exact split lives in
 * `src/lib/feed/categories.ts` (`VOICE_TAGS`/`COMPOSITION_TAGS`) and is
 * documented in `docs/ARCHITECTURE.md`.
 */
export async function listWavesByTags(
  db: Db,
  tags: readonly string[],
  params: CursorParams = {},
): Promise<Page<Wave>> {
  const limit = clampLimit(params.limit);
  if (tags.length === 0) {
    return { items: [], nextCursor: null };
  }
  let query = db
    .from("waves")
    .select("*")
    .eq("visibility", "everyone")
    .is("deleted_at", null)
    .overlaps("tags", tags as string[])
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (params.cursor) {
    query = query.or(keysetFilter("published_at", "id", decodeCursor(params.cursor)));
  }
  const result = await query;
  const rows = unwrap("listWavesByTags", { data: result.data ?? [], error: result.error });
  const page = buildPage(rows, limit, (r) => encodeCursor(r.published_at, r.id));
  return { items: page.items.map(toWave), nextCursor: page.nextCursor };
}

/** A page of a specific creator set's Waves, newest first. Used to compose Explore → Rising from `getRisingCreators`. */
export async function listWavesByCreatorIds(
  db: Db,
  creatorIds: string[],
  params: CursorParams = {},
): Promise<Page<Wave>> {
  const limit = clampLimit(params.limit);
  if (creatorIds.length === 0) {
    return { items: [], nextCursor: null };
  }
  let query = db
    .from("waves")
    .select("*")
    .in("creator_id", creatorIds)
    .eq("visibility", "everyone")
    .is("deleted_at", null)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (params.cursor) {
    query = query.or(keysetFilter("published_at", "id", decodeCursor(params.cursor)));
  }
  const result = await query;
  const rows = unwrap("listWavesByCreatorIds", { data: result.data ?? [], error: result.error });
  const page = buildPage(rows, limit, (r) => encodeCursor(r.published_at, r.id));
  return { items: page.items.map(toWave), nextCursor: page.nextCursor };
}

/**
 * Accepted collaborators for a batch of Waves in one query, keyed by Wave id
 * — used to hydrate a feed page's cards without an N+1 per card (spec s35).
 */
export async function listCollaboratorsForWaves(
  db: Db,
  waveIds: string[],
): Promise<Map<string, Collaborator[]>> {
  const byWave = new Map<string, Collaborator[]>();
  if (waveIds.length === 0) {
    return byWave;
  }
  const result = await db
    .from("wave_collaborators")
    .select("*")
    .in("wave_id", waveIds)
    .eq("status", "accepted")
    .order("created_at", { ascending: true });
  const rows = unwrap("listCollaboratorsForWaves", { data: result.data ?? [], error: result.error });
  for (const row of rows) {
    const collaborator = toCollaborator(row);
    const list = byWave.get(collaborator.waveId);
    if (list) {
      list.push(collaborator);
    } else {
      byWave.set(collaborator.waveId, [collaborator]);
    }
  }
  return byWave;
}

/**
 * Which of `waveIds` the viewer has saved, in one query — hydrates a feed
 * page's `isSaved` state without an N+1 per card (spec s35). `saves` has no
 * dedicated domain file this stage owns (`src/lib/db/saves.ts` belongs to the
 * interactions agent); this is a direct, minimal read of the same table,
 * mirroring how `notifications/actions.ts` reads `wave_collaborators`
 * directly for the same reason.
 */
export async function listSavedWaveIds(db: Db, viewerId: string, waveIds: string[]): Promise<Set<string>> {
  if (waveIds.length === 0) {
    return new Set();
  }
  const result = await db
    .from("saves")
    .select("wave_id")
    .eq("profile_id", viewerId)
    .in("wave_id", waveIds);
  const rows = unwrap("listSavedWaveIds", { data: result.data ?? [], error: result.error });
  return new Set(rows.map((r) => r.wave_id));
}

/**
 * Which of `waveIds` the viewer has Echoed, in one query — same shape and
 * reasoning as `listSavedWaveIds` immediately above (Wave E, `docs/ECHOES.md`).
 * `echoes` has no dedicated domain file this stage owns for batch reads
 * either, for the same reason `listSavedWaveIds` gives.
 */
export async function listEchoedWaveIds(db: Db, viewerId: string, waveIds: string[]): Promise<Set<string>> {
  if (waveIds.length === 0) {
    return new Set();
  }
  const result = await db
    .from("echoes")
    .select("wave_id")
    .eq("profile_id", viewerId)
    .in("wave_id", waveIds);
  const rows = unwrap("listEchoedWaveIds", { data: result.data ?? [], error: result.error });
  return new Set(rows.map((r) => r.wave_id));
}

/* ------------------------------------------------------------------------ */
/* Writes                                                                    */
/* ------------------------------------------------------------------------ */

/** Publish a Recorded or Uploaded Wave. */
export async function createWave(db: Db, creatorId: string, input: CreateWaveInput): Promise<Wave> {
  const result = await db
    .from("waves")
    .insert({
      creator_id: creatorId,
      audio_asset_id: input.audio_asset_id,
      title: input.title,
      description: input.description ?? null,
      creation_type: input.creation_type,
      visibility: input.visibility,
      comment_permission: input.comment_permission,
      duet_permission: input.duet_permission,
      backing_track_id: input.backing_track_id ?? null,
      content_origin: input.content_origin,
      tags: input.tags,
    })
    .select("*")
    .single();
  return toWave(unwrap("createWave", result));
}

/**
 * Wave D — `duet_mode`/`segments` layered onto `CreateDuetWaveInput` (owned
 * by `src/lib/validation/waves.ts`, a file this stage does not touch) via
 * intersection rather than editing that schema directly. `cypher_order` is
 * never accepted here: `waves_derive_duet_lineage` derives it server-side
 * from the parent, exactly like `duet_depth`.
 */
export type CreateDuetWaveInputV2 = CreateDuetWaveInput & {
  duet_mode?: DuetMode;
  /** Required when `duet_mode === 'atisma'`; already validated by `publishDuetWaveSchema` before this is called. */
  segments?: DuetSegment[] | null;
};

/**
 * Publish the Wave produced by a Duet.
 *
 * `waves_guard_insert` (migration 12) independently verifies the referenced
 * `duet_request_id` is ACCEPTED, belongs to the caller, and that
 * `parent_wave_id` matches the request's Wave — this function does not
 * re-implement that check, it only shapes the insert.
 */
export async function createDuetWave(
  db: Db,
  creatorId: string,
  input: CreateDuetWaveInputV2,
): Promise<Wave> {
  const result = await db
    .from("waves")
    .insert({
      creator_id: creatorId,
      audio_asset_id: input.audio_asset_id,
      title: input.title,
      description: input.description ?? null,
      creation_type: "duet",
      visibility: input.visibility,
      comment_permission: input.comment_permission,
      duet_permission: input.duet_permission,
      parent_wave_id: input.parent_wave_id,
      duet_request_id: input.duet_request_id,
      duet_mode: input.duet_mode ?? "layer",
      // `DuetSegment[]` structurally satisfies `Json` (string/number fields
      // only) but isn't nominally assignable to it — see the matching cast
      // in `enqueueDuetMixJob` (src/lib/db/duets.ts).
      segments: (input.duet_mode === "atisma" ? (input.segments ?? null) : null) as unknown as Json,
      content_origin: input.content_origin,
      tags: input.tags,
    })
    .select("*")
    .single();
  const wave = toWave(unwrap("createDuetWave", result));

  if (input.collaborator_id) {
    await inviteCollaborator(db, {
      waveId: wave.id,
      profileId: input.collaborator_id,
      role: null,
    });
  }

  return wave;
}

export async function updateWave(db: Db, waveId: string, input: UpdateWaveInput): Promise<Wave> {
  const result = await db.from("waves").update(input).eq("id", waveId).select("*").single();
  return toWave(unwrap("updateWave", result));
}

/** Soft delete: the Wave is gone from every read path but the audio asset survives. */
export async function deleteWave(db: Db, waveId: string): Promise<void> {
  const result = await db
    .from("waves")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", waveId);
  if (result.error) {
    throw result.error;
  }
}

/* ------------------------------------------------------------------------ */
/* Collaborators (spec s16 — never auto-added, must accept)                 */
/* ------------------------------------------------------------------------ */

export async function inviteCollaborator(db: Db, input: InviteCollaboratorInput): Promise<Collaborator> {
  const result = await db
    .from("wave_collaborators")
    .insert({ wave_id: input.waveId, profile_id: input.profileId, role: input.role })
    .select("*")
    .single();
  return toCollaborator(unwrap("inviteCollaborator", result));
}

export async function respondToCollaboratorInvite(
  db: Db,
  collaboratorRowId: string,
  accept: boolean,
): Promise<Collaborator> {
  const result = await db
    .from("wave_collaborators")
    .update({
      status: (accept ? "accepted" : "declined") as CollaboratorStatus,
      responded_at: new Date().toISOString(),
    })
    .eq("id", collaboratorRowId)
    .select("*")
    .single();
  return toCollaborator(unwrap("respondToCollaboratorInvite", result));
}

export async function removeCollaborator(db: Db, collaboratorRowId: string): Promise<void> {
  const result = await db.from("wave_collaborators").delete().eq("id", collaboratorRowId);
  if (result.error) {
    throw result.error;
  }
}

export async function listWaveCollaborators(db: Db, waveId: string): Promise<Collaborator[]> {
  const result = await db
    .from("wave_collaborators")
    .select("*")
    .eq("wave_id", waveId)
    .order("created_at", { ascending: true });
  const rows = unwrap("listWaveCollaborators", { data: result.data ?? [], error: result.error });
  return rows.map(toCollaborator);
}

/** Hydrate accepted collaborators with their profiles, for the "@a × @b" credit line. */
export async function listWaveCollaboratorProfiles(db: Db, waveId: string) {
  const collaborators = await listWaveCollaborators(db, waveId);
  const accepted = collaborators.filter((c) => c.status === "accepted");
  const profiles = await getProfilesByIds(
    db,
    accepted.map((c) => c.profileId),
  );
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return accepted
    .map((c) => ({ collaborator: c, profile: byId.get(c.profileId) }))
    .filter((entry): entry is { collaborator: Collaborator; profile: NonNullable<typeof entry.profile> } =>
      entry.profile !== undefined,
    );
}
