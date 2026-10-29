<script setup lang="ts">
import { computed, shallowRef } from "vue";
import type { ChartPoint } from "@tanstack/charts/vue";
import type { MetricValues, MonitorSample } from "../../../shared/types/monitor";
import { chartRows, formatTime, metricChart, type MetricSeries } from "../../utils/monitor-chart";

const props = withDefaults(
  defineProps<{
    title: string;
    series: MetricSeries[];
    samples: MonitorSample[];
    values: MetricValues;
    start: number;
    end: number;
    unit: string;
    maximum: number;
    divisor?: number;
    total?: number | null;
  }>(),
  { divisor: 1, total: null },
);
const rows = computed(() => chartRows(props.samples, props.series, props.divisor));
const definition = computed(() =>
  metricChart(rows.value, props.series, props.start, props.end || 1, props.maximum),
);
const readings = computed(() =>
  props.series.map((series) => {
    const raw = props.values[series.key];
    return { ...series, value: raw == null ? "" : (raw / props.divisor).toFixed(1) };
  }),
);
const focused = shallowRef<readonly ChartPoint[]>([]);
const tooltipLabel = computed(() => {
  const first = focused.value[0];
  if (!first) return props.title;
  return `${formatTime(Number(first.xValue))}，${focused.value.map((point) => `${point.groupLabel} ${Number(point.yValue).toFixed(1)} ${props.unit}`).join("，")}`;
});
</script>

<template>
  <section
    class="min-w-0 rounded-xl border border-default bg-default px-5 pt-6 pb-3 max-[480px]:px-2.5 max-[480px]:pt-5 max-[480px]:pb-2"
    :aria-label="title"
  >
    <div class="min-h-[78px] px-2.5">
      <h2 class="mb-3.5 text-[13px] font-medium text-muted">{{ title }}</h2>
      <div class="flex flex-wrap items-baseline gap-6 max-[480px]:gap-4">
        <div
          v-for="reading in readings"
          :key="reading.key"
          class="flex items-baseline gap-1.5 whitespace-nowrap"
        >
          <span
            v-if="series.length > 1"
            class="mr-0.5 text-[11px]"
            :style="{ color: reading.color }"
            >{{ reading.label }}</span
          >
          <span
            class="inline-block w-[5ch] shrink-0 text-right font-mono text-3xl leading-none font-medium tabular-nums max-[480px]:text-[27px]"
            :data-metric="reading.key"
            >{{ reading.value }}</span
          >
          <span v-if="total != null" class="font-mono text-[13px] text-muted tabular-nums"
            >/ {{ (total / divisor).toFixed(0) }}</span
          >
          <span class="text-[13px] text-muted">{{ unit }}</span>
        </div>
      </div>
    </div>
    <UChart
      type="area"
      :definition="definition"
      :height="220"
      :aria-label="`${title}趋势`"
      :aria-description="`随时间变化的${unit}读数`"
      :legend="false"
      :tooltip="{ content: { ariaLabel: tooltipLabel } }"
      @focus-group-change="focused = $event"
      class="mt-3"
    >
      <template #tooltip="{ points, primaryPoint }">
        <div class="min-w-30 px-0.5 py-0.75 text-xs tabular-nums">
          <span class="mb-1.5 block text-muted">{{ formatTime(Number(primaryPoint.xValue)) }}</span>
          <div
            v-for="point in points"
            :key="String(point.groupLabel)"
            class="flex justify-between gap-6"
          >
            <span :style="{ color: point.color }">{{ point.groupLabel }}</span>
            <span class="font-mono">{{ Number(point.yValue).toFixed(1) }} {{ unit }}</span>
          </div>
        </div>
      </template>
    </UChart>
  </section>
</template>
