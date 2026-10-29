import { spawn, type ChildProcess } from "node:child_process";
import {
  appendSample,
  isRecord,
  normalizeSample,
  SAMPLE_INTERVAL_MS,
  STALE_MS,
  trimHistory,
} from "../../shared/utils/monitor";
import type {
  MonitorDevice,
  MonitorEvent,
  MonitorSample,
  MonitorSnapshot,
  MonitorStatus,
} from "../../shared/types/monitor";
import { JsonLines } from "./json-lines";

type Collector = Pick<ChildProcess, "stdout" | "stderr" | "kill" | "pid"> & {
  once(event: "error" | "close", listener: () => void): unknown;
};
type Listener = (event: MonitorEvent) => void;

export class Monitor {
  private child: Collector | null = null;
  private listeners = new Set<Listener>();
  private samples: MonitorSample[] = [];
  private device: MonitorDevice | null = null;
  private status: MonitorStatus = { phase: "starting" };
  private retry: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private termination: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private failures = 0;
  private lastReceived = 0;
  private launched = 0;

  constructor(private readonly launch: () => Collector) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.launchCollector();
    this.watchdog = setInterval(() => {
      const now = Date.now();
      this.samples = trimHistory(this.samples, now);
      if (this.status.phase === "live" && now - this.lastReceived > STALE_MS)
        this.setStatus({ phase: "stale", message: "数据已过期" });
      if (this.child && now - Math.max(this.lastReceived, this.launched) > 10000)
        this.terminateCollector(this.child);
    }, 1000);
    this.watchdog.unref();
  }

  snapshot(): MonitorSnapshot {
    return {
      device: this.device,
      samples: trimHistory(this.samples, Date.now()),
      status: this.status,
    };
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener({ type: "snapshot", data: this.snapshot() });
    return () => {
      this.listeners.delete(listener);
    };
  }

  private broadcast(event: MonitorEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private setStatus(status: MonitorStatus) {
    if (status.phase === this.status.phase && status.message === this.status.message) return;
    this.status = status;
    this.broadcast({ type: "status", data: status });
  }

  private receive(value: unknown) {
    if (!isRecord(value)) return;
    if (value.type === "device" && isRecord(value.device)) {
      const { chip, memoryTotalBytes } = value.device;
      if (
        typeof chip === "string" &&
        typeof memoryTotalBytes === "number" &&
        Number.isFinite(memoryTotalBytes) &&
        memoryTotalBytes > 0
      ) {
        this.device = { chip, memoryTotalBytes };
        this.broadcast({ type: "device", data: this.device });
      }
    } else if (value.type === "sample") {
      const sample = normalizeSample(value.sample);
      if (!sample || Math.abs(Date.now() - sample.timestamp) > STALE_MS) return;
      // A wall-clock rollback starts a fresh timeline rather than trapping the stream.
      if (sample.timestamp < (this.samples.at(-1)?.timestamp ?? 0)) this.samples = [];
      this.samples = appendSample(this.samples, sample);
      this.lastReceived = Date.now();
      this.failures = 0;
      this.setStatus({ phase: "live" });
      this.broadcast({ type: "sample", data: sample });
    }
  }

  private launchCollector() {
    if (this.stopped || this.child) return;
    this.launched = Date.now();
    this.setStatus({ phase: "starting" });
    let child: Collector;
    try {
      child = this.launch();
    } catch {
      this.scheduleRestart();
      return;
    }
    this.child = child;
    const decoder = new JsonLines(
      (value) => this.receive(value),
      () => {
        this.setStatus({ phase: "error", message: "采集数据无效" });
      },
    );
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => decoder.push(chunk));
    // Drain stderr without exposing native diagnostics in the page.
    child.stderr?.on("data", () => {});
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (this.termination) clearTimeout(this.termination);
      this.termination = null;
      if (this.child === child) this.child = null;
      if (!this.stopped) this.scheduleRestart();
    };
    child.once("error", finish);
    child.once("close", finish);
  }

  private scheduleRestart() {
    this.setStatus({ phase: "error", message: "采集器已断开，正在重试" });
    const delay = Math.min(1000 * 2 ** this.failures++, 30000);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.launchCollector();
    }, delay);
    this.retry.unref();
  }

  private terminateCollector(child: Collector) {
    if (this.termination) return;
    child.kill("SIGTERM");
    if (this.child === child) {
      this.termination = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1000);
      this.termination.unref();
    }
  }

  async stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.termination) clearTimeout(this.termination);
    this.retry = null;
    this.watchdog = null;
    this.termination = null;
    const child = this.child;
    this.child = null;
    this.listeners.clear();
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 1000);
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
}

export function createMonitor(binary: string) {
  return new Monitor(() =>
    spawn(binary, ["--interval-ms", String(SAMPLE_INTERVAL_MS)], {
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}
