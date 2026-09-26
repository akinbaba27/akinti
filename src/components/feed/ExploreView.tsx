"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useReducer, useState } from "react";

import { loadExploreCategory } from "@/app/(app)/explore/actions";
import { Tabs, tabId, tabPanelId } from "@/components/ui";
import type { WaveCardContainerWave } from "@/components/wave";
import { routes } from "@/config/routes";
import {
  EXPLORE_CATEGORIES,
  EXPLORE_CATEGORY_META,
  createInitialFeedState,
  feedReducer,
  type ExploreCategory,
} from "@/lib/feed";

import { WaveFeedList } from "./WaveFeedList";

export interface ExploreViewProps {
  initialCategory: ExploreCategory;
  initialItems: WaveCardContainerWave[];
  initialCursor: string | null;
}

/**
 * Explore's filter row and stream (SCREENS.md §3).
 *
 * One 40px row, horizontally scrollable, the active lane marked by a 2px ink
 * underbar rather than a filled pill (§8.8, §12.4). One `feedReducer` per
 * lane, loaded the first time that lane is opened, so switching back never
 * refetches what the reader already has.
 */
export function ExploreView({ initialCategory, initialItems, initialCursor }: ExploreViewProps) {
  const t = useTranslations("ExploreView");
  const tTerms = useTranslations("Terms");
  const [active, setActive] = useState<ExploreCategory>(initialCategory);
  const [statesByCategory, dispatch] = useReducer(
    categoriesReducer,
    initialCategoryStates(initialCategory, initialItems, initialCursor),
  );

  const state =
    statesByCategory.get(active) ?? createInitialFeedState<WaveCardContainerWave>([], null);

  const tabItems = useMemo(
    () =>
      EXPLORE_CATEGORIES.map((key) => ({
        value: key,
        label: EXPLORE_CATEGORY_META[key].label,
      })),
    [],
  );

  /**
   * What each lane says when it has nothing, and the one action that repairs
   * it. Never "No data" and never a shrug (§8.14, `mobile-guidelines.md` 6-7).
   */
  const emptyCopy = useMemo<
    Record<ExploreCategory, { line: string; action: { label: string; href: string } }>
  >(
    () => ({
      trending: {
        line: t("emptyTrending"),
        action: { label: t("hearWhatIsNew"), href: routes.explore() },
      },
      new: {
        line: t("emptyNew"),
        action: { label: t("recordAWave", { aWave: tTerms("aWave") }), href: routes.create() },
      },
      rising: {
        line: t("emptyRising"),
        action: { label: t("showTrendingInstead"), href: routes.explore() },
      },
      original: {
        line: t("emptyOriginal"),
        action: { label: t("recordAWave", { aWave: tTerms("aWave") }), href: routes.create() },
      },
      voices: {
        line: t("emptyVoices"),
        action: { label: t("recordAWave", { aWave: tTerms("aWave") }), href: routes.create() },
      },
      compositions: {
        line: t("emptyCompositions"),
        action: { label: t("recordAWave", { aWave: tTerms("aWave") }), href: routes.create() },
      },
      open_for_duet: {
        line: t("emptyOpenForDuet"),
        action: { label: t("findPeopleToFollow"), href: routes.explore() },
      },
    }),
    [t, tTerms],
  );

  const loadCategory = useCallback((category: ExploreCategory, cursor: string | null) => {
    dispatch({ type: "start", category });
    void loadExploreCategory(category, cursor).then(
      (result) => {
        if (result.ok && result.data) {
          dispatch({
            type: "success",
            category,
            items: result.data.items,
            cursor: result.data.nextCursor,
          });
        } else {
          dispatch({
            type: "error",
            category,
            error: result.error ?? t("streamError"),
          });
        }
      },
      // The Server Action call itself can reject — a network drop, a
      // dev-server chunk error, anything short of the `{ ok, error }`
      // contract. Without this, a lane that hits one of those never leaves
      // "loading": nothing else moves its status away from the skeleton.
      () => {
        dispatch({ type: "error", category, error: t("streamError") });
      },
    );
  }, [t]);

  const handleTabChange = useCallback(
    (value: string) => {
      const category = value as ExploreCategory;
      setActive(category);
      if (!statesByCategory.get(category)) {
        loadCategory(category, null);
      }
    },
    [loadCategory, statesByCategory],
  );

  const handleLoadMore = useCallback(() => {
    if (!state.cursor || state.status === "loading") {
      return;
    }
    loadCategory(active, state.cursor);
  }, [active, loadCategory, state.cursor, state.status]);

  const baseId = "explore-lanes";
  const empty = emptyCopy[active];
  const isEmpty = state.items.length === 0 && state.status !== "loading";

  return (
    <div className="flex flex-col pt-8">
      <div className="akinti-page sticky top-top-bar z-10 bg-paper md:top-0">
        <Tabs
          items={tabItems}
          value={active}
          onValueChange={handleTabChange}
          label={t("exploreLanes")}
          idPrefix={baseId}
        />
      </div>

      <div
        role="tabpanel"
        id={tabPanelId(baseId, active)}
        aria-labelledby={tabId(baseId, active)}
        className="pt-2 focus-visible:outline-2 focus-visible:outline-tide"
      >
        {isEmpty ? (
          <div className="akinti-page flex flex-col items-start gap-4 py-8">
            <p className="type-body measure text-ink">
              {state.status === "error" ? (state.error ?? t("streamError")) : empty.line}
            </p>
            {state.status === "error" ? (
              <button
                type="button"
                onClick={() => loadCategory(active, null)}
                className="akinti-press inline-flex h-11 items-center rounded-key border border-hairline-strong px-4 type-subhead text-ink transition-colors hover:bg-paper-sunk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
              >
                {t("tryAgain")}
              </button>
            ) : (
              <Link
                href={empty.action.href}
                className="akinti-press inline-flex h-11 items-center rounded-key border border-hairline-strong px-4 type-subhead text-ink transition-colors hover:bg-paper-sunk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
              >
                {empty.action.label}
              </Link>
            )}
          </div>
        ) : (
          <WaveFeedList
            items={state.items}
            status={state.status}
            error={state.error}
            hasMore={state.cursor !== null}
            onLoadMore={handleLoadMore}
            endLabel={t("endOfLane")}
          />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local state: one FeedState per lane, keyed by lane                          */
/* -------------------------------------------------------------------------- */

type CategoryStates = Map<
  ExploreCategory,
  ReturnType<typeof createInitialFeedState<WaveCardContainerWave>>
>;

type CategoriesAction =
  | { type: "start"; category: ExploreCategory }
  | {
      type: "success";
      category: ExploreCategory;
      items: WaveCardContainerWave[];
      cursor: string | null;
    }
  | { type: "error"; category: ExploreCategory; error: string };

function initialCategoryStates(
  category: ExploreCategory,
  items: WaveCardContainerWave[],
  cursor: string | null,
): CategoryStates {
  const map: CategoryStates = new Map();
  map.set(category, createInitialFeedState(items, cursor));
  return map;
}

function categoriesReducer(state: CategoryStates, action: CategoriesAction): CategoryStates {
  const current =
    state.get(action.category) ?? createInitialFeedState<WaveCardContainerWave>([], null);
  const next = new Map(state);
  switch (action.type) {
    case "start":
      next.set(action.category, feedReducer(current, { type: "loadMoreStart" }));
      return next;
    case "success":
      next.set(
        action.category,
        feedReducer(current, {
          type: "loadMoreSuccess",
          items: action.items,
          cursor: action.cursor,
        }),
      );
      return next;
    case "error":
      next.set(
        action.category,
        feedReducer(current, { type: "loadMoreError", error: action.error }),
      );
      return next;
    default:
      return state;
  }
}
