import { icons } from "@/components/icons";
import { getTheme, toggleTheme } from "@/state/theme";

// Topbar holds only the theme toggle; the account avatar + login/logout live in
// the sidebar footer.
export function renderTopbarActions(container: HTMLElement): void {
  const theme = getTheme();

  container.innerHTML = `
    <button class="topbar-icon-button" type="button" data-action="theme" aria-label="Toggle dark mode">
      ${theme === "dark" ? icons.sun() : icons.moon()}
    </button>
  `;

  container
    .querySelector<HTMLElement>("[data-action='theme']")
    ?.addEventListener("click", () => {
      toggleTheme();
      renderTopbarActions(container);
    });
}
