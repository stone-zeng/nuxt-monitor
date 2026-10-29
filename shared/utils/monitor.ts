import { metricKeys, type MetricKey, type MonitorSample } from "../types/monitor";

export const HISTORY_MS = 15 * 60 * 1000;
export const SAMPLE_INTERVAL_MS = 500;
export const MAX_SAMPLES = HISTORY_MS / SAMPLE_INTERVAL_MS;
export const STALE_MS = 3000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSample(value: unknown): MonitorSample | null {
  if (
    !isRecord(value) ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp) ||
    value.timestamp <= 0
  )
    return null;
  const values = {} as Record<MetricKey, number | null>;
  const status = {} as MonitorSample["status"];
  for (const key of metricKeys) {
    const candidate = value[key];
    let valid = typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0;
    if (valid && key.endsWith("Percent")) valid = (candidate as number) <= 100;
    if (valid && key.endsWith("Temperature"))
      valid = (candidate as number) > 0 && (candidate as number) < 150;
    if (valid && key === "memoryTotalBytes") valid = (candidate as number) > 0;
    values[key] = valid ? (candidate as number) : null;
    status[key] = valid ? "ok" : "unavailable";
  }
  if (
    values.memoryUsedBytes !== null &&
    values.memoryTotalBytes !== null &&
    values.memoryUsedBytes > values.memoryTotalBytes
  ) {
    values.memoryUsedBytes = null;
    status.memoryUsedBytes = "unavailable";
  }
  return { timestamp: value.timestamp, ...values, status };
}

export function trimHistory(samples: readonly MonitorSample[], now: number): MonitorSample[] {
  return samples
    .filter((sample) => sample.timestamp > now - HISTORY_MS && sample.timestamp <= now)
    .slice(-MAX_SAMPLES);
}

export function appendSample(
  samples: readonly MonitorSample[],
  sample: MonitorSample,
): MonitorSample[] {
  const last = samples.at(-1);
  if (last && sample.timestamp <= last.timestamp) return [...samples];
  return trimHistory([...samples, sample], sample.timestamp);
}
