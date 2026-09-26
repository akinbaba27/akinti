import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FlowActionBar, type FlowActionBarProps } from "./FlowActionBar";
import { FlowRail, type FlowRailProps } from "./FlowRail";

/**
 * Flow is the app's default screen after login (`docs/FLOW.md`), and it was the
 * one surface the Echo pass left out — `docs/ECHOES.md`'s "Known gaps" called
 * wiring it here "purely a UI wiring task for later". These tests pin the
 * result, because Flow cannot be checked by eye on this project right now: every
 * Wave is `hidden_at`-set, so `/flow` renders its empty state and neither
 * control below is on screen to look at.
 *
 * `FlowRail` is the mobile thumb-zone rail and `FlowActionBar` the desktop row;
 * both had to gain the control, so both are covered.
 */

const railProps = (overrides: Partial<FlowRailProps> = {}): FlowRailProps => ({
  isSaved: false,
  saveCount: 0,
  isEchoed: false,
  echoCount: 0,
  commentCount: 0,
  shareCount: 0,
  duetCount: 0,
  canRequestDuet: true,
  openForDuet: false,
  onReplay: vi.fn(),
  onEcho: vi.fn(),
  onSave: vi.fn(),
  onComment: vi.fn(),
  onShare: vi.fn(),
  onDuet: vi.fn(),
  ...overrides,
});

const barProps = (overrides: Partial<FlowActionBarProps> = {}): FlowActionBarProps => ({
  ...railProps(),
  ...overrides,
});

describe.each([
  ["FlowRail (mobile)", (p: Partial<FlowRailProps>) => <FlowRail {...railProps(p)} />],
  ["FlowActionBar (desktop)", (p: Partial<FlowActionBarProps>) => <FlowActionBar {...barProps(p)} />],
])("%s", (_name, renderWith) => {
  it("offers an Echo control", () => {
    render(renderWith({}));
    expect(screen.getByRole("button", { name: /^Echo$/i })).toBeInTheDocument();
  });

  it("calls onEcho when it is pressed", () => {
    const onEcho = vi.fn();
    render(renderWith({ onEcho }));
    fireEvent.click(screen.getByRole("button", { name: /^Echo$/i }));
    expect(onEcho).toHaveBeenCalledTimes(1);
  });

  it("reads as pressed and offers to remove the Echo once echoed", () => {
    render(renderWith({ isEchoed: true }));
    const control = screen.getByRole("button", { name: /remove echo/i });
    expect(control).toHaveAttribute("aria-pressed", "true");
  });

  it("is not pressed when the viewer has not echoed", () => {
    render(renderWith({}));
    expect(screen.getByRole("button", { name: /^Echo$/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a real Echo count and never a zero one", () => {
    const { unmount } = render(renderWith({ echoCount: 7, isEchoed: true }));
    expect(screen.getByText("7")).toBeInTheDocument();
    unmount();

    // "Never print a zero metric" (DESIGN.md §12.6/§12.23) — the same rule
    // `WaveCard` follows for this count.
    render(renderWith({ echoCount: 0 }));
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
