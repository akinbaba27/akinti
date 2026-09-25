import { describe, expect, it } from "vitest";

import type { Comment, Profile, Wave } from "@/types/domain";

import { accountDataExportFilename, serializeAccountDataExport } from "./dataExport";

const PROFILE: Profile = {
  id: "11111111-1111-1111-1111-111111111111",
  username: "maria",
  displayName: "Maria Lopez",
  bio: "Singer, songwriter.",
  avatarUrl: null,
  privacy: "public",
  signatureHue: null,
  permissions: { duet: "everyone", message: "everyone", comment: "everyone", defaultWaveVisibility: "everyone" },
  interests: ["Singing", "Songwriting"],
  onboardedAt: "2026-01-01T00:00:00.000Z",
  notificationPreferences: {},
  isModerator: false,
  suspendedUntil: null,
  locale: null,
  counts: { followers: 10, following: 5, waves: 2 },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const WAVE: Wave = {
  id: "22222222-2222-2222-2222-222222222222",
  creatorId: PROFILE.id,
  audioAssetId: "33333333-3333-3333-3333-333333333333",
  title: "Morning voice memo",
  description: "A quick idea.",
  creationType: "recorded",
  visibility: "everyone",
  commentPermission: null,
  duetPermission: null,
  duet: {
    originalWaveId: null,
    parentWaveId: null,
    duetRequestId: null,
    depth: 0,
    mode: null,
    segments: null,
    cypherOrder: null,
  },
  backingTrackId: null,
  contentOrigin: "original",
  tags: ["idea"],
  counts: { plays: 12, replays: 2, comments: 1, saves: 3, shares: 0, duets: 0, echoes: 0 },
  publishedAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  hiddenAt: null,
};

const COMMENT: Comment = {
  id: "44444444-4444-4444-4444-444444444444",
  waveId: "55555555-5555-5555-5555-555555555555",
  authorId: PROFILE.id,
  parentCommentId: null,
  body: "Love this.",
  replyCount: 0,
  createdAt: "2026-02-02T00:00:00.000Z",
  updatedAt: "2026-02-02T00:00:00.000Z",
};

describe("serializeAccountDataExport", () => {
  it("shapes profile, waves and comments into the export document", () => {
    const doc = serializeAccountDataExport({
      profile: PROFILE,
      waves: [WAVE],
      comments: [COMMENT],
      now: () => new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(doc.exportedAt).toBe("2026-03-01T12:00:00.000Z");
    expect(doc.profile).toEqual({
      id: PROFILE.id,
      username: "maria",
      displayName: "Maria Lopez",
      bio: "Singer, songwriter.",
      privacy: "public",
      interests: ["Singing", "Songwriting"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(doc.waves).toEqual([
      {
        id: WAVE.id,
        title: "Morning voice memo",
        description: "A quick idea.",
        creationType: "recorded",
        visibility: "everyone",
        tags: ["idea"],
        counts: WAVE.counts,
        publishedAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    expect(doc.comments).toEqual([
      {
        id: COMMENT.id,
        waveId: COMMENT.waveId,
        parentCommentId: null,
        body: "Love this.",
        createdAt: "2026-02-02T00:00:00.000Z",
      },
    ]);
  });

  it("never leaks fields outside the documented shape (no avatarUrl, no permissions, no audioAssetId)", () => {
    const doc = serializeAccountDataExport({ profile: PROFILE, waves: [WAVE], comments: [COMMENT] });
    expect(doc.profile).not.toHaveProperty("avatarUrl");
    expect(doc.profile).not.toHaveProperty("permissions");
    expect(doc.waves[0]).not.toHaveProperty("audioAssetId");
    expect(doc.waves[0]).not.toHaveProperty("creatorId");
  });

  it("handles an account with no Waves or comments", () => {
    const doc = serializeAccountDataExport({ profile: PROFILE, waves: [], comments: [] });
    expect(doc.waves).toEqual([]);
    expect(doc.comments).toEqual([]);
  });

  it("defaults `now` to the current time when not provided", () => {
    const before = Date.now();
    const doc = serializeAccountDataExport({ profile: PROFILE, waves: [], comments: [] });
    const after = Date.now();
    const exportedAtMs = new Date(doc.exportedAt).getTime();
    expect(exportedAtMs).toBeGreaterThanOrEqual(before);
    expect(exportedAtMs).toBeLessThanOrEqual(after);
  });
});

describe("accountDataExportFilename", () => {
  it("includes the username and an ISO date", () => {
    expect(accountDataExportFilename("maria", new Date("2026-03-01T12:00:00.000Z"))).toBe(
      "akinti-maria-2026-03-01.json",
    );
  });
});
