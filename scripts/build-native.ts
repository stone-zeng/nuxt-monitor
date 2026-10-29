import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(root, "native/Monitor.swift");
const output = resolve(root, ".cache/native/monitor");
if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The collector requires macOS on Apple Silicon.");
}
mkdirSync(resolve(root, ".cache/native"), { recursive: true });
mkdirSync(resolve(root, ".cache/swift"), { recursive: true });
let rebuild = true;
try {
  rebuild = statSync(source).mtimeMs > statSync(output).mtimeMs;
} catch {
  /* First build. */
}
if (rebuild) {
  const result = spawnSync(
    "xcrun",
    [
      "swiftc",
      "-O",
      "-framework",
      "IOKit",
      "-module-cache-path",
      resolve(root, ".cache/swift"),
      source,
      "-o",
      output,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
