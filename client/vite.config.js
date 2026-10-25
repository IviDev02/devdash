import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.API_URL || "http://localhost:4100";

export default defineConfig({
  plugins: [react()],
  // Recharts ocupa la mayor parte del bundle; es una app local, no hace falta trocearlo
  build: { chunkSizeWarningLimit: 800 },
  server: {
    port: 5173,
    proxy: { "/api": API },
  },
});
