import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";

import { pickMessages } from "@/i18n/pickMessages";
import { SettingsDesktopFrame } from "@/components/settings";

/**
 * Per-route-group message narrowing (closeout perf pass), Settings' slice —
 * covers every `/settings/**` screen (account, appearance, audio, content +
 * its four tabs, follow-requests, notifications, privacy, pro, safety) under
 * this one layout segment. See `../flow/layout.tsx` for the full rationale
 * and caveats (self-sufficient list, AppShell chrome unaffected). Namespaces
 * verified by walking the real import graph from every `page.tsx`/
 * `actions.ts` under this directory.
 */
const SETTINGS_MESSAGE_NAMESPACES = [
  "Terms",
  "Common",
  "Settings",
  "SettingsSections",
  "SettingsActions",
  "SettingsContentActions",
  "SettingsNotificationsActions",
  "SettingsProActions",
  "AccountSettingsPage",
  "AccountForm",
  "ChangePasswordForm",
  "AppearanceSettingsPage",
  "AppearanceForm",
  "AppearancePreview",
  "AvatarUploader",
  "AudioSettingsPage",
  "AudioPreferencesForm",
  "ContentSettingsPage",
  "ContentWaveList",
  "CommentedContentPage",
  "MyDuetsContentPage",
  "MyWavesContentPage",
  "SavedContentPage",
  "FollowRequestsPage",
  "FollowRequestsList",
  "NotificationsSettingsPage",
  "NotificationsForm",
  "PushToggle",
  "PrivacySettingsPage",
  "PrivacyForm",
  "BlockedList",
  "ProSettingsPage",
  "ProScreen",
  "Pro",
  "ProMark",
  "CancelProSheet",
  "StartProControls",
  "SafetySettingsPage",
  "DownloadDataButton",
  "DeleteAccountSheet",
  "Report",
  "ReportsList",
  "ProfileActions",
  "WaveCard",
  "WaveCardContainer",
  "WavePlayer",
  "ShareSheet",
  "Sheet",
  "MessagesActions",
  "ErrorPage",
  "NotFoundPage",
  // `WaveCardContainer`'s Save action now calls `useActionToast`, which
  // reads "Layout" (previously unneeded here: only `AppShell` chrome
  // outside this provider used it).
  "Layout",
] as const;

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={pickMessages(messages, SETTINGS_MESSAGE_NAMESPACES)}>
      <SettingsDesktopFrame>{children}</SettingsDesktopFrame>
    </NextIntlClientProvider>
  );
}
