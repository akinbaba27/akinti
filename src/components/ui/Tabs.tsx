"use client";

import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/ui";

export interface TabItem {
  readonly value: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly count?: number;
  readonly disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** Names the tablist for screen readers. */
  label: string;
  /**
   * `underline` is the 40px page-level filter row; `segmented` is the same
   * marking at a compact 32px. Both mark the active item with a 2px
   * current-coloured underbar - never a filled coloured pill (DESIGN.md
   * 8.8, 12.4; recoloured by COLOR_V2 "Tabs and nav").
   */
  variant?: "underline" | "segmented";
  /** Supply a stable prefix when you render matching <TabPanel>s. */
  idPrefix?: string;
  className?: string;
}

/**
 * WAI-ARIA tabs with manual activation: arrows move focus and select,
 * Home/End jump to the ends. Panels are rendered by the caller and should
 * reference `tabPanelId(baseId, value)`.
 */
export function Tabs({
  items,
  value,
  onValueChange,
  label,
  variant = "underline",
  idPrefix,
  className,
}: TabsProps) {
  const generatedId = useId();
  const baseId = idPrefix ?? generatedId;
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = useCallback((index: number) => {
    const tabs = listRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    tabs?.item(index)?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((item) => !item.disabled);
    if (enabled.length === 0) return;

    const currentIndex = enabled.findIndex((item) => item.value === value);
    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % enabled.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + enabled.length) % enabled.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = enabled.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const next = enabled[nextIndex];
    if (!next) return;
    onValueChange(next.value);
    focusTab(items.findIndex((item) => item.value === next.value));
  };

  const isSegmented = variant === "segmented";

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex items-center overflow-x-auto",
        isSegmented ? "gap-5" : "gap-5 border-b border-hairline",
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={tabId(baseId, item.value)}
            aria-selected={selected}
            aria-controls={tabPanelId(baseId, item.value)}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "akinti-press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap",
              "border-b-2 transition-colors duration-[--dur-micro]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide",
              "disabled:cursor-not-allowed disabled:opacity-55",
              // 44px in both variants, the touch baseline (WCAG 2.5.5, iOS
              // 44pt, Android 48dp). They were 32px segmented and 40px
              // underlined; the type scale still distinguishes them, the
              // box no longer has to.
              // `min-w-11` as well as `h-11`: WCAG 2.5.5 is 44x44, and a short
              // label like "New" or "Sent" cleared the height and not the width.
              "min-w-11 justify-center",
              isSegmented ? "h-11 type-caption" : "h-11 type-subhead",
              // Active underline is the current; the label stays ink
              // (COLOR_V2 "Tabs and nav": "active underline current, icons
              // ink").
              selected
                ? "border-tide text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {item.icon ? (
              <span aria-hidden="true" className="inline-flex">
                {item.icon}
              </span>
            ) : null}
            {item.label}
            {typeof item.count === "number" ? (
              <span className="type-mono-sm text-ink-subtle">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function tabId(baseId: string, value: string): string {
  return `${baseId}-tab-${value}`;
}

export function tabPanelId(baseId: string, value: string): string {
  return `${baseId}-panel-${value}`;
}

export interface TabPanelProps {
  /** Must match the `id` generated for the corresponding tab. */
  id: string;
  labelledBy: string;
  active: boolean;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ id, labelledBy, active, children, className }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={id}
      aria-labelledby={labelledBy}
      hidden={!active}
      tabIndex={0}
      className={cn("focus-visible:outline-2 focus-visible:outline-tide", className)}
    >
      {active ? children : null}
    </div>
  );
}
