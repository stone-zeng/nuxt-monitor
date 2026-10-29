// https://nuxt.com/docs/api/configuration/nuxt-config
import { copyFile, mkdir, rename } from "node:fs/promises";
import { resolve } from "node:path";

export default defineNuxtConfig({
  modules: ["@nuxt/ui"],

  devtools: {
    enabled: false,
  },

  css: ["~/assets/css/main.css"],

  devServer: { host: "127.0.0.1" },

  // Keep shared-module externals resolvable when Nitro bundles the SSR output.
  vite: { build: { rolldownOptions: { makeAbsoluteExternalsRelative: false } } },

  runtimeConfig: { monitorBinary: "" },

  nitro: {
    preset: "node-server",
    hooks: {
      async compiled(nitro) {
        if (nitro.options.dev) return;
        const directory = resolve(nitro.options.output.serverDir, "native");
        await mkdir(directory, { recursive: true });
        // Atomic replacement keeps any running collector's executable intact.
        const staged = resolve(directory, "monitor.tmp");
        await copyFile(resolve(".cache/native/monitor"), staged);
        await rename(staged, resolve(directory, "monitor"));
      },
    },
  },

  $development: { runtimeConfig: { monitorBinary: resolve(".cache/native/monitor") } },

  compatibilityDate: "2026-06-30",
});
