"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "@/lib/ui";

export interface ChipProps
  extends Omit<ComponentPropsWithRef<"button">, "children"> {
  children: ReactNode;
  /** Selected chips report `aria-pressed`. */
  selected?: boolean;
  icon?: ReactNode;
  count?: number;
}

/**
 * A filter chip (§8.8). A filter row is one 40px row, horizontally scrollable,
 * and the active item is marked by a **2px current-coloured underbar** —
 * never a filled coloured pill (§12.4, recoloured by COLOR_V2 in step with
 * Tabs's active underline). Unselected chips are 6px-radius hairline tags.
 */
export function Chip({
  children,
  selected = false,
  icon,
  count,
  className,
  type = "button",
  ...props
}: ChipProps) {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      className={cn(
        // 44px, not 40: the touch baseline (WCAG 2.5.5, iOS 44pt, Android 48dp).
        "akinti-press inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 px-3",
        "type-caption whitespace-nowrap transition-colors duration-[--dur-micro]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide",
        "disabled:cursor-not-allowed disabled:opacity-55",
        selected
          ? "border-b-2 border-tide text-ink"
          : "rounded-tag border border-hairline text-ink-muted hover:border-hairline-strong hover:text-ink",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      {children}
      {typeof count === "number" ? (
        <span className="type-mono-sm text-ink-subtle">{count}</span>
      ) : null}
    </button>
  );
}
