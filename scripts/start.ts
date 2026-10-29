import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../.output/server/index.mjs", import.meta.url));
const server = spawn(process.execPath, [entry], {
  stdio: "inherit",
  env: { ...process.env, HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1" },
});
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.kill(signal));
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
