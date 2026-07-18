import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const apiProxyTarget =
    env.VITE_API_PROXY_TARGET || "http://localhost:3000";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      // Docker-on-Mac bind mounts do not deliver fs events into the container,
      // so chokidar misses edits and HMR/re-transform silently stalls. Polling
      // makes file watching reliable. Enabled via env so native dev stays event-based.
      watch: {
        usePolling: env.VITE_USE_POLLING === "true",
        interval: 300,
      },
      proxy: {
        // Single-origin: all business routes live under /api/v1 (mirrors nginx
        // in prod); /health stays at root. Client base is /api/v1.
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/health": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
