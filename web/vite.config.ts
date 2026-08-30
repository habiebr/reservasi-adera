import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Stamped into the bundle so a page can say which build it is. A browser holding an old
// shell looks identical to a broken deploy from the outside; this is the difference.
const BUILD_ID = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 5183,
    proxy: {
      "/api": "http://localhost:8300",
    },
  },
});
