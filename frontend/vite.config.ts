import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sourceIdentity } from "../scripts/build-utils.mjs";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  root: "frontend",
  define: {
    __SLOPEMATE_BUILD__: JSON.stringify(sourceIdentity(process.cwd())),
  },
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  build: {
    outDir: "../dist/frontend",
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { map: ["leaflet"] } } },
  },
});
