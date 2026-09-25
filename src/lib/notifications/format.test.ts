import { describe, expect, it } from "vitest";
// `use-intl/core`, not `next-intl`: next-intl re-exports `createTranslator`
// with `export * from "use-intl/core"`, and that star re-export does not
// survive Vitest's module resolution (here `next-intl`'s `createTranslator` is
// `undefined` while `use-intl/core`'s is a function). Not a new dependency —
// `use-intl` is next-intl's own core package, installed at the same locked
// version, and this import is test-only.
import { createTranslator } from "use-intl/core";

import { routes } from "@/config/routes";
import en from "@/messages/en.json";
import tr from "@/messages/tr.json";
import type { NotificationType, NotificationWithActor, Profile } from "@/types/domain";

import { formatNotification } from "./format";

/**
 * Real next-intl translators over the shipped message files, not stubs. That
 * keeps every assertion below an assertion about copy users actually see, and
 * makes this suite fail if a `NotificationFormat` key goes missing from either
 * locale or an ICU plural is malformed — which is the class of gap that let
 * the notification list render in English inside a Turkish session
 * (2026-09-25 audit).
 */
const t = createTranslator({ locale: "en", messages: en, namespace: "NotificationFormat" });
const tTr = createTranslator({ locale: "tr", messages: tr, namespace: "NotificationFormat" });

const ACTOR: Profile = {
  id: "actor-1",
  username: "ada",
  displayName: "Ada",
  bio: null,
  avatarUrl: null,
  privacy: "public",
  signatureHue: null,
  permissions: {
    duet: "everyone",
    message: "everyone",
    comment: "everyone",
    defaultWaveVisibility: "everyone",
  },
  interests: [],
  onboardedAt: null,
  notificationPreferences: {},
  isModerator: false,
  suspendedUntil: null,
  locale: null,
  counts: { followers: 0, following: 0, waves: 0 },
  createdAt: "2026-01-01T00:00:00.000Z",
};

function baseNotification(overrides: Partial<NotificationWithActor>): NotificationWithActor {
  return {
    id: "notif-1",
    recipientId: "recipient-1",
    type: "follow",
    actorId: ACTOR.id,
    waveId: null,
    commentId: null,
    duetRequestId: null,
    conversationId: null,
    messageId: null,
    groupKey: "follow:recipient-1",
    count: 1,
    readAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    actor: ACTOR,
    ...overrides,
  };
}

describe("formatNotification", () => {
  it("formats a follow notification, linking to the actor's profile", () => {
    const result = formatNotification(baseNotification({ type: "follow" }), t);
    expect(result.title).toBe("Ada started following you");
    expect(result.href).toBe(routes.profile("ada"));
  });

  it("formats a follow request", () => {
    const result = formatNotification(baseNotification({ type: "follow_request" }), t);
    expect(result.title).toBe("Ada asked to follow you");
    expect(result.href).toBe(routes.profile("ada"));
  });

  it("formats a comment notification, linking to the Wave", () => {
    const result = formatNotification(
      baseNotification({ type: "comment", waveId: "wave-1", commentId: "comment-1" }),
      t,
    );
    expect(result.title).toBe("Ada commented on your Wave");
    expect(result.href).toBe(routes.wave("wave-1"));
  });

  it("formats a comment reply", () => {
    const result = formatNotification(
      baseNotification({ type: "comment_reply", waveId: "wave-1", commentId: "comment-2" }),
      t,
    );
    expect(result.title).toBe("Ada replied to your comment");
    expect(result.href).toBe(routes.wave("wave-1"));
  });

  it("formats a save notification", () => {
    const result = formatNotification(baseNotification({ type: "save", waveId: "wave-1" }), t);
    expect(result.title).toBe("Ada saved your Wave");
    expect(result.href).toBe(routes.wave("wave-1"));
  });

  it("formats a share notification", () => {
    const result = formatNotification(baseNotification({ type: "share", waveId: "wave-1" }), t);
    expect(result.title).toBe("Ada shared your Wave");
    expect(result.href).toBe(routes.wave("wave-1"));
  });

  it("formats a Duet Request, linking to the Wave in question", () => {
    const result = formatNotification(
      baseNotification({ type: "duet_request", waveId: "wave-1", duetRequestId: "req-1" }),
      t,
    );
    expect(result.title).toBe("Ada requested a Duet with your Wave");
    expect(result.href).toBe(routes.wave("wave-1"));
  });

  it("formats an accepted Duet Request", () => {
    const result = formatNotification(
      baseNotification({ type: "duet_accepted", waveId: "wave-1", duetRequestId: "req-1" }),
      t,
    );
    expect(result.title).toBe("Ada accepted your Duet Request");
    expect(result.href).toBe(routes.wave("wave-1"));
  });

  it("formats a declined Duet Request", () => {
    const result = formatNotification(
      baseNotification({ type: "duet_declined", waveId: "wave-1", duetRequestId: "req-1" }),
      t,
    );
    expect(result.title).toBe("Ada declined your Duet Request");
    expect(result.href).toBe(routes.wave("wave-1"));
  });

  it("formats a published Duet, linking to the new Duet Wave", () => {
    const result = formatNotification(baseNotification({ type: "duet_published", waveId: "duet-wave-1" }), t);
    expect(result.title).toBe("Ada published a Duet using your Wave");
    expect(result.href).toBe(routes.wave("duet-wave-1"));
  });

  it("formats an answered open call, linking to the new Duet Wave", () => {
    const result = formatNotification(baseNotification({ type: "open_call_answered", waveId: "duet-wave-2" }), t);
    expect(result.title).toBe("Ada answered your open Duet call");
    expect(result.href).toBe(routes.wave("duet-wave-2"));
  });

  it("formats a collaborator invitation", () => {
    const result = formatNotification(baseNotification({ type: "collaborator_invite", waveId: "wave-1" }), t);
    expect(result.title).toBe("Ada invited you to collaborate on a Wave");
    expect(result.href).toBe(routes.wave("wave-1"));
  });

  it("formats an accepted collaborator invitation", () => {
    const result = formatNotification(baseNotification({ type: "collaborator_accepted", waveId: "wave-1" }), t);
    expect(result.title).toBe("Ada accepted your collaborator invite");
    expect(result.href).toBe(routes.wave("wave-1"));
  });

  it("formats a message notification, linking to the conversation", () => {
    const result = formatNotification(
      baseNotification({ type: "message", conversationId: "conv-1", messageId: "msg-1" }),
      t,
    );
    expect(result.title).toBe("Ada sent you a message");
    expect(result.href).toBe(routes.conversation("conv-1"));
  });

  it("falls back to the Messages inbox when a message notification has no conversation id", () => {
    const result = formatNotification(baseNotification({ type: "message", conversationId: null }), t);
    expect(result.href).toBe(routes.messages());
  });

  it("formats a system notification without an actor", () => {
    const result = formatNotification(
      baseNotification({ type: "system", actorId: null, actor: null, groupKey: "system:1" }),
      t,
    );
    expect(result.title).toBe("AKINTI");
    expect(result.body).toContain("AKINTI");
    expect(result.href).toBe(routes.notifications());
  });

  it("groups more than one event into '<actor> and N others'", () => {
    const result = formatNotification(baseNotification({ type: "save", waveId: "wave-1", count: 3 }), t);
    expect(result.title).toBe("Ada and 2 others saved your Wave");
  });

  it("uses 'other' (singular) for exactly two events", () => {
    const result = formatNotification(baseNotification({ type: "save", waveId: "wave-1", count: 2 }), t);
    expect(result.title).toBe("Ada and 1 other saved your Wave");
  });

  it("falls back to a generic actor name when the actor was not resolved (e.g. hidden by RLS)", () => {
    const result = formatNotification(baseNotification({ type: "follow", actor: null }), t);
    expect(result.title).toBe("Someone started following you");
    expect(result.href).toBe(routes.notifications());
  });

  it("falls back to the notifications route when a Wave-linked type has no wave id", () => {
    const result = formatNotification(baseNotification({ type: "save", waveId: null }), t);
    expect(result.href).toBe(routes.notifications());
  });

  it("renders Turkish copy for a Turkish reader, not English", () => {
    const save = formatNotification(baseNotification({ type: "save", waveId: "wave-1" }), tTr);
    expect(save.title).toBe("Ada Wave'ini kaydetti");
    expect(save.body).toBe("Wave'ini kayıtlarına ekledi.");

    const follow = formatNotification(baseNotification({ type: "follow" }), tTr);
    expect(follow.title).toBe("Ada seni takip etmeye başladı");

    // The generic actor fallback and the grouping plural have to translate too.
    const anonymous = formatNotification(baseNotification({ type: "follow", actor: null }), tTr);
    expect(anonymous.title).toBe("Biri seni takip etmeye başladı");

    const grouped = formatNotification(baseNotification({ type: "save", waveId: "wave-1", count: 3 }), tTr);
    expect(grouped.title).toBe("Ada ve 2 kişi daha Wave'ini kaydetti");
  });

  it("interpolates the brand into the system body in both locales", () => {
    const system = baseNotification({ type: "system", actorId: null, actor: null, groupKey: "system:1" });
    expect(formatNotification(system, t).body).toBe("An update from AKINTI.");
    expect(formatNotification(system, tTr).body).toBe("AKINTI'dan bir duyuru.");
  });

  it("returns a distinct icon per notification type", () => {
    const types: NotificationType[] = [
      "follow",
      "follow_request",
      "comment",
      "comment_reply",
      "save",
      "share",
      "duet_request",
      "duet_accepted",
      "duet_declined",
      "duet_published",
      "open_call_answered",
      "collaborator_invite",
      "collaborator_accepted",
      "message",
      "system",
    ];
    const icons = types.map((type) => formatNotification(baseNotification({ type }), t).icon);
    expect(new Set(icons).size).toBeGreaterThan(1);
    for (const icon of icons) {
      expect(icon).toBeDefined();
    }
  });
});
