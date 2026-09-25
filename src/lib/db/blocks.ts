/**
 * `blocks`. Directional in storage, symmetric in effect — `is_blocked_between`
 * (migration 10) is what every other authorization check calls, never a raw
 * `blocks` row. Inserting a block also severs any follow/duet-request state in
 * both directions (see `blocks_after_insert` trigger, migration 12).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import type { Block, Profile } from "@/types/domain";

import { toProfile } from "./mappers";
import type { Db } from "./types";
import { unwrap, unwrapList } from "./types";

function toBlock(row: { blocker_id: string; blocked_id: string; created_at: string }): Block {
  return { blockerId: row.blocker_id, blockedId: row.blocked_id, createdAt: row.created_at };
}

export async function blockProfile(db: Db, blockerId: string, blockedId: string): Promise<void> {
  const result = await db
    .from("blocks")
    .upsert(
      { blocker_id: blockerId, blocked_id: blockedId },
      // ON CONFLICT DO NOTHING, not DO UPDATE: blocking someone already
      // blocked has to be a no-op, and `blocks` has SELECT/INSERT/DELETE
      // policies but no UPDATE one, so the DO UPDATE form failed with 42501
      // "new row violates row-level security policy".
      { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true },
    );
  if (result.error) {
    throw result.error;
  }
}

export async function unblockProfile(db: Db, blockerId: string, blockedId: string): Promise<void> {
  const result = await db
    .from("blocks")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);
  if (result.error) {
    throw result.error;
  }
}

/** Accounts `blockerId` has blocked. RLS restricts this to the caller's own list. */
export async function listBlockedProfiles(db: Db, blockerId: string): Promise<Block[]> {
  const result = await db
    .from("blocks")
    .select("*")
    .eq("blocker_id", blockerId)
    .order("created_at", { ascending: false });
  const rows = unwrapList("listBlockedProfiles", result);
  return rows.map(toBlock);
}

export async function isBlockedBetween(db: Db, a: string, b: string): Promise<boolean> {
  const result = await db.rpc("is_blocked_between", { a, b });
  return unwrap("isBlockedBetween", result);
}

/**
 * The blocker's own blocked list, with each account's basic identity
 * (avatar, username, display name) hydrated for the Safety settings page
 * (spec §25/§26).
 *
 * Migration 17 (`20260903121700_profile_visibility_blocker_exception.sql`)
 * narrowed `can_view_profile()` from symmetric to directional: the blocked
 * party still can never view the blocker, but the blocker retains identity
 * visibility of who they blocked. That makes this a plain RLS-scoped read —
 * the earlier admin-client workaround (fetching identity with the
 * service-role client because `profiles_select` used to hide blocked rows
 * from the blocker too) is no longer needed. `admin` is accepted for call-site
 * compatibility but intentionally unused.
 */
export async function listBlockedProfilesWithIdentity(
  db: Db,
  admin: SupabaseClient<Database>,
  blockerId: string,
): Promise<Profile[]> {
  void admin;
  const blocks = await listBlockedProfiles(db, blockerId);
  if (blocks.length === 0) {
    return [];
  }
  const ids = blocks.map((b) => b.blockedId);
  const result = await db.from("profiles").select("*").in("id", ids);
  const rows = unwrap("listBlockedProfilesWithIdentity", {
    data: result.data ?? [],
    error: result.error,
  });
  const byId = new Map(rows.map((row) => [row.id, toProfile(row)]));
  // Preserve `listBlockedProfiles`' most-recently-blocked-first order.
  return ids.map((id) => byId.get(id)).filter((p): p is Profile => p !== undefined);
}
