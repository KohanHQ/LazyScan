import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const apiProxyTarget =
    env.VITE_API_PROXY_TARGET || "http://localhost:3000";

  return {
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
        "/auth": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/manga": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/profile": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/reader": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/library": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/reading-status": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/upload": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/admin": {
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
