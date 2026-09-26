"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { runSearch } from "@/app/(app)/search/actions";
import { Avatar, IconButton, Input, Spinner, TabPanel, Tabs, tabId, tabPanelId } from "@/components/ui";
import { Clock, Search, X } from "@/components/ui/icons";
import { TrackCard } from "@/components/tracks";
import { WaveCardContainer, WaveCardSkeleton, type WaveCardContainerWave } from "@/components/wave";
import { routes } from "@/config/routes";
import { formatCount, useIsDesktopViewport } from "@/lib/ui";
import type { Profile } from "@/types/domain";

import { ExploreWaveCard } from "./ExploreWaveCard";
import type { BackingTrackCard } from "./BackingTracksLane";
import { useRecentSearches } from "./useRecentSearches";

export interface SearchViewProps {
  initialQuery: string;
  initialProfiles: Profile[];
  initialWaves: WaveCardContainerWave[];
  initialTracks: BackingTrackCard[];
  initialError: string | null;
}

const DEBOUNCE_MS = 300;
const TAB_ID_PREFIX = "search";

type Status = "idle" | "loading" | "error";
type Tab = "waves" | "people" | "tracks" | "tags";

/**
 * Search (SCREENS.md §4; this pass's brief, item 4: "results in tabs — Waves,
 * People, Tracks, Tags — with a grid/list per tab, recent searches as chips
 * with icons, keyboard navigation").
 *
 * Mobile keeps its original stacked-sections layout exactly as it was
 * (results are rail items, recent searches a plain list) — the desktop
 * branch below is additive, picked once via `useIsDesktopViewport` rather
 * than mounted alongside the mobile branch. Keyboard navigation on the tab
 * strip comes from `Tabs` itself (arrow keys/Home/End, WAI-ARIA manual
 * activation) — no extra wiring needed here.
 *
 * "Tracks" has no dedicated search index (`runSearch`'s own `searchTracks`
 * filters the backing-track library's own title/artist/genre text — see
 * that file's doc comment); "Tags" is not a fetch at all, it is the real,
 * already-fetched Wave results' own `tags`, deduped and counted — never a
 * global hashtag index, and never fabricated when there happen to be none.
 */
export function SearchView({
  initialQuery,
  initialProfiles,
  initialWaves,
  initialTracks,
  initialError,
}: SearchViewProps) {
  const router = useRouter();
  const t = useTranslations("SearchView");
  const tTerms = useTranslations("Terms");
  const isDesktop = useIsDesktopViewport();
  const [query, setQuery] = useState(initialQuery);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [waves, setWaves] = useState(initialWaves);
  const [tracks, setTracks] = useState(initialTracks);
  const [status, setStatus] = useState<Status>(initialError ? "error" : "idle");
  const [error, setError] = useState<string | null>(initialError);
  const [tab, setTab] = useState<Tab>("waves");
  const recent = useRecentSearches();
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const search = useCallback(
    (trimmed: string) => {
      const requestId = ++requestIdRef.current;
      setStatus("loading");
      setError(null);
      router.replace(routes.search(trimmed), { scroll: false });
      void runSearch(trimmed).then(
        (result) => {
          if (requestIdRef.current !== requestId) return;
          if (result.ok && result.data) {
            setProfiles(result.data.profiles);
            setWaves(result.data.waves);
            setTracks(result.data.tracks);
            setStatus("idle");
            recent.remember(trimmed);
          } else {
            setStatus("error");
            setError(result.error ?? t("searchFailed"));
          }
        },
        () => {
          if (requestIdRef.current !== requestId) return;
          setStatus("error");
          setError(t("searchFailed"));
        },
      );
    },
    [recent, router, t],
  );

  // Debouncing is driven from the input's own change handler, not a `query`
  // effect: the search is a response to a user action, not a value this view
  // needs to stay synchronized with.
  const handleQueryChange = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      const trimmed = nextQuery.trim();
      if (trimmed.length === 0) {
        setProfiles([]);
        setWaves([]);
        setTracks([]);
        setStatus("idle");
        setError(null);
        router.replace(routes.search(), { scroll: false });
        return;
      }

      debounceTimerRef.current = setTimeout(() => search(trimmed), DEBOUNCE_MS);
    },
    [router, search],
  );

  const runRecent = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      search(value);
    },
    [search],
  );

  // Real tags off the real Wave results, deduped and counted — never a
  // fetched or fabricated hashtag index (see the file-level doc comment).
  const tagMatches = useMemo(() => {
    const counts = new Map<string, number>();
    for (const wave of waves) {
      for (const tag of wave.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [waves]);

  const trimmedQuery = query.trim();
  const hasResults = profiles.length > 0 || waves.length > 0 || tracks.length > 0;

  const tabs = (
    [
      { value: "waves", label: tTerms("waves"), count: waves.length },
      { value: "people", label: t("people"), count: profiles.length },
      { value: "tracks", label: tTerms("tracks"), count: tracks.length },
      { value: "tags", label: t("tags"), count: tagMatches.length },
    ] satisfies { value: Tab; label: string; count: number }[]
  ).filter((item) => item.count > 0);

  // The active tab may point at one this search no longer has results for
  // (e.g. it had Waves, the next query only matches People) — fall back to
  // the first tab that actually has something rather than an empty panel.
  const activeTab = tabs.some((item) => item.value === tab) ? tab : (tabs[0]?.value ?? "waves");

  const searchInput = (
    <Input
      id="search-query"
      label={tTerms("search")}
      hideLabel
      type="search"
      placeholder={t("placeholder")}
      value={query}
      onChange={(event) => handleQueryChange(event.target.value)}
      leadingIcon={<Search className="size-5" />}
      trailingSlot={status === "loading" ? <Spinner size="sm" /> : undefined}
      autoFocus
    />
  );

  if (isDesktop) {
    return (
      <div className="akinti-page flex flex-col gap-6 pb-16">
        <div className="max-w-xl">{searchInput}</div>

        {trimmedQuery.length === 0 ? (
          recent.items.length > 0 ? (
            <section aria-labelledby="recent-searches" className="flex flex-col gap-3">
              <h2 id="recent-searches" className="type-caption-strong text-ink-muted">
                {t("recent")}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {recent.items.map((item) => (
                  <li key={item}>
                    <span className="group inline-flex h-9 items-center gap-2 rounded-tag border border-hairline pl-3 pr-1.5 type-caption text-ink transition-colors hover:border-hairline-strong">
                      <Clock className="size-3.5 text-ink-subtle" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => runRecent(item)}
                        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
                      >
                        {item}
                      </button>
                      <IconButton
                        label={t("removeFromRecent", { item })}
                        icon={<X className="size-3.5" />}
                        size="sm"
                        className="size-6"
                        onClick={() => recent.forget(item)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="type-body measure text-ink-muted">{t("emptyPrompt", { aWave: tTerms("aWave") })}</p>
          )
        ) : status === "error" ? (
          <div className="flex flex-col items-start gap-4">
            <p role="alert" className="type-body measure text-ink">
              {error ?? t("searchFailed")}
            </p>
            <button
              type="button"
              onClick={() => search(trimmedQuery)}
              className="akinti-press inline-flex h-11 items-center rounded-key border border-hairline-strong px-4 type-subhead text-ink transition-colors hover:bg-paper-sunk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
            >
              {t("tryAgain")}
            </button>
          </div>
        ) : status === "loading" && !hasResults ? (
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <WaveCardSkeleton />
          </div>
        ) : !hasResults ? (
          <div className="flex flex-col items-start gap-4">
            <p className="type-body measure text-ink">{t("noMatch", { query: trimmedQuery })}</p>
            <Link
              href={routes.explore()}
              className="akinti-press inline-flex h-11 items-center rounded-key border border-hairline-strong px-4 type-subhead text-ink transition-colors hover:bg-paper-sunk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
            >
              {t("browseExplore", { explore: tTerms("explore") })}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <Tabs
              items={tabs.map(({ value, label, count }) => ({ value, label, count }))}
              value={activeTab}
              onValueChange={(value) => setTab(value as Tab)}
              label={t("resultsTabsLabel")}
              idPrefix={TAB_ID_PREFIX}
            />

            <TabPanel id={tabPanelId(TAB_ID_PREFIX, "waves")} labelledBy={tabId(TAB_ID_PREFIX, "waves")} active={activeTab === "waves"}>
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                {waves.map((wave) => (
                  <ExploreWaveCard key={wave.id} wave={wave} />
                ))}
              </div>
            </TabPanel>

            <TabPanel id={tabPanelId(TAB_ID_PREFIX, "people")} labelledBy={tabId(TAB_ID_PREFIX, "people")} active={activeTab === "people"}>
              <ul className="flex flex-col divide-y divide-hairline border-t border-hairline">
                {profiles.map((profile) => {
                  const name = profile.displayName ?? profile.username;
                  return (
                    <li key={profile.id}>
                      <Link
                        href={routes.profile(profile.username)}
                        className="flex items-center gap-3 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tide"
                      >
                        <Avatar name={name} src={profile.avatarUrl} size="md" />
                        <span className="flex min-w-0 flex-col">
                          <span className="type-subhead truncate text-ink">{name}</span>
                          <span className="type-caption truncate text-ink-subtle">
                            @{profile.username}
                            {profile.counts.followers > 0 ? (
                              <>
                                <span aria-hidden="true"> · </span>
                                <span className="type-mono-sm">{formatCount(profile.counts.followers)}</span> {t("followers")}
                              </>
                            ) : null}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </TabPanel>

            <TabPanel id={tabPanelId(TAB_ID_PREFIX, "tracks")} labelledBy={tabId(TAB_ID_PREFIX, "tracks")} active={activeTab === "tracks"}>
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
                {tracks.map((track) => (
                  <TrackCard key={track.id} track={track} />
                ))}
              </div>
            </TabPanel>

            <TabPanel id={tabPanelId(TAB_ID_PREFIX, "tags")} labelledBy={tabId(TAB_ID_PREFIX, "tags")} active={activeTab === "tags"}>
              <ul className="flex flex-wrap gap-2">
                {tagMatches.map(([tag, count]) => (
                  <li key={tag}>
                    <Link
                      href={routes.hashtag(tag)}
                      className="akinti-press inline-flex h-9 items-center gap-1.5 rounded-tag border border-hairline px-3 type-caption text-ink transition-colors hover:border-hairline-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
                    >
                      #{tag}
                      <span className="type-mono-sm text-ink-subtle">{count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </TabPanel>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-10">
      <div className="akinti-page">{searchInput}</div>

      {trimmedQuery.length === 0 ? (
        recent.items.length > 0 ? (
          <section aria-labelledby="recent-searches" className="flex flex-col gap-1 pt-8">
            <h2 id="recent-searches" className="akinti-page type-caption-strong pb-2 text-ink-muted">
              {t("recent")}
            </h2>
            <ul className="flex flex-col">
              {recent.items.map((item) => (
                <li
                  key={item}
                  className="akinti-page flex items-center gap-2 border-b border-hairline last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => runRecent(item)}
                    className="min-w-0 flex-1 truncate py-4 text-left type-body text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
                  >
                    {item}
                  </button>
                  <IconButton
                    label={t("removeFromRecent", { item })}
                    icon={<X className="size-4" />}
                    size="sm"
                    onClick={() => recent.forget(item)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="akinti-page type-body measure pt-8 text-ink-muted">
            {t("emptyPrompt", { aWave: tTerms("aWave") })}
          </p>
        )
      ) : status === "error" ? (
        <div className="akinti-page flex flex-col items-start gap-4 pt-8">
          <p role="alert" className="type-body measure text-ink">
            {error ?? t("searchFailed")}
          </p>
          <button
            type="button"
            onClick={() => search(trimmedQuery)}
            className="akinti-press inline-flex h-11 items-center rounded-key border border-hairline-strong px-4 type-subhead text-ink transition-colors hover:bg-paper-sunk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
          >
            {t("tryAgain")}
          </button>
        </div>
      ) : status === "loading" && !hasResults ? (
        <div className="pt-6">
          <WaveCardSkeleton />
        </div>
      ) : !hasResults ? (
        <div className="akinti-page flex flex-col items-start gap-4 pt-8">
          <p className="type-body measure text-ink">{t("noMatch", { query: trimmedQuery })}</p>
          <Link
            href={routes.explore()}
            className="akinti-press inline-flex h-11 items-center rounded-key border border-hairline-strong px-4 type-subhead text-ink transition-colors hover:bg-paper-sunk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide"
          >
            {t("browseExplore", { explore: tTerms("explore") })}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col">
          {profiles.length > 0 ? (
            <section aria-labelledby="search-people" className="flex flex-col pt-8">
              <h2 id="search-people" className="akinti-page type-caption-strong pb-2 text-ink-muted">
                {t("people")}
              </h2>
              <ul className="flex flex-col">
                {profiles.map((profile) => {
                  const name = profile.displayName ?? profile.username;
                  return (
                    <li key={profile.id}>
                      <Link
                        href={routes.profile(profile.username)}
                        className="akinti-rail akinti-page items-center border-b border-hairline py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tide"
                      >
                        <Avatar name={name} src={profile.avatarUrl} size="md" />
                        <span className="flex min-w-0 flex-col">
                          <span className="type-subhead truncate text-ink">{name}</span>
                          <span className="type-caption truncate text-ink-subtle">
                            @{profile.username}
                            {profile.counts.followers > 0 ? (
                              <>
                                <span aria-hidden="true"> · </span>
                                <span className="type-mono-sm">
                                  {formatCount(profile.counts.followers)}
                                </span>{" "}
                                {t("followers")}
                              </>
                            ) : null}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {waves.length > 0 ? (
            <section aria-labelledby="search-waves" className="flex flex-col pt-8">
              <h2 id="search-waves" className="akinti-page type-caption-strong text-ink-muted">
                {tTerms("waves")}
              </h2>
              <div className="flex flex-col">
                {waves.map((wave) => (
                  <WaveCardContainer key={wave.id} wave={wave} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
