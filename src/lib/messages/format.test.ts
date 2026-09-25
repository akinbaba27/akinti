import { describe, expect, it } from "vitest";
// `use-intl/core` rather than `next-intl`: next-intl re-exports
// `createTranslator` via `export * from "use-intl/core"` and that star
// re-export does not survive Vitest's resolution. Test-only, same locked
// version — see the identical note in `src/lib/notifications/format.test.ts`.
import { createTranslator } from "use-intl/core";

import en from "@/messages/en.json";
import tr from "@/messages/tr.json";
import type { Message } from "@/types/domain";

import {
  formatMessagePreview,
  formatMessageTime,
  groupMessagesByDay,
  shouldGroupWithPrevious,
} from "./format";

/** Real translators over the shipped message files, so these stay assertions about real copy. */
const t = createTranslator({ locale: "en", messages: en, namespace: "MessageFormat" });
const tTr = createTranslator({ locale: "tr", messages: tr, namespace: "MessageFormat" });

const VIEWER = "viewer-1";
const OTHER = "other-1";

function baseMessage(overrides: Partial<Message>): Message {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    senderId: OTHER,
    kind: "text",
    body: "Hey there",
    audioAssetId: null,
    sharedWaveId: null,
    duetRequestId: null,
    createdAt: "2026-06-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("formatMessagePreview", () => {
  it("shows a placeholder for a conversation with no messages", () => {
    expect(formatMessagePreview(null, VIEWER, t)).toBe("No messages yet");
  });

  it("previews a text message from the other person as-is", () => {
    const result = formatMessagePreview(baseMessage({ body: "Hello!" }), VIEWER, t);
    expect(result).toBe("Hello!");
  });

  it("prefixes the viewer's own messages with 'You:'", () => {
    const result = formatMessagePreview(baseMessage({ senderId: VIEWER, body: "Hi back" }), VIEWER, t);
    expect(result).toBe("You: Hi back");
  });

  it("truncates a long text body", () => {
    const long = "a".repeat(120);
    const result = formatMessagePreview(baseMessage({ body: long }), VIEWER, t);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThan(long.length);
  });

  it("previews an audio message by kind", () => {
    const result = formatMessagePreview(
      baseMessage({ kind: "audio", body: null, audioAssetId: "asset-1" }),
      VIEWER,
      t,
    );
    expect(result).toContain("Audio message");
  });

  it("previews a shared Wave by kind", () => {
    const result = formatMessagePreview(
      baseMessage({ kind: "wave_share", body: null, sharedWaveId: "wave-1" }),
      VIEWER,
      t,
    );
    expect(result).toBe("Wave shared");
  });

  it("previews a Duet Request by kind", () => {
    const result = formatMessagePreview(
      baseMessage({ kind: "duet_request", body: null, duetRequestId: "req-1" }),
      VIEWER,
      t,
    );
    expect(result).toBe("Duet Request");
  });
});

describe("groupMessagesByDay", () => {
  const now = new Date("2026-06-03T18:00:00.000Z");

  it("groups messages from the same calendar day together", () => {
    const messages = [
      baseMessage({ id: "a", createdAt: "2026-06-03T09:00:00.000Z" }),
      baseMessage({ id: "b", createdAt: "2026-06-03T10:00:00.000Z" }),
    ];
    const groups = groupMessagesByDay(messages, t, "en", now);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Today");
    expect(groups[0].messages.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("splits messages across separate days, oldest group first", () => {
    const messages = [
      baseMessage({ id: "a", createdAt: "2026-06-01T09:00:00.000Z" }),
      baseMessage({ id: "b", createdAt: "2026-06-03T10:00:00.000Z" }),
    ];
    const groups = groupMessagesByDay(messages, t, "en", now);
    expect(groups).toHaveLength(2);
    expect(groups[0].messages[0].id).toBe("a");
    expect(groups[1].messages[0].id).toBe("b");
  });

  it("labels yesterday and today distinctly", () => {
    const messages = [
      baseMessage({ id: "a", createdAt: "2026-06-02T09:00:00.000Z" }),
      baseMessage({ id: "b", createdAt: "2026-06-03T09:00:00.000Z" }),
    ];
    const groups = groupMessagesByDay(messages, t, "en", now);
    expect(groups.map((g) => g.label)).toEqual(["Yesterday", "Today"]);
  });

  it("sorts unordered input into ascending order before grouping", () => {
    const messages = [
      baseMessage({ id: "b", createdAt: "2026-06-03T10:00:00.000Z" }),
      baseMessage({ id: "a", createdAt: "2026-06-03T09:00:00.000Z" }),
    ];
    const groups = groupMessagesByDay(messages, t, "en", now);
    expect(groups[0].messages.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("returns an empty array for no messages", () => {
    expect(groupMessagesByDay([], t, "en", now)).toEqual([]);
  });
});

describe("formatMessageTime", () => {
  it("formats a timestamp as a short time", () => {
    const result = formatMessageTime("2026-06-01T14:05:00.000Z", "en");
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toContain("NaN");
  });

  it("returns an empty string for an invalid timestamp", () => {
    expect(formatMessageTime("not-a-date", "en")).toBe("");
  });
});

describe("shouldGroupWithPrevious", () => {
  it("does not group the first message in a thread", () => {
    expect(shouldGroupWithPrevious(baseMessage({}), null)).toBe(false);
  });

  it("groups two consecutive messages from the same sender within the gap window", () => {
    const previous = baseMessage({ id: "a", createdAt: "2026-06-01T12:00:00.000Z" });
    const current = baseMessage({ id: "b", createdAt: "2026-06-01T12:01:00.000Z" });
    expect(shouldGroupWithPrevious(current, previous)).toBe(true);
  });

  it("does not group messages from different senders", () => {
    const previous = baseMessage({ id: "a", senderId: VIEWER, createdAt: "2026-06-01T12:00:00.000Z" });
    const current = baseMessage({ id: "b", senderId: OTHER, createdAt: "2026-06-01T12:01:00.000Z" });
    expect(shouldGroupWithPrevious(current, previous)).toBe(false);
  });

  it("does not group messages farther apart than the gap window", () => {
    const previous = baseMessage({ id: "a", createdAt: "2026-06-01T12:00:00.000Z" });
    const current = baseMessage({ id: "b", createdAt: "2026-06-01T12:30:00.000Z" });
    expect(shouldGroupWithPrevious(current, previous)).toBe(false);
  });
});

describe("locale handling", () => {
  it("translates every preview kind for a Turkish reader", () => {
    expect(formatMessagePreview(null, VIEWER, tTr)).toBe("Henüz mesaj yok");
    expect(formatMessagePreview(baseMessage({ kind: "audio", body: null }), VIEWER, tTr)).toContain(
      "Sesli mesaj",
    );
    expect(formatMessagePreview(baseMessage({ kind: "wave_share", body: null }), VIEWER, tTr)).toBe(
      "Wave paylaşıldı",
    );
    expect(formatMessagePreview(baseMessage({ kind: "duet_request", body: null }), VIEWER, tTr)).toBe(
      "Duet isteği",
    );
    expect(
      formatMessagePreview(baseMessage({ senderId: VIEWER, body: "Selam" }), VIEWER, tTr),
    ).toBe("Sen: Selam");
  });

  it("labels day separators in Turkish", () => {
    const now = new Date("2026-06-02T12:00:00.000Z");
    const today = groupMessagesByDay([baseMessage({ createdAt: now.toISOString() })], tTr, "tr", now);
    expect(today[0].label).toBe("Bugün");

    const yesterday = groupMessagesByDay(
      [baseMessage({ createdAt: "2026-06-01T12:00:00.000Z" })],
      tTr,
      "tr",
      now,
    );
    expect(yesterday[0].label).toBe("Dün");
  });

  it("formats weekday and date separators in the reader's locale, not always English", () => {
    const now = new Date("2026-06-05T12:00:00.000Z");
    const threeDaysBack = [baseMessage({ createdAt: "2026-06-02T12:00:00.000Z" })];
    const enLabel = groupMessagesByDay(threeDaysBack, t, "en", now)[0].label;
    const trLabel = groupMessagesByDay(threeDaysBack, tTr, "tr", now)[0].label;
    expect(enLabel).toBe("Tuesday");
    expect(trLabel).toBe("Salı");
  });

  it("formats bubble times in the reader's locale", () => {
    // en-US is 12-hour with an AM/PM marker; tr-TR is 24-hour with neither.
    const enTime = formatMessageTime("2026-06-01T14:05:00.000Z", "en-US");
    const trTime = formatMessageTime("2026-06-01T14:05:00.000Z", "tr-TR");
    expect(enTime).toMatch(/AM|PM/);
    expect(trTime).not.toMatch(/AM|PM/);
  });
});
