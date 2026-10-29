<script setup lang="ts">
import { computed } from "vue";
import { GIB } from "../../utils/monitor-chart";
import type { MetricSeries } from "../../utils/monitor-chart";
const { minutes, paused, start, end, visibleSamples, values, message, device, togglePause } =
  useMonitor();
const temperatureSeries: MetricSeries[] = [
  { key: "cpuTemperature", label: "CPU", color: "var(--monitor-cpu)" },
  { key: "gpuTemperature", label: "GPU", color: "var(--monitor-gpu)" },
];
const cpuSeries: MetricSeries[] = [
  { key: "cpuPercent", label: "CPU", color: "var(--monitor-cpu)" },
];
const gpuSeries: MetricSeries[] = [
  { key: "gpuPercent", label: "GPU", color: "var(--monitor-gpu)" },
];
const memorySeries: MetricSeries[] = [
  { key: "memoryUsedBytes", label: "内存", color: "var(--monitor-memory)" },
];
const total = computed(() => device.value?.memoryTotalBytes ?? null);
const temperatureMaximum = computed(() => {
  const peak = Math.max(
    80,
    ...visibleSamples.value.flatMap((sample) => [
      sample.cpuTemperature ?? 0,
      sample.gpuTemperature ?? 0,
    ]),
  );
  return Math.ceil((peak + 5) / 10) * 10;
});
</script>

<template>
  <main
    class="mx-auto w-full max-w-296 px-8 py-9 max-[700px]:px-4 max-[700px]:py-5"
    aria-label="本机监控"
  >
    <MonitorToolbar
      :minutes="minutes"
      :paused="paused"
      :message="message"
      @range="minutes = $event"
      @pause="togglePause"
    />
    <div class="grid grid-cols-2 gap-5 max-[700px]:grid-cols-1 max-[700px]:gap-4">
      <MonitorMetricPanel
        title="温度"
        :series="temperatureSeries"
        :samples="visibleSamples"
        :values="values"
        :start="start"
        :end="end"
        unit="°C"
        :maximum="temperatureMaximum"
      />
      <MonitorMetricPanel
        title="CPU"
        :series="cpuSeries"
        :samples="visibleSamples"
        :values="values"
        :start="start"
        :end="end"
        unit="%"
        :maximum="100"
      />
      <MonitorMetricPanel
        title="GPU"
        :series="gpuSeries"
        :samples="visibleSamples"
        :values="values"
        :start="start"
        :end="end"
        unit="%"
        :maximum="100"
      />
      <MonitorMetricPanel
        title="内存"
        :series="memorySeries"
        :samples="visibleSamples"
        :values="values"
        :start="start"
        :end="end"
        unit="GiB"
        :maximum="total ? total / GIB : 18"
        :divisor="GIB"
        :total="total"
      />
    </div>
  </main>
</template>
