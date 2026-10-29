import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { appendSample, normalizeSample, trimHistory } from "../shared/utils/monitor";
import type { MonitorEvent, MonitorSample } from "../shared/types/monitor";
import { JsonLines } from "../server/lib/json-lines";
import { Monitor } from "../server/lib/monitor";
import { createMonitorState } from "../app/utils/monitor-state";
import { createMonitorConnection } from "../app/utils/monitor-connection";
import { chartRows } from "../app/utils/monitor-chart";

function sample(timestamp = Date.now()): MonitorSample {
  return normalizeSample({
    timestamp,
    cpuPercent: 25,
    gpuPercent: 30,
    cpuTemperature: 55,
    gpuTemperature: 50,
    memoryUsedBytes: 10 * 1024 ** 3,
    memoryTotalBytes: 18 * 1024 ** 3,
  })!;
}

class FakeCollector extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 123;
  kill = vi.fn(() => {
    this.emit("close", 0);
    return true;
  });
  send(value: unknown) {
    this.stdout.write(`${JSON.stringify(value)}\n`);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("native protocol", () => {
  it("decodes split lines, skips bad JSON and bounds unfinished input", () => {
    const consume = vi.fn();
    const invalid = vi.fn();
    const decoder = new JsonLines(consume, invalid);
    decoder.push('{"type":"sam');
    decoder.push('ple"}\r\ninvalid\n{"type":"device"}\n');
    expect(consume.mock.calls.map((call) => call[0])).toEqual([
      { type: "sample" },
      { type: "device" },
    ]);
    decoder.push("x".repeat(65537));
    decoder.push('{"ok":true}\n');
    expect(invalid).toHaveBeenCalledTimes(2);
    expect(consume).toHaveBeenLastCalledWith({ ok: true });
  });

  it("preserves genuine zero utilization but rejects impossible or absent measurements", () => {
    const result = normalizeSample({
      ...sample(),
      cpuPercent: 0,
      gpuPercent: 101,
      cpuTemperature: 0,
      gpuTemperature: Infinity,
      memoryUsedBytes: 1e15,
    })!;
    expect(result.cpuPercent).toBe(0);
    expect(result.status.cpuPercent).toBe("ok");
    expect(result.gpuPercent).toBeNull();
    expect(result.cpuTemperature).toBeNull();
    expect(result.gpuTemperature).toBeNull();
    expect(result.memoryUsedBytes).toBeNull();
    expect(normalizeSample({ timestamp: NaN })).toBeNull();
  });
});

describe("history", () => {
  it("caps memory and expires history by time even after sleep", () => {
    const now = 2000000;
    const rows = Array.from({ length: 2000 }, (_, index) => sample(now - 999500 + index * 500));
    expect(trimHistory(rows, now)).toHaveLength(1800);
    expect(
      trimHistory(
        Array.from({ length: 2000 }, (_, index) => sample(now - 1999 + index)),
        now,
      ),
    ).toHaveLength(1800);
    expect(trimHistory(rows, now + 900000)).toHaveLength(0);
    expect(appendSample([sample(now)], sample(now))).toHaveLength(1);
  });

  it("inserts null breaks for missed intervals and keeps explicit missing sensor values", () => {
    const rows = chartRows(
      [sample(10000), sample(20000), { ...sample(21000), cpuPercent: null }],
      [{ key: "cpuPercent", label: "CPU", color: "green" }],
    );
    expect(rows.map((row) => row.value)).toEqual([25, null, 25, null]);
    expect(rows.map((row) => row.time)).toEqual([10000, 10001, 20000, 21000]);
  });
});

describe("collector lifecycle", () => {
  it("shares a process, replays snapshots, recovers after exit and cleans up", async () => {
    vi.useFakeTimers();
    const children: FakeCollector[] = [];
    const launch = vi.fn(() => {
      const child = new FakeCollector();
      children.push(child);
      return child;
    });
    const monitor = new Monitor(launch);
    const first: MonitorEvent[] = [];
    monitor.start();
    monitor.start();
    const unsubscribe = monitor.subscribe((event) => first.push(event));
    children[0]!.send({ type: "sample", sample: sample() });
    expect(first[0]?.type).toBe("snapshot");
    expect(first.at(-1)?.type).toBe("sample");
    const second: MonitorEvent[] = [];
    monitor.subscribe((event) => second.push(event));
    expect(second[0]).toMatchObject({ type: "snapshot", data: { samples: [sample()] } });
    expect(launch).toHaveBeenCalledTimes(1);
    unsubscribe();
    children[0]!.emit("close", 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(monitor.snapshot().samples).toHaveLength(1);
    children[1]!.send({ type: "sample", sample: sample() });
    expect(monitor.snapshot().status.phase).toBe("live");
    await monitor.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(children[1]!.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("marks stale readings and restarts a stalled collector", async () => {
    vi.useFakeTimers();
    const child = new FakeCollector();
    const monitor = new Monitor(() => child);
    monitor.start();
    child.send({ type: "sample", sample: sample() });
    await vi.advanceTimersByTimeAsync(4000);
    expect(monitor.snapshot().status.phase).toBe("stale");
    await vi.advanceTimersByTimeAsync(7000);
    expect(child.kill).toHaveBeenCalled();
    await monitor.stop();
  });

  it("retries spawn errors once despite a subsequent close event", async () => {
    vi.useFakeTimers();
    const launch = vi.fn(() => new FakeCollector());
    const monitor = new Monitor(launch);
    monitor.start();
    const child = launch.mock.results[0]!.value;
    child.emit("error", new Error("ENOENT"));
    child.emit("close", -1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(launch).toHaveBeenCalledTimes(2);
    await monitor.stop();
  });

  it("force-stops a hung collector that ignores SIGTERM before restarting", async () => {
    vi.useFakeTimers();
    const child = new FakeCollector();
    child.kill.mockImplementation((signal?: NodeJS.Signals) => {
      if (signal === "SIGKILL") child.emit("close", 0);
      return true;
    });
    const launch = vi.fn(() => child);
    const monitor = new Monitor(launch);
    monitor.start();
    await vi.advanceTimersByTimeAsync(12000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await vi.advanceTimersByTimeAsync(1000);
    expect(launch).toHaveBeenCalledTimes(2);
    const stopping = monitor.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await stopping;
  });
});

describe("dashboard state", () => {
  it("retains each last valid reading across missing values, stale data and reconnects", () => {
    vi.useFakeTimers();
    const state = createMonitorState();
    expect(state.values.value.cpuPercent).toBeNull();
    state.now.value = Date.now();
    state.snapshot({ device: null, samples: [sample()], status: { phase: "live" } });
    vi.advanceTimersByTime(500);
    const missing = normalizeSample({ ...sample(), cpuPercent: null, gpuPercent: 0 })!;
    state.receive(missing);
    expect(state.values.value.cpuPercent).toBe(25);
    expect(state.values.value.gpuPercent).toBe(0);
    expect(state.samples.value.at(-1)?.cpuPercent).toBeNull();
    state.togglePause();
    vi.advanceTimersByTime(500);
    state.receive({ ...sample(), cpuPercent: 60 });
    expect(state.values.value.cpuPercent).toBe(25);
    state.togglePause();
    expect(state.values.value.cpuPercent).toBe(60);
    state.now.value += 1000000;
    state.connected.value = false;
    expect(state.values.value.cpuPercent).toBe(60);
    state.snapshot({ device: null, samples: [], status: { phase: "starting" } });
    expect(state.values.value.cpuPercent).toBe(60);
  });

  it("defaults to one minute and moves time independently without replacing unchanged samples", () => {
    const state = createMonitorState();
    state.now.value = 100000;
    state.snapshot({
      device: null,
      samples: [sample(99000), sample(100000)],
      status: { phase: "live" },
    });
    expect(state.minutes.value).toBe(1);
    expect(state.end.value - state.start.value).toBe(60000);
    const rows = state.visibleSamples.value;
    state.now.value += 50;
    expect(state.end.value).toBe(100050);
    expect(state.visibleSamples.value).toBe(rows);
    expect(state.latest.value?.timestamp).toBe(100000);
    state.togglePause();
    state.now.value += 500;
    expect(state.end.value).toBe(100050);
    state.togglePause();
    expect(state.end.value).toBe(100550);
    state.now.value = 159250;
    expect(state.visibleSamples.value).toBe(rows);
    state.now.value = 161000;
    expect(state.visibleSamples.value).toHaveLength(0);
  });

  it("reconnects even when EventSource closes permanently, and cancels retries on disposal", () => {
    vi.useFakeTimers();
    const sources: FakeSource[] = [];
    class FakeSource {
      handlers = new Map<string, (event: { data: string }) => void>();
      onerror: (() => void) | null = null;
      close = vi.fn();
      constructor() {
        sources.push(this);
      }
      addEventListener(type: string, callback: (event: { data: string }) => void) {
        this.handlers.set(type, callback);
      }
    }
    vi.stubGlobal("EventSource", FakeSource);
    const state = createMonitorState();
    const connection = createMonitorConnection(state);
    connection.start();
    sources[0]!.onerror!();
    expect(sources[0]!.close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(sources).toHaveLength(2);
    sources[1]!.handlers.get("snapshot")!({
      data: JSON.stringify({ device: null, samples: [sample()], status: { phase: "live" } }),
    });
    expect(state.connected.value).toBe(true);
    expect(state.latest.value?.cpuPercent).toBe(25);
    sources[1]!.onerror!();
    connection.stop();
    vi.advanceTimersByTime(30000);
    expect(sources).toHaveLength(2);
  });

  it("freezes the view, keeps receiving, replaces reconnect history and resumes at the latest point", () => {
    vi.useFakeTimers();
    const state = createMonitorState();
    state.now.value = Date.now();
    const first = sample();
    state.snapshot({ device: null, samples: [first], status: { phase: "live" } });
    state.togglePause();
    vi.advanceTimersByTime(1000);
    state.receive({ ...sample(), cpuPercent: 75 });
    expect(state.latest.value?.cpuPercent).toBe(25);
    expect(state.visibleSamples.value).toHaveLength(1);
    state.snapshot({
      device: null,
      samples: [first, { ...sample(), cpuPercent: 75 }],
      status: { phase: "live" },
    });
    expect(state.samples.value).toHaveLength(2);
    expect(state.visibleSamples.value).toHaveLength(1);
    state.togglePause();
    expect(state.latest.value?.cpuPercent).toBe(75);
    expect(state.visibleSamples.value).toHaveLength(2);
    state.now.value += 4000;
    expect(state.latest.value).toBeNull();
    expect(state.message.value).toBe("数据已过期");
  });
});
