import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    // 1430 (not Tauri's usual 1420) — other Tauri projects on this machine
    // already fight over 1420.
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
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    // 4. Browser dev mode: proxy JSON + media to a local CB8 server so the app
    //    can run against `vite dev` without Tauri (see src/lib/transport.ts).
    //    Override with CB8_SERVER (e.g. the docker compose port 4218).
    proxy: {
      // @ts-expect-error process is a nodejs global
      "/api": process.env.CB8_SERVER || "http://localhost:8008",
    },
  },
}));
