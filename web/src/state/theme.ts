const THEME_KEY = "lazyscan:theme";

export type ThemeMode = "light" | "dark";

export function getTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return "light";
}

export function setTheme(theme: ThemeMode): void {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute("data-theme", theme);
}

export function initTheme(): void {
  setTheme(getTheme());
}

// Enables a brief color transition only while the theme flips. Scoping it to a
// temporary attribute (rather than a permanent transition on every element)
// avoids a color sweep on initial load and the repaint cost the rest of the time.
let transitionTimer: number | undefined;

function enableThemeTransition(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  const root = document.documentElement;
  root.setAttribute("data-theme-transition", "");
  window.clearTimeout(transitionTimer);
  transitionTimer = window.setTimeout(() => {
    root.removeAttribute("data-theme-transition");
  }, 260);
}

export function toggleTheme(): ThemeMode {
  const next = getTheme() === "light" ? "dark" : "light";
  enableThemeTransition();
  setTheme(next);
  return next;
}
