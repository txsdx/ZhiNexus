/** Vite configuration shared by browser, Tauri desktop and Android development. */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "0.0.0.0" },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022" },
});
