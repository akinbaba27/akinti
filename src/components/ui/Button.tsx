"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "@/lib/ui";

import { Spinner } from "./Spinner";

/**
 * Keys, not buttons (`docs/design/DESIGN.md` §8.7, recoloured by
 * `docs/design/COLOR_V2.md` "Buttons").
 *
 * Three looks and no more:
 *   tide - the current fill, paper label. The single most important action
 *          on a screen.
 *   line - 1px hairline-strong, no fill, ink label. Secondary actions.
 *   text - ink label with a 1px hairline underline offset 3px, or danger
 *          text for destructive, so "Delete account" is a sentence and not
 *          a red pill.
 *
 * The v1 variant names are the public API and map onto those three:
 * `primary` is the tide key, `secondary` the line key, `ghost` and `danger`
 * the text key. Nothing is a pill (§12.4). `danger` is its own hue, not
 * Signal, which stays exclusive to live audio (COLOR_V2 principle 2).
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/** 52 / 44 / 40 / 32px tall, per §8.7. */
export type ButtonSize = "lg" | "md" | "sm" | "xs";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction without collapsing the layout. */
  loading?: boolean;
  /** Announced while `loading` is true. */
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  /**
   * Trailing glyph. Never an arrow appended to a label and never an icon in a
   * circle (§8.7) — this exists for counters and state marks.
   */
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
}

const BASE =
  "akinti-press relative inline-flex cursor-pointer select-none items-center justify-center gap-2 " +
  "rounded-key type-subhead whitespace-nowrap " +
  "transition-[background-color,border-color,color] duration-[--dur-micro] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide " +
  "disabled:cursor-not-allowed disabled:opacity-55";

const VARIANTS: Record<ButtonVariant, string> = {
  // The current fill with paper text (docs/design/COLOR_V2.md "Buttons").
  // `hover:bg-tide-2` is the one place a preview matters most: the single
  // most important action on a screen previously gave no hover feedback at
  // all (`docs/research/desktop/FEEDBACK_AUDIT.md` #2, fix list item 4).
  primary: "bg-tide text-on-ink hover:bg-tide-2",
  secondary: "border border-hairline-strong text-ink hover:bg-elevation-2",
  ghost:
    "text-ink underline decoration-hairline-strong decoration-1 underline-offset-[3px] " +
    "hover:decoration-ink",
  // Destructive is danger text only — never Signal, which stays exclusive
  // to live audio (COLOR_V2 principle 2).
  danger:
    "text-danger underline decoration-danger/60 decoration-1 underline-offset-[3px] " +
    "hover:decoration-danger",
};

/**
 * `min-w-11` alongside each height: WCAG 2.5.5 is 44x44, and a short label
 * ("Got it") cleared the height while staying 37px wide.
 */
const SIZES: Record<ButtonSize, string> = {
  lg: "h-13 min-w-13 px-6",
  md: "h-11 min-w-11 px-5",
  sm: "h-11 min-w-11 px-4",
  xs: "h-8 px-3 type-caption akinti-tap",
};

/** Text keys are a sentence, not a field: they carry no side padding. */
const TEXT_KEY_SIZES: Record<ButtonSize, string> = {
  lg: "h-13 min-w-13 px-0",
  md: "h-11 min-w-11 px-0",
  sm: "h-11 min-w-11 px-0",
  xs: "h-8 px-0 type-caption akinti-tap",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  loadingLabel = "Working",
  leadingIcon,
  trailingIcon,
  fullWidth = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  const isTextKey = variant === "ghost" || variant === "danger";

  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE,
        VARIANTS[variant],
        (isTextKey ? TEXT_KEY_SIZES : SIZES)[size],
        fullWidth && "w-full",
        className,
      )}
    >
      {loading ? (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner size={size === "lg" ? "md" : "sm"} label={loadingLabel} />
        </span>
      ) : null}
      <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
        {leadingIcon ? (
          <span aria-hidden="true" className="inline-flex shrink-0">
            {leadingIcon}
          </span>
        ) : null}
        {children}
        {trailingIcon ? (
          <span aria-hidden="true" className="inline-flex shrink-0">
            {trailingIcon}
          </span>
        ) : null}
      </span>
    </button>
  );
}
