import { computed, shallowRef } from "vue";
import type {
  MetricValues,
  MonitorDevice,
  MonitorSample,
  MonitorSnapshot,
  MonitorStatus,
} from "../../shared/types/monitor";
import { metricKeys } from "../../shared/types/monitor";
import { appendSample, STALE_MS, trimHistory } from "../../shared/utils/monitor";

export function createMonitorState() {
  const samples = shallowRef<MonitorSample[]>([]);
  const device = shallowRef<MonitorDevice | null>(null);
  const status = shallowRef<MonitorStatus>({ phase: "starting" });
  const connected = shallowRef(false);
  const now = shallowRef(0);
  const minutes = shallowRef<1 | 5 | 15>(1);
  const lastValues = shallowRef<MetricValues>(
    Object.fromEntries(metricKeys.map((key) => [key, null])) as MetricValues,
  );
  const frozen = shallowRef<{ samples: MonitorSample[]; end: number; values: MetricValues } | null>(
    null,
  );
  const values = computed(() => frozen.value?.values ?? lastValues.value);
  const paused = computed(() => frozen.value !== null);
  const stale = computed(
    () => !!samples.value.length && now.value - samples.value.at(-1)!.timestamp > STALE_MS,
  );
  const end = computed(() => frozen.value?.end ?? now.value);
  const start = computed(() => end.value - minutes.value * 60000);
  const visibleSamples = computed<MonitorSample[]>((previous) => {
    const source = frozen.value?.samples ?? samples.value;
    const first = source.findIndex((sample) => sample.timestamp >= start.value);
    // Retain the preceding point so clipping keeps the left edge continuous.
    const visible =
      first < 0
        ? []
        : source.slice(Math.max(0, first - 1)).filter((sample) => sample.timestamp <= end.value);
    // Moving the time axis must not rebuild the series between samples.
    return previous &&
      previous.length === visible.length &&
      previous[0] === visible[0] &&
      previous.at(-1) === visible.at(-1)
      ? previous
      : visible;
  });
  const latest = computed(() => {
    if (!paused.value && (stale.value || status.value.phase !== "live" || !connected.value))
      return null;
    return visibleSamples.value.at(-1) ?? null;
  });
  const message = computed(() => {
    if (!connected.value && samples.value.length) return "连接中断，正在重连";
    if (status.value.phase === "error") return status.value.message ?? "采集失败";
    if (stale.value || status.value.phase === "stale") return "数据已过期";
    return "";
  });

  function rememberReadings(incoming: readonly MonitorSample[]) {
    const next = { ...lastValues.value };
    for (const sample of incoming) {
      for (const key of metricKeys) {
        if (sample[key] !== null) next[key] = sample[key];
      }
    }
    lastValues.value = next;
  }

  function snapshot(value: MonitorSnapshot) {
    device.value = value.device;
    samples.value = trimHistory(value.samples, now.value);
    rememberReadings(samples.value);
    status.value = value.status;
    connected.value = true;
  }
  function receive(sample: MonitorSample) {
    // A system clock adjustment invalidates the former timeline.
    if (sample.timestamp < (samples.value.at(-1)?.timestamp ?? 0)) samples.value = [];
    samples.value = appendSample(samples.value, sample);
    rememberReadings([sample]);
    now.value = Date.now();
  }
  function togglePause() {
    frozen.value = frozen.value
      ? null
      : { samples: [...samples.value], end: now.value, values: lastValues.value };
  }
  return {
    samples,
    device,
    status,
    connected,
    now,
    minutes,
    paused,
    stale,
    start,
    end,
    visibleSamples,
    latest,
    values,
    message,
    snapshot,
    receive,
    togglePause,
  };
}
