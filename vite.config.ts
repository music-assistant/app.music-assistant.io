import { defineConfig, type Plugin } from "vite";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

export default defineConfig({
  root: "src",
  publicDir: "../public",
  // Using custom domain app.music-assistant.io
  base: "/",
  plugins: [checkCallbackCsp()],
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

/**
 * Fail the build when the CSP of the auth callback page does not allow its inline script.
 */
function checkCallbackCsp(): Plugin {
  return {
    name: "check-callback-csp",
    buildStart() {
      const html = readFileSync(resolve(__dirname, "public/auth/callback/index.html"), "utf8");
      const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
      const hash = createHash("sha256").update(script).digest("base64");
      if (!html.includes(`script-src 'sha256-${hash}'`)) {
        this.error(`public/auth/callback/index.html: set the CSP to script-src 'sha256-${hash}'`);
      }
    },
  };
}
