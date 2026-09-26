"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { IconComponent } from "@/components/ui/icons";
import { Bell, ChartColumn, Lock, MusicNotes, Settings, ShieldCheck, SpeakerHigh, User } from "@/components/ui/icons";

import { SETTINGS_SECTIONS, isActiveRoute, type SettingsSection } from "@/config/routes";
import { cn } from "@/lib/ui";

/**
 * The desktop (`>= 1024px`) settings nav (`DESIGN_V3_DESKTOP.md`: "settings
 * nav left (icons, active state) + form right"). Mirrors the mobile hub
 * page's own three hairline-separated clusters (`settings/page.tsx`'s
 * `GROUPS`) rather than a flat list, so the grouping logic exists in exactly
 * one place conceptually even though it's duplicated as data here (`page.tsx`
 * owns the mobile hub; this owns the desktop rail — reading the exported
 * `SETTINGS_SECTIONS` `key`s the same way, not the private JSX). AKINTI Pro
 * is deliberately not one of these entries: it already has its own
 * dedicated, differently-styled destination in `DesktopSideNav`
 * (`routes.settingsPro()`), same as the mobile hub never lists it either.
 */
const GROUPS: readonly (readonly string[])[] = [
  ["account", "privacy", "safety"],
  ["audio", "notifications", "appearance"],
  ["content", "analytics"],
];

/** No dedicated "appearance" or "content" glyph exists in the shared icon set (`src/components/ui/icons.ts`, not owned by this pass) — `Settings`/`MusicNotes` are the closest fit already exported there. */
const SECTION_ICON: Record<string, IconComponent> = {
  account: User,
  privacy: Lock,
  safety: ShieldCheck,
  audio: SpeakerHigh,
  notifications: Bell,
  appearance: Settings,
  content: MusicNotes,
  analytics: ChartColumn,
};

type SettingsSectionMessageKey =
  | "account"
  | "privacy"
  | "appearance"
  | "notifications"
  | "content"
  | "analytics"
  | "audio"
  | "safety";

function sectionsFor(keys: readonly string[]): SettingsSection[] {
  return keys
    .map((key) => SETTINGS_SECTIONS.find((section) => section.key === key))
    .filter((section): section is SettingsSection => section !== undefined);
}

export function SettingsNavPane() {
  const t = useTranslations("Terms");
  const tSections = useTranslations("SettingsSections");
  const pathname = usePathname();
  const grouped = GROUPS.map(sectionsFor).filter((sections) => sections.length > 0);

  return (
    <nav aria-label={t("settings")} className="flex flex-col gap-6">
      <h1 className="type-desktop-subheading px-1 text-ink">{t("settings")}</h1>
      {grouped.map((sections, groupIndex) => (
        <ul key={groupIndex} className="flex flex-col gap-0.5 border-t border-hairline pt-3 first:border-t-0 first:pt-0">
          {sections.map((section) => {
            const active = isActiveRoute(pathname, section.href);
            const Icon = SECTION_ICON[section.key];
            return (
              <li key={section.key}>
                <Link
                  href={section.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    // `h-11` rather than `py-2`, which came out at 36px — the
                    // touch baseline is 44x44 (WCAG 2.5.5).
                    "akinti-press flex h-11 items-center gap-3 rounded-key px-3 type-body-sm transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide",
                    active ? "bg-elevation-2 text-tide" : "text-ink-muted hover:bg-elevation-2 hover:text-ink",
                  )}
                >
                  {Icon ? <Icon className="size-5 shrink-0" weight={active ? "fill" : "regular"} /> : null}
                  <span className="truncate">{tSections(section.key as SettingsSectionMessageKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ))}
    </nav>
  );
}
