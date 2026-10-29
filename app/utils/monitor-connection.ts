import type { MonitorDevice, MonitorSnapshot, MonitorStatus } from "../../shared/types/monitor";
import { normalizeSample } from "../../shared/utils/monitor";
import type { createMonitorState } from "./monitor-state";

/** Explicit retries also cover HTTP errors for which EventSource stops retrying. */
export function createMonitorConnection(state: ReturnType<typeof createMonitorState>) {
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let enabled = false;

  function connect() {
    if (!enabled || source) return;
    const connection = new EventSource("/api/monitor/stream");
    source = connection;
    connection.addEventListener("snapshot", (event) => {
      if (source !== connection) return;
      state.now.value = Date.now();
      state.snapshot(JSON.parse(event.data) as MonitorSnapshot);
      failures = 0;
    });
    connection.addEventListener("sample", (event) => {
      if (source !== connection) return;
      const sample = normalizeSample(JSON.parse(event.data));
      if (sample) state.receive(sample);
    });
    connection.addEventListener("status", (event) => {
      if (source === connection) state.status.value = JSON.parse(event.data) as MonitorStatus;
    });
    connection.addEventListener("device", (event) => {
      if (source === connection) state.device.value = JSON.parse(event.data) as MonitorDevice;
    });
    connection.onerror = () => {
      if (source !== connection) return;
      connection.close();
      source = null;
      state.connected.value = false;
      state.status.value = { phase: "error", message: "连接中断，正在重连" };
      if (enabled) retry = setTimeout(connect, Math.min(1000 * 2 ** failures++, 30000));
    };
  }

  function start() {
    enabled = true;
    connect();
  }
  function stop() {
    enabled = false;
    clearTimeout(retry);
    source?.close();
    source = null;
    state.connected.value = false;
  }
  return { start, stop };
}
