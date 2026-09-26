import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronRight, LogOut } from "@/components/ui/icons";

import { signOut } from "@/app/(auth)/actions";
import { PageHeader } from "@/components/layout";
import { DeleteAccountSheet, LanguageSwitchRow } from "@/components/settings";
import { Avatar } from "@/components/ui";
import { SETTINGS_SECTIONS, routes, type SettingsSection } from "@/config/routes";
import { BRAND } from "@/config/terminology";
import { requireUser } from "@/lib/auth/server";
import { getProfileById } from "@/lib/db/profiles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function generateMetadata() {
  const t = await getTranslations("Terms");
  return { title: t("settings") };
}

/**
 * SCREENS.md §11 groups the destinations into three hairline-separated
 * clusters (account & safety / preferences / creator tools) with 28px gaps
 * between them and no card boundary around the whole list — this maps
 * `SETTINGS_SECTIONS` (owned by the routes agent, not edited here) into
 * that grouping by key rather than changing the shared list itself.
 */
const GROUPS: readonly (readonly string[])[] = [
  ["account", "privacy", "safety"],
  ["audio", "notifications", "appearance"],
  ["content", "analytics"],
];

function sectionsFor(keys: readonly string[]): SettingsSection[] {
  return keys
    .map((key) => SETTINGS_SECTIONS.find((section) => section.key === key))
    .filter((section): section is SettingsSection => section !== undefined);
}

/**
 * `SETTINGS_SECTIONS`' `label` field (`@/config/routes`, owned by another
 * stage) is English-only, same reasoning as `TERMS`
 * (`src/config/terminology.ts`'s header comment) — a plain module-level
 * constant evaluated at import time, before any per-request locale exists.
 * The `SettingsSections` message namespace mirrors it 1:1 by `key`; `.key`
 * itself is typed as a plain `string` at the source, so this cast is the one
 * place that gap is bridged — every value actually on `SETTINGS_SECTIONS`
 * today is one of these eight.
 */
type SettingsSectionMessageKey =
  | "account"
  | "privacy"
  | "appearance"
  | "notifications"
  | "content"
  | "analytics"
  | "audio"
  | "safety"
  | "pro";

async function handleSignOut(): Promise<void> {
  "use server";
  const result = await signOut();
  if (result.ok) {
    redirect(result.redirectTo ?? routes.login());
  }
}

/** Settings hub (SCREENS.md §11): the one screen allowed to be plain — a
 *  list of destinations, no icon column, no chevron in a circle. */
export default async function SettingsPage() {
  const user = await requireUser(routes.settings());
  const t = await getTranslations("Terms");
  const tSections = await getTranslations("SettingsSections");

  const profile = isSupabaseConfigured()
    ? await getProfileById(await createServerSupabaseClient(), user.id)
    : null;

  const grouped = GROUPS.map(sectionsFor).filter((sections) => sections.length > 0);
  const groupedKeys = new Set(GROUPS.flat());
  const ungrouped = SETTINGS_SECTIONS.filter((section) => !groupedKeys.has(section.key));

  return (
    <>
      {/* Hidden at >= 1024px: `SettingsNavPane` already carries a "Settings"
          heading of its own in the left rail, right beside this page. */}
      <PageHeader title={t("settings")} className="lg:hidden" />
      <div className="px-4 pb-6 sm:px-5">
        {profile ? (
          <Link
            href={routes.settingsAccount()}
            className="flex items-center gap-3 border-b border-hairline py-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
          >
            <Avatar name={profile.displayName ?? profile.username} src={profile.avatarUrl} size="lg" />
            <span className="min-w-0 flex-1">
              <span className="type-body block text-ink">{profile.displayName ?? profile.username}</span>
              <span className="type-caption block text-ink-subtle">@{profile.username}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          </Link>
        ) : null}

        {/* Hidden at >= 1024px: `SettingsNavPane` (`SettingsDesktopFrame`'s
            left rail) already lists every section there. */}
        <nav aria-label={t("settings")} className="flex flex-col gap-7 pt-2 lg:hidden">
          {[...grouped, ungrouped].map((sections, groupIndex) =>
            sections.length === 0 ? null : (
              <ul key={groupIndex} className="flex flex-col">
                {sections.map((section) => (
                  <li key={section.key} className="border-b border-hairline first:border-t">
                    <Link
                      href={section.href}
                      className="flex items-center gap-3 py-3.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
                    >
                      <span className="type-body block flex-1 text-ink">
                        {tSections(section.key as SettingsSectionMessageKey)}
                      </span>
                      <ChevronRight className="size-3 shrink-0 text-ink-subtle" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            ),
          )}
        </nav>

        <div className="mt-7 flex flex-col border-t border-hairline">
          <LanguageSwitchRow />
        </div>

        <div className="flex flex-col items-start gap-3 pt-8">
          <form action={handleSignOut}>
            <button
              type="submit"
              className="akinti-press type-body inline-flex items-center gap-2 text-ink underline decoration-hairline-strong decoration-1 underline-offset-[3px] hover:decoration-ink"
            >
              <LogOut className="size-4" aria-hidden="true" />
              {t("logOut")}
            </button>
          </form>
          {profile ? <DeleteAccountSheet username={profile.username} /> : null}
        </div>

        <p className="type-caption pt-8 text-ink-subtle">{BRAND} · 2026</p>
      </div>
    </>
  );
}
