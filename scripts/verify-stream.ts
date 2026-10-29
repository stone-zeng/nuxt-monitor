import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { metricKeys, type MonitorSnapshot } from "../shared/types/monitor";
import {
  HISTORY_MS,
  MAX_SAMPLES,
  SAMPLE_INTERVAL_MS,
  normalizeSample,
} from "../shared/utils/monitor";

const base = process.env.MONITOR_URL ?? "http://127.0.0.1:3000";
const seconds = Number(process.argv[2] ?? 910);
assert(Number.isFinite(seconds) && seconds >= 5);
let count = 0;
let last = 0;
let first = 0;
const ranges: Record<string, { min: number; max: number }> = {};
const abort = new AbortController();
const started = Date.now();
const timer = setTimeout(() => abort.abort(), seconds * 1000);

async function readEvents(signal: AbortSignal, onEvent: (type: string, data: unknown) => void) {
  const response = await fetch(`${base}/api/monitor/stream`, { signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  let pending = "";
  const decoder = new TextDecoder();
  for await (const chunk of response.body!) {
    pending += decoder.decode(chunk, { stream: true }).replaceAll("\r\n", "\n");
    let boundary: number;
    while ((boundary = pending.indexOf("\n\n")) >= 0) {
      const block = pending.slice(0, boundary);
      pending = pending.slice(boundary + 2);
      const type = block
        .split("\n")
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim();
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (type && data) onEvent(type, JSON.parse(data));
    }
  }
}

try {
  await readEvents(abort.signal, (type, data) => {
    if (type !== "sample") return;
    const sample = normalizeSample(data);
    assert(sample);
    assert(sample.timestamp > last, "Samples must be ordered and unique");
    last = sample.timestamp;
    first ||= last;
    count++;
    if (count > 2) {
      for (const key of metricKeys) {
        const value: number | null = sample[key];
        assert(value !== null, `${key} is unavailable on this machine`);
        const range = ranges[key] ?? { min: value, max: value };
        ranges[key] = { min: Math.min(range.min, value), max: Math.max(range.max, value) };
      }
    }
  });
} catch (error) {
  if (!abort.signal.aborted) throw error;
} finally {
  clearTimeout(timer);
}
assert(
  count >= ((seconds * 1000) / SAMPLE_INTERVAL_MS) * 0.9,
  `Only ${count} samples in ${seconds}s`,
);
const reconnect = new AbortController();
let snapshot: MonitorSnapshot | null = null;
try {
  await readEvents(reconnect.signal, (type, data) => {
    if (type === "snapshot") {
      snapshot = data as MonitorSnapshot;
      reconnect.abort();
    }
  });
} catch (error) {
  if (!reconnect.signal.aborted) throw error;
}
assert(snapshot);
const replay = snapshot as MonitorSnapshot;
assert(replay.samples.length <= MAX_SAMPLES);
assert(replay.samples.length >= Math.min(count - 10, MAX_SAMPLES - 20));
assert(replay.samples.every((sample) => Date.now() - sample.timestamp <= HISTORY_MS + 1000));
assert.equal(replay.status.phase, "live");
const report = {
  seconds: (Date.now() - started) / 1000,
  count,
  first,
  last,
  history: replay.samples.length,
  device: replay.device,
  ranges,
};
await mkdir(".cache/verification", { recursive: true });
await writeFile(".cache/verification/stream.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
