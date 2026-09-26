"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "@/lib/ui";

import { Spinner } from "./Spinner";
import { VisuallyHidden } from "./VisuallyHidden";

export type IconButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type IconButtonSize = "sm" | "md" | "lg";

/**
 * A key is a squircle; a circle is reserved for round transport controls at
 * 36-56px, where the circle is the hardware convention (§5.2).
 */
export type IconButtonShape = "key" | "round";

export interface IconButtonProps
  extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** Required: an icon-only control must still be named. */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  shape?: IconButtonShape;
  loading?: boolean;
  /** Render the label visibly next to the icon instead of only for readers. */
  showLabel?: boolean;
}

const BASE =
  "akinti-press relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 " +
  "transition-[background-color,border-color,color] duration-[--dur-micro] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide " +
  "disabled:cursor-not-allowed disabled:opacity-55";

const VARIANTS: Record<IconButtonVariant, string> = {
  // Matches Button's primary: the current fill, paper glyph (COLOR_V2
  // "Buttons") — including the transport play/pause key, which is exactly
  // the kind of moving, actionable control colour belongs on.
  primary: "bg-tide text-on-ink hover:bg-tide-2",
  secondary: "border border-hairline-strong text-ink hover:bg-elevation-2",
  ghost: "text-ink-muted hover:text-ink",
  // Danger is its own hue, never Signal (COLOR_V2 principle 2).
  danger: "text-danger",
};

/**
 * 44 / 44 / 56px. `sm` was 36px (`size-9`), which put every control using it
 * under the 44x44 touch baseline (WCAG 2.5.5, iOS 44pt, Android 48dp) —
 * measured across 16 routes by `scripts/qa/mobile-quality-2026-09-26.mjs`,
 * which found it on a Wave card's Echo/Comment/Save row and, worse, on a
 * "Play this Wave" transport control, where DESIGN.md §12.10 additionally
 * requires the largest target on the screen.
 *
 * Raised rather than overlaid with an expanded hit area on purpose: these
 * controls sit in rows a couple of `gap` steps apart, so 44px invisible hit
 * areas would overlap and the later-painted one would swallow its
 * neighbour's taps. `sm` keeps the same 20px glyph, so only the padding
 * grows; it now differs from `md` in its label typography, not its box.
 */
const SIZES: Record<IconButtonSize, string> = {
  sm: "size-11",
  md: "size-11",
  lg: "size-14",
};

const LABELLED_SIZES: Record<IconButtonSize, string> = {
  sm: "h-11 w-auto px-3 type-caption",
  md: "h-11 w-auto px-4 type-subhead",
  lg: "h-14 w-auto px-5 type-subhead",
};

/** Radius follows the record-key curvature rule, 0.295 x side (§5.2). */
const KEY_RADII: Record<IconButtonSize, string> = {
  sm: "rounded-[11px]",
  md: "rounded-[13px]",
  lg: "rounded-[17px]",
};

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  shape = "key",
  loading = false,
  showLabel = false,
  className,
  disabled,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      title={showLabel ? undefined : label}
      className={cn(
        BASE,
        VARIANTS[variant],
        showLabel ? LABELLED_SIZES[size] : SIZES[size],
        showLabel || shape === "key" ? KEY_RADII[size] : "rounded-full",
        className,
      )}
    >
      {loading ? (
        <Spinner size={size === "lg" ? "md" : "sm"} label={null} />
      ) : (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      )}
      {showLabel ? <span>{label}</span> : <VisuallyHidden>{label}</VisuallyHidden>}
    </button>
  );
}
