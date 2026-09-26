"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/ui";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: ReactNode;
  /** Hide the label visually; it stays available to screen readers. */
  hideLabel?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * An on/off control: 52x32 with a 10px-radius travel, the current when on
 * (`DESIGN_DNA.json` component_notes; recoloured from ink by
 * `docs/design/COLOR_V2.md` — an "on" state is exactly the kind of moving,
 * stateful control colour belongs on). Uses `role="switch"` on a real button
 * so keyboard activation and state announcement come from the platform.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  hideLabel = false,
  disabled = false,
  id,
  className,
}: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? generatedId;
  const labelId = `${switchId}-label`;
  const descriptionId = `${switchId}-description`;

  return (
    <div className={cn("flex items-start justify-between gap-5", className)}>
      <div className={cn("min-w-0", hideLabel && "sr-only")}>
        <span id={labelId} className="type-subhead block text-ink">
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className="type-caption measure mt-1 block text-ink-subtle">
            {description}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        id={switchId}
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          // `akinti-tap`: the 32px track is the design; the touch baseline
          // (WCAG 2.5.5) is met with an expanded hit area instead. Switches
          // stack in rows with a description between them, so it cannot
          // overlap the next control. Already correctly named via
          // `aria-labelledby`, which is why axe never flagged these.
          "akinti-press akinti-tap relative inline-flex h-8 w-13 shrink-0 items-center rounded-field border",
          "transition-colors duration-[--dur-micro]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide",
          "disabled:cursor-not-allowed disabled:opacity-55",
          checked ? "border-tide bg-tide" : "border-hairline-strong bg-transparent",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block size-6 rounded-[7px] transition-transform duration-[--dur-micro]",
            checked ? "translate-x-[1.5rem] bg-paper" : "translate-x-[0.1875rem] bg-hairline-strong",
          )}
        />
      </button>
    </div>
  );
}
