export const metricKeys = [
  "cpuPercent",
  "gpuPercent",
  "cpuTemperature",
  "gpuTemperature",
  "memoryUsedBytes",
  "memoryTotalBytes",
] as const;
export type MetricKey = (typeof metricKeys)[number];
export type MetricValues = Record<MetricKey, number | null>;
export type MonitorSample = {
  timestamp: number;
  status: Record<MetricKey, "ok" | "unavailable">;
} & MetricValues;
export interface MonitorDevice {
  chip: string;
  memoryTotalBytes: number;
}
export interface MonitorStatus {
  phase: "starting" | "live" | "stale" | "error";
  message?: string;
}
export interface MonitorSnapshot {
  device: MonitorDevice | null;
  samples: MonitorSample[];
  status: MonitorStatus;
}
export type MonitorEvent =
  | { type: "snapshot"; data: MonitorSnapshot }
  | { type: "sample"; data: MonitorSample }
  | { type: "status"; data: MonitorStatus }
  | { type: "device"; data: MonitorDevice };
