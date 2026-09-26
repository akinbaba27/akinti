"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Select, type SelectOption } from "@/components/ui";
import { cn, formatCount } from "@/lib/ui";
import type { CreatorAnalyticsDay } from "@/types/domain";

type MetricKey = "plays" | "uniqueListeners" | "replays" | "saves" | "comments" | "shares" | "newFollowers";

function formatShortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export interface AnalyticsTimeseriesChartProps {
  /** Exactly the requested range's worth of days, already gap-filled — see `fillAnalyticsTimeseriesGaps`. */
  days: readonly CreatorAnalyticsDay[];
  className?: string;
}

/**
 * A single-metric daily bar chart, built from small inline `<rect>`s (no
 * charting library, spec §13/§27/§40 own the numbers — this only draws
 * them). One metric at a time by design: seven series with very different
 * scales (Plays vs. Comments) on one axis would misrepresent every one of
 * them, so a `<select>` swaps the series instead of overlaying them.
 * `showTable` gives every value as real `<table>` markup for anyone who
 * can't or doesn't want to read the chart (spec §29) — full keyboard access
 * via the toggle button, not a mouse-only affordance.
 */
export function AnalyticsTimeseriesChart({ days, className }: AnalyticsTimeseriesChartProps) {
  const [metric, setMetric] = useState<MetricKey>("plays");
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  const t = useTranslations("AnalyticsTimeseriesChart");
  const tTerms = useTranslations("Terms");

  const metricLabels: Record<MetricKey, string> = {
    plays: tTerms("plays"),
    uniqueListeners: t("metricUniqueListeners"),
    replays: tTerms("replays"),
    saves: tTerms("saves"),
    comments: tTerms("comments"),
    shares: tTerms("shares"),
    newFollowers: t("metricNewFollowers"),
  };
  const metricOptions: SelectOption[] = Object.entries(metricLabels).map(([value, label]) => ({
    value,
    label,
  }));

  const values = days.map((day) => day[metric]);
  const max = Math.max(1, ...values);
  const barUnit = 12;
  const barCount = Math.max(days.length, 1);

  const rangeLabel =
    days.length > 0 ? `${formatShortDate(days[0]!.day)} – ${formatShortDate(days[days.length - 1]!.day)}` : "";

  return (
    <div className={cn("flex flex-col rounded-card lg:border lg:border-hairline lg:bg-elevation-2 lg:p-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id={titleId} className="type-caption font-semibold text-ink-muted">
            {t("dailyMetric", { metric: metricLabels[metric] })}
          </h3>
          {rangeLabel ? <p className="type-caption text-ink-subtle">{rangeLabel}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <Select
            id="analytics-chart-metric"
            label={t("chartMetricLabel")}
            hideLabel
            value={metric}
            onChange={(event) => setMetric(event.target.value as MetricKey)}
            options={metricOptions}
            containerClassName="w-44"
          />
          <button
            type="button"
            onClick={() => setShowTable((value) => !value)}
            aria-pressed={showTable}
            className="akinti-press akinti-tap type-caption h-10 shrink-0 text-ink-muted underline decoration-hairline-strong decoration-1 underline-offset-[3px] hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {showTable ? t("showChart") : t("showTable")}
          </button>
        </div>
      </div>

      {showTable ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left type-caption">
            <caption className="sr-only">{t("dailyMetric", { metric: metricLabels[metric] })}</caption>
            <thead>
              <tr className="border-b border-hairline text-ink-subtle">
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  {t("dateColumn")}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  {metricLabels[metric]}
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.day} className="border-b border-hairline/60 last:border-0">
                  <td className="py-1.5 pr-3 text-ink-muted">{formatShortDate(day.day)}</td>
                  <td className="type-mono-sm py-1.5 pr-3 tabular-nums text-ink">{formatCount(day[metric])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // One hue (the current), single scale, no gridlines/axes to draw
        // (dataviz "no chart junk"). The emphasised endpoint is the most
        // recent day: full-strength tide fill vs. a muted tide for the rest
        // of the series, so the eye lands on "where things are now" first.
        <svg
          role="img"
          aria-labelledby={titleId}
          viewBox={`0 0 ${barCount * barUnit} 120`}
          preserveAspectRatio="none"
          className="mt-4 h-28 w-full overflow-visible lg:h-40"
        >
          {days.map((day, index) => {
            const value = day[metric];
            const barHeight = value > 0 ? Math.max(4, Math.round((value / max) * 112)) : 1;
            const isEndpoint = index === days.length - 1 && value > 0;
            return (
              <rect
                key={day.day}
                x={index * barUnit + 2}
                y={120 - barHeight}
                width={barUnit - 4}
                height={barHeight}
                rx={2}
                className={value === 0 ? "fill-elevation-3" : isEndpoint ? "fill-tide" : "fill-tide/45"}
              >
                <title>{t("barTitle", { date: formatShortDate(day.day), value: formatCount(value), metric: metricLabels[metric] })}</title>
              </rect>
            );
          })}
        </svg>
      )}
    </div>
  );
}
