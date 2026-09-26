"use client";

/**
 * A small desktop-only primitive (`DESIGN_V3_DESKTOP.md`/the desktop-screens
 * brief: "lanes as horizontal scrollers with arrows"). Overlays a pair of
 * prev/next arrow buttons on top of an existing horizontally-scrolling
 * strip (`RisingCreatorsStrip`, `OpenCallsLane`, `BackingTracksLane`) —
 * mouse/trackpad scroll and touch swipe keep working exactly as before,
 * this is an additional way in, not a replacement for it.
 *
 * Takes the caller's own scroll ref rather than rendering the scrolling
 * element itself, so the wrapped list keeps its real semantic tag (`<ul>`
 * for a list of creators, in `RisingCreatorsStrip`'s case) instead of being
 * forced into a generic `<div>`.
 *
 * Reported to the desktop-screens/shell owners as a small addition under
 * `src/components/ui/desktop/`, per the brief's exception for new small
 * primitives there.
 */

import { useCallback, useEffect, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";

import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { cn } from "@/lib/ui";

export interface HorizontalScrollerProps {
  /** Ref to the caller's own scrolling element (attached to its `onScroll`). */
  scrollRef: RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className?: string;
}

export function HorizontalScroller({ scrollRef, children, className }: HorizontalScrollerProps) {
  const t = useTranslations("HorizontalScroller");
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `scrollRef` is a stable ref object
  }, []);

  useEffect(() => {
    updateEdges();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateEdges, { passive: true });
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `scrollRef` is a stable ref object
  }, [updateEdges]);

  const scrollBy = useCallback(
    (direction: 1 | -1) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `scrollRef` is a stable ref object
    [],
  );

  return (
    <div className={cn("group/scroller relative", className)}>
      {children}

      {atStart ? null : (
        <button
          type="button"
          aria-label={t("scrollPrevious")}
          onClick={() => scrollBy(-1)}
          className="akinti-press absolute top-1/2 -left-3 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-hairline-strong bg-elevation-2 text-ink opacity-0 shadow-lift transition-opacity duration-150 group-hover/scroller:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide lg:flex"
        >
          <ChevronLeft className="size-4" />
        </button>
      )}
      {atEnd ? null : (
        <button
          type="button"
          aria-label={t("scrollNext")}
          onClick={() => scrollBy(1)}
          className="akinti-press absolute top-1/2 -right-3 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-hairline-strong bg-elevation-2 text-ink opacity-0 shadow-lift transition-opacity duration-150 group-hover/scroller:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide lg:flex"
        >
          <ChevronRight className="size-4" />
        </button>
      )}
    </div>
  );
}
