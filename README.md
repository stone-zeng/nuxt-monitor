# Nuxt Monitor

A minimal local dashboard for CPU/GPU temperature, CPU/GPU utilization, and memory.
Nuxt UI `UChart` displays half-second samples from a read-only Swift collector.
The server keeps at most 1800 samples from the last 15 minutes, in memory only.

## Requirements

- Apple Silicon macOS; temperature mappings currently target the M3 family.
- Xcode or Command Line Tools (`xcrun swiftc`).
- Vite+ (`vp`, `vpx`).

The collector runs as your normal user. No sudo, Homebrew monitor, daemon,
database, or cloud service is required. Temperature and GPU readings use
undocumented macOS interfaces; compatibility can change with macOS updates.

## Development

```sh
vp install
vp run dev
```

Open <http://127.0.0.1:3000>. The native collector is compiled into `.cache/native`
before Nuxt starts; unchanged sources reuse the existing binary. If you edit the
Swift source, restart `vp run dev` to rebuild it. Frontend changes use Nuxt HMR.

## Production

```sh
vp run build
vp run start
```

The build includes the executable at `.output/server/native/monitor`. Production
does not need Swift installed. To run the output directly, explicitly bind to
loopback:

```sh
HOST=127.0.0.1 node .output/server/index.mjs
```

`vp run start` and `vp run preview` bind to `127.0.0.1`; use `PORT=3001` to select
another port. This is a local Node application, not a static/serverless site.
Build and run it on the target Mac. Stopping the server ends its collector;
closing a browser tab leaves collection running until the server exits.

## Readings and controls

- Time windows: 1 (default), 5, or 15 minutes. Pause freezes the display; collection continues.
- The time axis scrolls between samples using a separate animation clock, up to
  20 updates/second. Wider windows redraw less often. Hidden tabs and paused views
  stop animating; reduced-motion preferences use sample-rate updates instead.
  Sensor values remain unchanged; only their position on the time axis moves.
- Readings use tabular monospace digits and fixed-width fields to prevent layout shifts.
- Hover, touch, or focus a chart and use arrow keys to inspect readings.
- CPU: busy fraction of system CPU ticks, normalized to 0–100% across all cores.
  Per-processor Mach counters avoid cached `host_statistics` readings at subsecond intervals
  ([Apple's implementation](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/host.c)).
- GPU: the driver's `Device Utilization %` counter.
- Temperature: the average of readable M3 CPU or GPU sensors, in °C.
- Memory: active + inactive + speculative + wired + physical compressed pages,
  minus purgeable and file-backed pages, in GiB. This is not total minus free.
- Each reading retains its last valid value through missing samples or disconnections;
  a field stays blank until its first valid reading. Stale/connection notices still apply.
  Missed intervals break the line. Sensor averages need not equal a hottest-core
  reading from another utility.

## Validation

GitHub Actions runs checks, unit tests, typechecking, native self-tests, and a
production build on macOS ARM64 with Node.js 26 for pushes to `main`. Actual
sensor readings and the SSE soak check below should be verified on the target Mac.

```sh
vp check
vp test
vp run test:native
vp run typecheck
vp run build
```

The tests cover line decoding, missing/invalid metrics, bounded history,
collector sharing/restarts, stale data, reconnect snapshots, pause/resume, and
chart gaps. Native self-tests check temperature decoding and CPU accounting.

Run the SSE soak check against a running server (default: 910 seconds):

```sh
MONITOR_URL=http://127.0.0.1:3000 vpx scripts/verify-stream.ts
```

## Troubleshooting

- Missing Swift: install Apple's Command Line Tools, then run `vp run build:native`.
- Missing collector: run `vp run build:native` for development, or rebuild production.
- Missing temperature: use a normal Terminal session; restrictive sandboxes can
  deny AppleSMC access even without any root requirement. Check actual readings
  with `.cache/native/monitor --samples 3`. Other metrics continue if a sensor fails.
- Connection failure: verify the server is running on the same Mac. It retries
  automatically; more than three seconds without a fresh sample marks data stale.
- After sleep: the stream resumes and refreshes history, preserving the gap.
- Toolchain/package-manager issues: run `vp env doctor`.

AppleSMC structures, sensor mappings, and memory accounting are adapted from
Stats; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
