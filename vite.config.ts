import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "src",
  publicDir: "../public",
  // For GitHub Pages without custom domain, use repo name as base
  // Change to "/" when using custom domain (app.music-assistant.io)
  base: "/app.music-assistant.io/",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
      },
    },
  },
  server: {
    port: 3000,
  },
});
