import { dirname, resolve } from "node:path";
import { createMonitor } from "../lib/monitor";

let monitor: ReturnType<typeof createMonitor> | undefined;
export function getMonitor() {
  if (!monitor) {
    const config = useRuntimeConfig();
    const binary = config.monitorBinary || resolve(dirname(process.argv[1]!), "native/monitor");
    monitor = createMonitor(binary);
  }
  return monitor;
}

export async function stopMonitor() {
  await monitor?.stop();
  monitor = undefined;
}
