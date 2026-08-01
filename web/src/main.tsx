// Font faces first: they must exist before the stylesheets that reference them.
import "@fontsource-variable/inter";
import "@/styles/index.css";
import "@/styles/reader.css";
import { createRoot } from "react-dom/client";
import { App } from "@/app";
import { ToastProvider } from "@/components/ui/toast";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("App root was not found");
}

createRoot(root).render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
