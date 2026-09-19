import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The app interface (packages/ui), built for the app:// scheme.
export default defineConfig({
  root: path.join(import.meta.dirname, "src/renderer"),
  base: "./",
  plugins: [react()],
  clearScreen: false,
  build: { outDir: path.join(import.meta.dirname, "dist/renderer"), emptyOutDir: true, target: "chrome140", sourcemap: false, chunkSizeWarningLimit: 900 },
});
