import { areaY, defineChart, lineY } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { crosshair } from "@tanstack/charts/crosshair";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import type { MetricKey, MonitorSample } from "../../shared/types/monitor";
import { STALE_MS } from "../../shared/utils/monitor";

export interface MetricSeries {
  key: MetricKey;
  label: string;
  color: string;
}
export interface MetricRow {
  time: number;
  value: number | null;
  series: string;
}
export const GIB = 1024 ** 3;
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 1,
  hour12: false,
});
export const formatTime = (timestamp: number) => timeFormat.format(timestamp);
const axisTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function chartRows(
  samples: readonly MonitorSample[],
  series: readonly MetricSeries[],
  divisor = 1,
): MetricRow[] {
  return series.flatMap((metric) => {
    const rows: MetricRow[] = [];
    let previous = 0;
    for (const sample of samples) {
      if (previous && sample.timestamp - previous > STALE_MS)
        rows.push({ time: previous + 1, value: null, series: metric.label });
      const value = sample[metric.key];
      rows.push({
        time: sample.timestamp,
        value: value === null ? null : value / divisor,
        series: metric.label,
      });
      previous = sample.timestamp;
    }
    return rows;
  });
}

export function metricChart(
  rows: MetricRow[],
  series: readonly MetricSeries[],
  start: number,
  end: number,
  maximum: number,
) {
  return defineChart({
    clip: true,
    marks: [
      decorative(
        areaY(rows, {
          x: "time",
          y1: 0,
          y2: "value",
          z: "series",
          color: "series",
          fillOpacity: 0.12,
        }),
      ),
      lineY(rows, { x: "time", y: "value", z: "series", color: "series", strokeWidth: 1.75 }),
      crosshair({ x: true, y: false }),
    ],
    margin: { left: 38, right: 12, top: 12, bottom: 28 },
    scales: {
      x: {
        scale: scaleLinear().domain([start, end]),
        axis: {
          line: false,
          ticks: {
            values: [start, (start + end) / 2, end],
            format: (value: number) => axisTimeFormat.format(value),
            line: false,
          },
          tickLabels: { fontSize: 10 },
        },
      },
      y: {
        scale: scaleLinear().domain([0, maximum]),
        grid: { stroke: "var(--ui-border)", strokeOpacity: 0.6, strokeDasharray: "3 5" },
        axis: {
          line: false,
          ticks: { count: 4, line: false, format: (value: number) => `${Math.round(value)}` },
          tickLabels: { fontSize: 10 },
        },
      },
    },
    color: {
      scale: scaleOrdinal()
        .domain(series.map((metric) => metric.label))
        .range(series.map((metric) => metric.color)),
    },
    focus: "group-x",
    maxFocusDistance: Infinity,
    svgAnimation: false,
  });
}
