import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom", "@tanstack/react-query", "zustand"],
          charts: ["echarts", "echarts-for-react"],
          map: ["maplibre-gl"],
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
});
