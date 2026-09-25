"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { updateNotificationPreferences } from "@/app/(app)/settings/actions";
import { Switch, useToast } from "@/components/ui";
import { NOTIFICATION_CATEGORIES, type NotificationCategory, type NotificationPreferences } from "@/types/domain";

export interface NotificationsFormProps {
  initialPreferences: NotificationPreferences;
}

/**
 * Message keys per category, not the copy itself. These five labels and five
 * descriptions used to be English string literals in this file, which meant a
 * Turkish session rendered the whole screen in English — and
 * `scripts/i18n-check.ts` could not see it, because its `.tsx` scanner reads
 * JSX text and attributes, not copy parked in a module-level `Record`.
 * Caught by the 2026-09-25 audit's Turkish sweep.
 */
const CATEGORY_LABEL_KEY = {
  message: "labelMessage",
  duet: "labelDuet",
  comment: "labelComment",
  follower: "labelFollower",
  system: "labelSystem",
} as const satisfies Record<NotificationCategory, string>;

const CATEGORY_DESCRIPTION_KEY = {
  message: "descriptionMessage",
  duet: "descriptionDuet",
  comment: "descriptionComment",
  follower: "descriptionFollower",
  system: "descriptionSystem",
} as const satisfies Record<NotificationCategory, string>;

/** Settings → Notifications (spec §23, §25): one toggle per category, saved as soon as it changes. */
export function NotificationsForm({ initialPreferences }: NotificationsFormProps) {
  const { toast } = useToast();
  const t = useTranslations("NotificationsForm");
  const [preferences, setPreferences] = useState<NotificationPreferences>(initialPreferences);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(category: NotificationCategory, checked: boolean) {
    setError(null);
    const next = { ...preferences, [category]: checked };
    setPreferences(next);
    startTransition(async () => {
      const result = await updateNotificationPreferences(next);
      if (!result.ok) {
        setPreferences(preferences);
        setError(result.formError ?? t("saveErrorDefault"));
        return;
      }
      toast({ title: result.message ?? t("saved"), tone: "success" });
    });
  }

  return (
    <div className="flex flex-col gap-4 border-t border-hairline pt-5">
      {NOTIFICATION_CATEGORIES.map((category, index) => (
        <div key={category}>
          <Switch
            label={t(CATEGORY_LABEL_KEY[category])}
            description={t(CATEGORY_DESCRIPTION_KEY[category])}
            checked={preferences[category] ?? true}
            onCheckedChange={(checked) => toggle(category, checked)}
            disabled={isPending}
          />
          {index < NOTIFICATION_CATEGORIES.length - 1 ? (
            <div className="mt-4 border-t border-hairline" aria-hidden="true" />
          ) : null}
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
