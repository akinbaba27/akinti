import { describe, expect, it } from "vitest";

import { buildDuetTree, computeCypherOrder, computeDuetTreeStats, type DuetChainRow } from "./chain";
import type { Profile, Wave } from "@/types/domain";

function stubWave(id: string, overrides: Partial<Wave> = {}): Wave {
  return {
    id,
    creatorId: "creator",
    audioAssetId: "asset",
    title: "Wave " + id,
    description: null,
    creationType: "recorded",
    visibility: "everyone",
    commentPermission: null,
    duetPermission: null,
    duet: { originalWaveId: null, parentWaveId: null, duetRequestId: null, depth: 0, mode: null, segments: null, cypherOrder: null },
    backingTrackId: null,
    contentOrigin: "original",
    tags: [],
    counts: { plays: 0, replays: 0, comments: 0, saves: 0, shares: 0, duets: 0, echoes: 0 },
    publishedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    hiddenAt: null,
    ...overrides,
  };
}

function stubProfile(id: string): Profile {
  return {
    id,
    username: id,
    displayName: null,
    bio: null,
    avatarUrl: null,
    privacy: "public",
    signatureHue: null,
    permissions: { duet: "everyone", message: "everyone", comment: "everyone", defaultWaveVisibility: "everyone" },
    interests: [],
    onboardedAt: null,
    notificationPreferences: {},
    isModerator: false,
    suspendedUntil: null,
    locale: null,
    counts: { followers: 0, following: 0, waves: 0 },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("buildDuetTree", () => {
  it("nests children under their parent and treats the parentless row as root", () => {
    const rows: DuetChainRow[] = [
      { waveId: "root", parentWaveId: null, creatorId: "a", depth: 0 },
      { waveId: "childA", parentWaveId: "root", creatorId: "b", depth: 1 },
      { waveId: "childB", parentWaveId: "root", creatorId: "c", depth: 1 },
      { waveId: "grandchild", parentWaveId: "childA", creatorId: "d", depth: 2 },
    ];
    const wavesById = new Map(["root", "childA", "childB", "grandchild"].map((id) => [id, stubWave(id)]));
    const creatorsById = new Map(["a", "b", "c", "d"].map((id) => [id, stubProfile(id)]));

    const [root] = buildDuetTree(rows, wavesById, creatorsById);
    expect(root.wave.id).toBe("root");
    expect(root.children.map((c) => c.wave.id).sort()).toEqual(["childA", "childB"]);
    const childA = root.children.find((c) => c.wave.id === "childA")!;
    expect(childA.children.map((c) => c.wave.id)).toEqual(["grandchild"]);
    expect(childA.children[0].children).toEqual([]);
  });

  it("skips a row missing from the hydration maps rather than throwing", () => {
    const rows: DuetChainRow[] = [{ waveId: "root", parentWaveId: null, creatorId: "a", depth: 0 }];
    const tree = buildDuetTree(rows, new Map(), new Map());
    expect(tree).toEqual([]);
  });

  it("treats a row whose parent isn't in the rowset as its own root", () => {
    const rows: DuetChainRow[] = [{ waveId: "orphan", parentWaveId: "missing-parent", creatorId: "a", depth: 3 }];
    const wavesById = new Map([["orphan", stubWave("orphan")]]);
    const creatorsById = new Map([["a", stubProfile("a")]]);
    const tree = buildDuetTree(rows, wavesById, creatorsById);
    expect(tree).toHaveLength(1);
    expect(tree[0].wave.id).toBe("orphan");
  });
});

describe("computeDuetTreeStats", () => {
  it("computes chain length, direct/total duets, leaves and branch counts", () => {
    const rows: DuetChainRow[] = [
      { waveId: "root", parentWaveId: null, creatorId: "a", depth: 0 },
      { waveId: "childA", parentWaveId: "root", creatorId: "b", depth: 1 },
      { waveId: "childB", parentWaveId: "root", creatorId: "c", depth: 1 },
      { waveId: "grandchild", parentWaveId: "childA", creatorId: "d", depth: 2 },
    ];
    const wavesById = new Map(["root", "childA", "childB", "grandchild"].map((id) => [id, stubWave(id)]));
    const creatorsById = new Map(["a", "b", "c", "d"].map((id) => [id, stubProfile(id)]));
    const tree = buildDuetTree(rows, wavesById, creatorsById);

    const stats = computeDuetTreeStats(tree);
    expect(stats.totalWaves).toBe(4);
    expect(stats.totalDuets).toBe(3);
    expect(stats.directDuets).toBe(2);
    expect(stats.chainLength).toBe(3);
    expect(stats.leafWaveIds.sort()).toEqual(["childB", "grandchild"]);
    expect(stats.branchCounts).toEqual({ root: 2, childA: 1, childB: 0, grandchild: 0 });
  });

  it("returns zeroed stats for an empty forest", () => {
    const stats = computeDuetTreeStats([]);
    expect(stats).toEqual({
      totalWaves: 0,
      totalDuets: 0,
      directDuets: 0,
      chainLength: 0,
      leafWaveIds: [],
      branchCounts: {},
    });
  });

  it("gives a lone root a chain length of 1", () => {
    const wavesById = new Map([["root", stubWave("root")]]);
    const creatorsById = new Map([["a", stubProfile("a")]]);
    const tree = buildDuetTree([{ waveId: "root", parentWaveId: null, creatorId: "a", depth: 0 }], wavesById, creatorsById);
    expect(computeDuetTreeStats(tree).chainLength).toBe(1);
  });
});

describe("computeCypherOrder", () => {
  it("assigns 2 to the first cypher Duet off a non-cypher parent", () => {
    expect(computeCypherOrder({ creationType: "recorded", duetMode: null, cypherOrder: null })).toBe(2);
    expect(computeCypherOrder(null)).toBe(2);
  });

  it("increments from the parent's own cypher order when the parent is itself a cypher Duet", () => {
    expect(computeCypherOrder({ creationType: "duet", duetMode: "cypher", cypherOrder: 2 })).toBe(3);
    expect(computeCypherOrder({ creationType: "duet", duetMode: "cypher", cypherOrder: 3 })).toBe(4);
  });

  it("throws once a 5th participant would be added", () => {
    expect(() => computeCypherOrder({ creationType: "duet", duetMode: "cypher", cypherOrder: 4 })).toThrow(
      /limited to 4 participants/,
    );
  });

  it("treats a duet parent in a different mode (layer/atisma) as a fresh start, not a continuation", () => {
    expect(computeCypherOrder({ creationType: "duet", duetMode: "layer", cypherOrder: null })).toBe(2);
  });
});
