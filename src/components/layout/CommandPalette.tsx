"use client";

/**
 * The desktop v3 command palette (`docs/design/DESIGN_V3_DESKTOP.md` "Top
 * bar": "search input that opens a command palette on ⌘K/Ctrl+K (routes +
 * recent searches + 'Record a Wave')"). Self-contained: owns its own open
 * state and the global ⌘K/Ctrl+K listener, so mounting it once in
 * `DesktopTopBar` is enough.
 *
 * A combobox, not a full dialog focus-trap: the text input keeps DOM focus
 * for the whole time the palette is open and `aria-activedescendant` points
 * at the highlighted row (the same pattern `Select.tsx`'s listbox already
 * uses), so arrow-key/Enter selection works without moving focus in and out
 * of a list of buttons.
 *
 * Deliberately a small first-party implementation rather than `cmdk`: this
 * environment cannot verify a fresh dependency install, and everything the
 * brief asks for (routes, recent searches, "Record a Wave", ⌘K, arrow nav,
 * Escape) fits in well under 200 lines without it. `package.json` stays
 * untouched.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";

import { routes } from "@/config/routes";
import { cn } from "@/lib/ui";
import { Kbd } from "@/components/ui";
import { Clock, Mic2 as RecordIcon, Search, type IconComponent } from "@/components/ui/icons";

import { SIDEBAR_LIBRARY_ITEMS, SIDEBAR_PRIMARY_ITEMS } from "./navItems";

const RECENT_KEY = "akinti.commandPalette.recentSearches";
const RECENT_MAX = 5;

interface PaletteRoute {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon?: IconComponent;
}

function readRecentSearches(): readonly string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function pushRecentSearch(query: string): void {
  if (typeof window === "undefined") return;
  try {
    const existing = readRecentSearches().filter((q) => q.toLowerCase() !== query.toLowerCase());
    const next = [query, ...existing].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Recent searches are a convenience; losing them is not an error.
  }
}

export function CommandPalette() {
  const router = useRouter();
  const t = useTranslations("Terms");
  const tLayout = useTranslations("Layout");
  const listboxId = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  // Read directly during render rather than mirrored into state: this only
  // ever needs a value once `open` is true, which only happens from a
  // client-side click or keypress — well past hydration — so there is no
  // SSR/first-paint mismatch to guard against, and no effect needed either.
  const recent = open ? readRecentSearches() : [];

  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  const routeOptions = useMemo<readonly PaletteRoute[]>(
    () => [
      ...SIDEBAR_PRIMARY_ITEMS.map((item) => ({
        id: `route-${item.key}`,
        label: t(item.labelKey),
        href: item.href,
        icon: item.icon,
      })),
      ...SIDEBAR_LIBRARY_ITEMS.map((item) => ({
        id: `route-${item.key}`,
        label: t(item.labelKey),
        href: item.href,
        icon: item.icon,
      })),
      { id: "route-settings", label: t("settings"), href: routes.settings() },
      { id: "route-pro", label: t("pro"), href: routes.settingsPro() },
    ],
    [t],
  );

  const filteredRoutes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return routeOptions;
    return routeOptions.filter((route) => route.label.toLowerCase().includes(needle));
  }, [routeOptions, query]);

  const showRecordAction = query.trim().length === 0 || "record a wave".includes(query.trim().toLowerCase());
  const trimmedQuery = query.trim();
  const showSearchAction = trimmedQuery.length > 0;

  // Flattened, in the order they render, so ArrowUp/Down and
  // `aria-activedescendant` agree with what's on screen.
  const flatOptions = useMemo(() => {
    const options: { id: string; run: () => void }[] = [];
    if (showRecordAction) {
      options.push({ id: "action-record", run: () => go(routes.create()) });
    }
    for (const route of filteredRoutes) {
      options.push({ id: route.id, run: () => go(route.href) });
    }
    if (showSearchAction) {
      options.push({
        id: "action-search",
        run: () => {
          pushRecentSearch(trimmedQuery);
          go(routes.search(trimmedQuery));
        },
      });
    }
    if (!trimmedQuery && recent.length > 0) {
      for (const q of recent) {
        options.push({ id: `recent-${q}`, run: () => go(routes.search(q)) });
      }
    }
    return options;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` is stable within a render pass; declaring it above would reorder the closures above it.
  }, [showRecordAction, filteredRoutes, showSearchAction, trimmedQuery, recent]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // The global ⌘K / Ctrl+K listener — the one reason this component can be
  // mounted once and forgotten rather than wired up by every page.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setActiveIndex(0);
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (flatOptions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % flatOptions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + flatOptions.length) % flatOptions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      flatOptions[activeIndex]?.run();
    }
  };

  let renderIndex = -1;
  const nextIndex = () => {
    renderIndex += 1;
    return renderIndex;
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setActiveIndex(0);
          setOpen(true);
        }}
        className={cn(
          "akinti-press flex h-11 w-full max-w-xs items-center gap-2 rounded-key border border-hairline",
          "bg-elevation-2 px-3 text-left type-body-sm text-ink-subtle transition-colors hover:text-ink",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide",
        )}
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{tLayout("commandPaletteOpen")}</span>
        <Kbd className="shrink-0">{tLayout("commandPaletteShortcut")}</Kbd>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
          <button
            type="button"
            aria-label={tLayout("commandPaletteLabel")}
            className="akinti-scrim absolute inset-0 cursor-default"
            onClick={close}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={tLayout("commandPaletteLabel")}
            className="relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-card border border-hairline-strong bg-elevation-2 shadow-lift motion-safe:akinti-enter"
          >
            <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
              <Search className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
              <input
                ref={inputRef}
                role="combobox"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={flatOptions[activeIndex]?.id}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder={tLayout("commandPalettePlaceholder")}
                className="type-body-sm min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle"
              />
              <Kbd>{tLayout("commandPaletteEscape")}</Kbd>
            </div>

            <div id={listboxId} role="listbox" className="max-h-80 overflow-y-auto py-2">
              {showRecordAction ? (
                <PaletteRow
                  ref={(node) => {
                    optionRefs.current[nextIndex()] = node;
                  }}
                  id="action-record"
                  active={flatOptions[activeIndex]?.id === "action-record"}
                  icon={RecordIcon}
                  label={tLayout("commandPaletteRecordAction")}
                  onSelect={() => go(routes.create())}
                />
              ) : null}

              {filteredRoutes.length > 0 ? (
                <PaletteGroup label={tLayout("commandPaletteRoutesGroup")}>
                  {filteredRoutes.map((route) => (
                    <PaletteRow
                      key={route.id}
                      ref={(node) => {
                        optionRefs.current[nextIndex()] = node;
                      }}
                      id={route.id}
                      active={flatOptions[activeIndex]?.id === route.id}
                      icon={route.icon}
                      label={route.label}
                      onSelect={() => go(route.href)}
                    />
                  ))}
                </PaletteGroup>
              ) : null}

              {showSearchAction ? (
                <PaletteRow
                  ref={(node) => {
                    optionRefs.current[nextIndex()] = node;
                  }}
                  id="action-search"
                  active={flatOptions[activeIndex]?.id === "action-search"}
                  icon={Search}
                  label={`${t("search")}: "${trimmedQuery}"`}
                  onSelect={() => {
                    pushRecentSearch(trimmedQuery);
                    go(routes.search(trimmedQuery));
                  }}
                />
              ) : null}

              {!trimmedQuery && recent.length > 0 ? (
                <PaletteGroup label={tLayout("commandPaletteRecentGroup")}>
                  {recent.map((q) => (
                    <PaletteRow
                      key={`recent-${q}`}
                      ref={(node) => {
                        optionRefs.current[nextIndex()] = node;
                      }}
                      id={`recent-${q}`}
                      active={flatOptions[activeIndex]?.id === `recent-${q}`}
                      icon={Clock}
                      label={q}
                      onSelect={() => go(routes.search(q))}
                    />
                  ))}
                </PaletteGroup>
              ) : null}

              {flatOptions.length === 0 ? (
                <p className="type-body-sm px-4 py-6 text-center text-ink-subtle">
                  {tLayout("commandPaletteEmpty")}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PaletteGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="type-caption px-4 pt-2 pb-1 text-ink-subtle">{label}</p>
      {children}
    </div>
  );
}

interface PaletteRowProps {
  id: string;
  label: string;
  icon?: IconComponent;
  active: boolean;
  onSelect: () => void;
}

function PaletteRowInner(
  { id, label, icon: Icon, active, onSelect }: PaletteRowProps,
  ref: Ref<HTMLDivElement>,
) {
  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={active}
      onMouseDown={(event) => {
        // `mousedown` fires before the input blurs, so selecting with the
        // pointer doesn't first steal focus and cancel the click.
        event.preventDefault();
        onSelect();
      }}
      className={cn(
        "mx-2 flex items-center gap-3 rounded-key px-3 py-2 type-body-sm text-ink transition-colors",
        active ? "bg-elevation-3" : "hover:bg-elevation-3",
      )}
    >
      {Icon ? <Icon className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  );
}

const PaletteRow = forwardRef<HTMLDivElement, PaletteRowProps>(PaletteRowInner);
