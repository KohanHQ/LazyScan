import "@/styles/tailwind.css";
import "@/styles/base.css";
import "@/styles/reader.css";
import { startApp } from "@/app";
import { initTheme } from "@/state/theme";

initTheme();

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("App root was not found");
}

startApp(root);
