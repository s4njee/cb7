import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  optimizeDeps: {
    // Readium packages are ESM-only; let Vite prebundle for dev.
    include: [
      "@readium/shared",
      "@readium/navigator",
      "@readium/navigator-html-injectables",
      "@readium/decorator",
      "@readium/helpers",
      "@zip.js/zip.js",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1431,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      // @ts-expect-error process is a nodejs global
      "/api": process.env.CB8_SERVER || "http://localhost:8008",
    },
  },
}));
