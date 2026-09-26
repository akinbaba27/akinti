"use client";

/**
 * The desktop sidebar (`docs/design/DESIGN_V3_DESKTOP.md` "Shell", founder
 * decision 6 Sept 2026). Renders only at `lg` (>= 1024px) — `SideNav.tsx`
 * keeps serving the 768-1023px icon rail exactly as it did before this file
 * existed, and is hidden at `lg` so the two never overlap.
 *
 * 240px expanded, collapsible to a 72px icon rail; the choice persists in
 * `localStorage` so it survives a reload. Logo, primary nav (Phosphor icons +
 * labels, duotone fill when active), a full-width "New Wave" key, a Library
 * section (Saved, Duets, Drafts) and the account menu at the bottom.
 *
 * Every link's pressed/pending state comes from `useLinkStatus` — read
 * inside a child of the `Link`, per Next's own contract — rather than
 * `usePathname()`, which only resolves once the new route has fully painted
 * (`docs/research/desktop/FEEDBACK_AUDIT.md` #2: "SideNav pressed/pending
 * state must not depend on usePathname"). `active` (the settled, current-page
 * indicator) still reads `usePathname()`, because that one *should* wait for
 * the real destination.
 */

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { isActiveRoute, routes } from "@/config/routes";
import { BRAND } from "@/config/terminology";
import { useCurrentUser } from "@/lib/auth";
import { useUnreadMessages } from "@/lib/messages";
import { useUnreadNotifications } from "@/lib/notifications";
import { cn } from "@/lib/ui";
import { CountBadge, IconButton } from "@/components/ui";
import { Bell, Crown, Settings, SidebarSimple, type IconComponent } from "@/components/ui/icons";
import { useFlowNewCount } from "@/components/flow";

import { SIDEBAR_LIBRARY_ITEMS, SIDEBAR_PRIMARY_ITEMS, type NavItem } from "./navItems";
import { UserMenu } from "./UserMenu";

export interface DesktopSideNavProps {
  badges?: Partial<Record<string, number>>;
  className?: string;
}

const COLLAPSE_KEY = "akinti.sidebar.collapsed";

/**
 * A tiny external store over `localStorage`, read through
 * `useSyncExternalStore` rather than `useState` + a mount effect: the
 * server (and the client's very first render, before hydration) always see
 * `false` — the third argument below — and the real stored value lands the
 * instant hydration finishes, with no `setState`-in-an-effect render
 * cascade. Same fix shape as `src/components/pwa/InstallHint.tsx`'s
 * `useIsIOSNotStandalone`.
 */
let cachedCollapsed: boolean | null = null;
const collapseListeners = new Set<() => void>();

function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function getCollapsedSnapshot(): boolean {
  cachedCollapsed ??= readStoredCollapsed();
  return cachedCollapsed;
}

function subscribeCollapsed(listener: () => void): () => void {
  collapseListeners.add(listener);
  return () => collapseListeners.delete(listener);
}

function setStoredCollapsed(value: boolean): void {
  cachedCollapsed = value;
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    // A blocked/full localStorage just means the choice won't survive a
    // reload; the toggle itself still works for this session (the module
    // cache above still updates).
  }
  collapseListeners.forEach((listener) => listener());
}

function useCollapsed(): boolean {
  return useSyncExternalStore(subscribeCollapsed, getCollapsedSnapshot, () => false);
}

/** Reads `useLinkStatus` from inside the `Link` it decorates — the icon dims
 * and takes the current colour the instant the click registers, not ~700-
 * 1200ms later when `usePathname()` finally catches up. */
function NavIcon({
  icon: Icon,
  active,
  className,
}: {
  icon: IconComponent;
  active: boolean;
  className?: string;
}) {
  const { pending } = useLinkStatus();
  const engaged = active || pending;
  return (
    <Icon
      className={cn("size-5 shrink-0 transition-colors duration-100", className)}
      aria-hidden="true"
      weight={engaged ? "fill" : "regular"}
    />
  );
}

function SidebarLink({
  href,
  icon,
  label,
  badge,
  badgeLabel,
  collapsed,
}: {
  href: string;
  icon: IconComponent;
  label: string;
  badge?: number;
  badgeLabel?: string;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const active = isActiveRoute(pathname, href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "akinti-press group flex h-11 items-center gap-3 rounded-key px-3 transition-colors duration-100",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tide",
        active
          ? "bg-elevation-2 text-ink"
          : "text-ink-subtle hover:bg-elevation-2 hover:text-ink",
        collapsed && "justify-center px-0",
      )}
    >
      <span className="relative inline-flex shrink-0">
        <NavIcon icon={icon} active={active} className={active ? "text-tide" : undefined} />
        {badge && badge > 0 ? (
          <CountBadge count={badge} label={badgeLabel ?? label} className="absolute -top-1.5 -right-2" />
        ) : null}
      </span>
      {collapsed ? null : (
        <span className="type-body-sm min-w-0 flex-1 truncate font-medium">{label}</span>
      )}
    </Link>
  );
}

export function DesktopSideNav({ badges, className }: DesktopSideNavProps) {
  const pathname = usePathname();
  const { profile } = useCurrentUser();
  const { count: unreadNotifications } = useUnreadNotifications(profile?.id ?? null);
  const { count: unreadMessages } = useUnreadMessages(profile?.id ?? null);
  const flowNew = useFlowNewCount(profile?.id ?? null);
  const t = useTranslations("Terms");
  const tLayout = useTranslations("Layout");

  const collapsed = useCollapsed();
  const toggleCollapsed = () => setStoredCollapsed(!collapsed);

  const proActive = isActiveRoute(pathname, routes.settingsPro());
  const settingsActive = isActiveRoute(pathname, routes.settings());

  // `pb-now-playing` always reserves the now-playing bar's 88px at the foot
  // of the rail, whether or not a track is active, so the fixed bar
  // (`NowPlayingBar`, full viewport width, `AppShell`) never overlaps the
  // Pro/Settings/account cluster below. Same static-reserve trade-off the
  // mobile shell already makes for its own keyboard-height padding.
  return (
    <div
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col gap-1 border-r border-hairline bg-elevation-0",
        "pb-now-playing transition-[width] duration-200 ease-[--ease-enter]",
        collapsed ? "w-sidebar-rail" : "w-sidebar",
        "lg:flex",
        className,
      )}
    >
      <div className={cn("flex h-14 items-center px-3", collapsed && "justify-center px-0")}>
        <Link
          href={routes.home()}
          className={cn(
            "inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide",
            collapsed ? "size-9 justify-center rounded-[13px] bg-tide text-on-ink" : "h-9 px-2",
          )}
        >
          {collapsed ? (
            <span aria-hidden="true" className="type-caption-strong">
              {BRAND.slice(0, 1)}
            </span>
          ) : (
            <span className="type-wordmark text-ink">{BRAND}</span>
          )}
          <span className="sr-only">{collapsed ? BRAND : null}</span>
        </Link>
        {collapsed ? null : (
          <IconButton
            label={tLayout("collapseSidebar")}
            icon={<SidebarSimple className="size-4" aria-hidden="true" weight="regular" />}
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={toggleCollapsed}
          />
        )}
      </div>

      <nav
        aria-label={tLayout("primaryNav")}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-3"
      >
        <ul className="flex flex-col gap-0.5">
          {SIDEBAR_PRIMARY_ITEMS.map((item: NavItem) => {
            if (!item.icon) return null;
            const liveBadge = item.key === "messages" ? unreadMessages : item.key === "flow" ? flowNew : 0;
            const badge = badges?.[item.key] ?? liveBadge;
            return (
              <li key={item.key}>
                <SidebarLink
                  href={item.href}
                  icon={item.icon}
                  label={t(item.labelKey)}
                  badge={badge}
                  badgeLabel={tLayout("unreadItem", { item: t(item.labelKey) })}
                  collapsed={collapsed}
                />
              </li>
            );
          })}
          <li>
            <SidebarLink
              href={routes.notifications()}
              icon={Bell}
              label={t("notifications")}
              badge={unreadNotifications}
              badgeLabel={tLayout("unreadNotifications")}
              collapsed={collapsed}
            />
          </li>
        </ul>

        <Link
          href={routes.create()}
          aria-label={`${t("newWave")}`}
          title={collapsed ? t("newWave") : undefined}
          className={cn(
            "akinti-press inline-flex h-11 items-center justify-center gap-2 rounded-key bg-tide",
            "type-body-sm font-medium text-on-ink transition-colors duration-100 hover:bg-tide-2",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide",
          )}
        >
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-signal" />
          {collapsed ? null : t("newWave")}
        </Link>

        <div className="flex flex-col gap-0.5">
          {collapsed ? (
            <div className="my-1 h-px bg-hairline" aria-hidden="true" />
          ) : (
            <p className="type-caption px-3 pb-1 text-ink-subtle">{t("library")}</p>
          )}
          <ul className="flex flex-col gap-0.5">
            {SIDEBAR_LIBRARY_ITEMS.map((item) => {
              if (!item.icon) return null;
              return (
                <li key={item.key}>
                  <SidebarLink
                    href={item.href}
                    icon={item.icon}
                    label={t(item.labelKey)}
                    collapsed={collapsed}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-hairline px-3 py-3">
        <Link
          href={routes.settingsPro()}
          title={collapsed ? t("pro") : undefined}
          aria-current={proActive ? "page" : undefined}
          className={cn(
            "akinti-press flex h-11 items-center gap-3 rounded-key px-3 transition-colors",
            "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tide",
            proActive ? "text-sand" : "text-ink-subtle hover:bg-elevation-2 hover:text-ink",
            collapsed && "justify-center px-0",
          )}
        >
          <Crown className="size-5 shrink-0" aria-hidden="true" weight={proActive ? "fill" : "regular"} />
          {collapsed ? null : <span className="type-body-sm flex-1 truncate font-medium">{t("pro")}</span>}
        </Link>

        <Link
          href={routes.settings()}
          title={collapsed ? t("settings") : undefined}
          aria-current={settingsActive ? "page" : undefined}
          className={cn(
            "akinti-press flex h-11 items-center gap-3 rounded-key px-3 transition-colors",
            "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tide",
            settingsActive ? "text-ink" : "text-ink-subtle hover:bg-elevation-2 hover:text-ink",
            collapsed && "justify-center px-0",
          )}
        >
          <Settings
            className="size-5 shrink-0"
            aria-hidden="true"
            weight={settingsActive ? "fill" : "regular"}
          />
          {collapsed ? null : <span className="type-body-sm flex-1 truncate font-medium">{t("settings")}</span>}
        </Link>

        <div className={cn("mt-1", collapsed && "flex justify-center")}>
          <UserMenu size={collapsed ? "sm" : "md"} className={collapsed ? undefined : "w-full"} />
        </div>
      </div>

      {collapsed ? (
        <div className="absolute top-3 -right-3">
          <IconButton
            label={tLayout("expandSidebar")}
            icon={<SidebarSimple className="size-4" aria-hidden="true" weight="fill" />}
            variant="secondary"
            size="sm"
            className="bg-elevation-1"
            onClick={toggleCollapsed}
          />
        </div>
      ) : null}
    </div>
  );
}
