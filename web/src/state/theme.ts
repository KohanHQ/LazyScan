const THEME_KEY = "lazyscan:theme";

export type ThemeMode = "light" | "dark";

// ponytail: dark-only cut-corner. Dark is enforced and the theme toggles are
// hidden (topbar/login render nothing); the light :root token set in base.css,
// the toggle CSS, and the data-theme-transition block stay until the full
// light-mode removal pass. toggleTheme/enableThemeTransition were removed here
// (git history has them) — restore with the light theme if it ever returns.
export function getTheme(): ThemeMode {
  return "dark";
}

export function setTheme(theme: ThemeMode): void {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute("data-theme", theme);
}

// Always writes "dark": also migrates anyone with a stored "light" on next boot.
export function initTheme(): void {
  setTheme(getTheme());
}
